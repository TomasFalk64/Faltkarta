import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import { makeId } from "../utils/id";

const TEMP_PREFIX = "faltkarta_pending_";

type SavePhotosOptions = {
  sourceUris: string[];
  pointNumber: string;
  species: string;
  dateISO: string;
  startIndex: number;
};

export async function savePointPhotosToGallery(
  options: SavePhotosOptions
): Promise<{ photoNames: string[]; photoAssetIds: string[] }> {
  if (!options.sourceUris.length) {
    return { photoNames: [], photoAssetIds: [] };
  }
  const permission = await MediaLibrary.requestPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Bildbehorighet kravs for att spara foton i galleriet.");
  }

  const photoNames: string[] = [];
  const photoAssetIds: string[] = [];
  for (let i = 0; i < options.sourceUris.length; i++) {
    const sourceUri = options.sourceUris[i];
    const sequence = options.startIndex + i;
    const extension = guessImageExtension(sourceUri);
    const fileName = buildPointPhotoFileName(
      options.pointNumber,
      options.species,
      options.dateISO,
      sequence,
      extension
    );
    const tempUri = `${FileSystem.cacheDirectory}${TEMP_PREFIX}${makeId("img")}_${fileName}`;
    await FileSystem.copyAsync({ from: sourceUri, to: tempUri });
    try {
      const asset = await MediaLibrary.createAssetAsync(tempUri);
      photoNames.push(fileName);
      photoAssetIds.push(asset.id);
    } finally {
      await deleteIfExists(tempUri);
    }
  }
  return { photoNames, photoAssetIds };
}

export async function resolvePointPhotoUri(
  photoName: string,
  photoAssetId?: string
): Promise<string | null> {
  if (looksLikeUri(photoName)) {
    return photoName;
  }
  if (photoAssetId) {
    try {
      const info = await MediaLibrary.getAssetInfoAsync(photoAssetId);
      if (info?.localUri) return info.localUri;
      if (info?.uri) return info.uri;
    } catch {
      // Fall back to filename search.
    }
  }
  return await findAssetUriByFilename(photoName);
}

export function photoFileNameFromRef(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const plain = normalized.split("?")[0];
  const chunks = plain.split(/[\\/]/);
  return chunks[chunks.length - 1] ?? normalized;
}

export function sanitizeForFileName(value: string): string {
  const normalized = toAscii(value)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_\-.]+|[_\-.]+$/g, "");
  return normalized || "okand";
}

export async function createPendingPhotoCopy(sourceUri: string): Promise<string> {
  const extension = guessImageExtension(sourceUri);
  const target = `${FileSystem.cacheDirectory}${TEMP_PREFIX}${makeId("tmp")}.${extension}`;
  await FileSystem.copyAsync({ from: sourceUri, to: target });
  return target;
}

export async function deletePendingPhotoCopies(uris: string[]): Promise<void> {
  await Promise.all(
    uris
      .filter((uri) => uri.includes(TEMP_PREFIX))
      .map((uri) => deleteIfExists(uri))
  );
}

export async function cleanupAllPendingPhotoCopies(): Promise<void> {
  const cache = FileSystem.cacheDirectory;
  if (!cache) return;
  try {
    const files = await FileSystem.readDirectoryAsync(cache);
    await Promise.all(
      files
        .filter((name) => name.startsWith(TEMP_PREFIX))
        .map((name) => deleteIfExists(`${cache}${name}`))
    );
  } catch {
    // Ignore cleanup failures.
  }
}

function buildPointPhotoFileName(
  pointNumber: string,
  species: string,
  dateISO: string,
  sequence: number,
  extension: string
): string {
  const point = sanitizeForFileName(pointNumber);
  const art = sanitizeForFileName(species);
  const ts = formatDateForFileName(dateISO);
  return `${point}_${art}_${ts}_${sequence}.${extension}`;
}

function formatDateForFileName(dateISO: string): string {
  const date = new Date(dateISO);
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const min = pad2(date.getMinutes());
  return `${yyyy}-${mm}-${dd}_${hh}-${min}`;
}

function guessImageExtension(uri: string): string {
  const clean = uri.split("?")[0];
  const match = clean.match(/\.([A-Za-z0-9]+)$/);
  const ext = match?.[1]?.toLowerCase();
  if (!ext) return "jpg";
  if (ext === "jpeg") return "jpg";
  if (["jpg", "png", "webp", "heic", "heif"].includes(ext)) return ext;
  return "jpg";
}

async function findAssetUriByFilename(fileName: string): Promise<string | null> {
  const target = fileName.toLowerCase();
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const pageResult = await MediaLibrary.getAssetsAsync({
      first: 200,
      after,
      mediaType: [MediaLibrary.MediaType.photo],
      sortBy: [MediaLibrary.SortBy.creationTime],
    });
    const found = pageResult.assets.find((asset) => asset.filename.toLowerCase() === target);
    if (found) {
      const info = await MediaLibrary.getAssetInfoAsync(found.id);
      return info.localUri ?? info.uri ?? null;
    }
    if (!pageResult.hasNextPage) break;
    after = pageResult.endCursor;
  }
  return null;
}

async function deleteIfExists(uri: string): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    }
  } catch {
    // Ignore cleanup failures.
  }
}

function toAscii(value: string): string {
  return value
    .replace(/[åä]/gi, "a")
    .replace(/[ö]/gi, "o")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function looksLikeUri(value: string): boolean {
  return value.startsWith("file://") || value.startsWith("content://") || value.startsWith("ph://");
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
