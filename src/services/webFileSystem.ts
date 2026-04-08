const DB_NAME = "faltkarta-webfs";
const STORE_NAME = "files";

type StoredRecord = {
  data: Blob | string;
  type: "blob" | "text";
  mime?: string;
  updatedAt: number;
};

const objectUrlCache = new Map<string, string>();

function getIndexedDb(): IDBFactory {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB saknas i webbläsaren.");
  }
  return indexedDB;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = getIndexedDb().open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Kunde inte öppna IndexedDB."));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB-fel."));
  });
}

export function isWebUri(uri: string): boolean {
  return uri.startsWith("web://");
}

export function makeWebUri(bucket: string, name: string): string {
  return `web://${bucket}/${name}`;
}

export function webBucketPrefix(bucket: string): string {
  return `web://${bucket}/`;
}

export async function writeWebFileBlob(uri: string, blob: Blob): Promise<void> {
  const record: StoredRecord = {
    data: blob,
    type: "blob",
    mime: blob.type || undefined,
    updatedAt: Date.now(),
  };
  await withStore("readwrite", (store) => store.put(record, uri));
  revokeWebObjectUrl(uri);
}

export async function writeWebFileText(uri: string, text: string): Promise<void> {
  const record: StoredRecord = { data: text, type: "text", updatedAt: Date.now() };
  await withStore("readwrite", (store) => store.put(record, uri));
  revokeWebObjectUrl(uri);
}

export async function readWebFileAsBlob(uri: string): Promise<Blob | null> {
  const record = await withStore<StoredRecord | undefined>("readonly", (store) => store.get(uri));
  if (!record) return null;
  if (record.type === "blob") return record.data as Blob;
  const text = String(record.data ?? "");
  return new Blob([text], { type: "text/plain" });
}

export async function readWebFileAsText(uri: string): Promise<string | null> {
  const record = await withStore<StoredRecord | undefined>("readonly", (store) => store.get(uri));
  if (!record) return null;
  if (record.type === "text") return String(record.data ?? "");
  const blob = record.data as Blob;
  return await blob.text();
}

export async function readWebFileAsArrayBuffer(uri: string): Promise<ArrayBuffer | null> {
  const blob = await readWebFileAsBlob(uri);
  if (!blob) return null;
  return await blob.arrayBuffer();
}

export async function deleteWebFile(uri: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(uri));
  revokeWebObjectUrl(uri);
}

export async function listWebFiles(prefix: string): Promise<string[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const keys: string[] = [];
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result as IDBCursorWithValue | null;
      if (!cursor) {
        resolve(keys);
        return;
      }
      const key = String(cursor.key ?? "");
      if (key.startsWith(prefix)) {
        keys.push(key);
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error ?? new Error("Kunde inte lista filer."));
  });
}

export async function getWebObjectUrl(uri: string): Promise<string | null> {
  if (objectUrlCache.has(uri)) {
    return objectUrlCache.get(uri) ?? null;
  }
  const blob = await readWebFileAsBlob(uri);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  objectUrlCache.set(uri, url);
  return url;
}

export function revokeWebObjectUrl(uri: string) {
  const existing = objectUrlCache.get(uri);
  if (existing) {
    URL.revokeObjectURL(existing);
    objectUrlCache.delete(uri);
  }
}

export async function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    URL.revokeObjectURL(url);
  }
}
