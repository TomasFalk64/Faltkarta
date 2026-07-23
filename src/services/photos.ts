import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import * as MediaLibrary from "expo-media-library";
import { Image } from "react-native";
import { ObservationPhoto } from "../types/models";
import { makeId } from "../utils/id";
import {
  buildPointPhotoFileName,
  maxPhotoSideForSetting,
  sanitizeForFileName,
} from "./photoUtils";

export { buildPointPhotoFileName, sanitizeForFileName } from "./photoUtils";

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

export function guessImageExtension(uri: string): string {
  const clean = uri.split("?")[0];
  const match = clean.match(/\.([A-Za-z0-9]+)$/);
  const ext = match?.[1]?.toLowerCase();
  if (!ext) return "jpg";
  if (ext === "jpeg") return "jpg";
  if (["jpg", "png", "webp", "heic", "heif"].includes(ext)) return ext;
  return "jpg";
}

export function mapPhotosDir(mapId: string): string {
  const base = FileSystem.documentDirectory ?? "";
  return `${base}maps/${sanitizeForFileName(mapId)}/photos/`;
}

export async function ensureMapPhotosDir(mapId: string): Promise<string> {
  const dir = mapPhotosDir(mapId);
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

export function isMapPhotoUri(uri: string, mapId: string): boolean {
  return String(uri ?? "").startsWith(mapPhotosDir(mapId));
}

export async function deleteLocalPhotoFiles(photos: ObservationPhoto[]): Promise<void> {
  await Promise.all(
    photos
      .map((photo) => photo.localUri)
      .filter((uri): uri is string => !!uri)
      .map((uri) => deleteIfExists(uri))
  );
}

export async function removeMapPhotosDir(mapId: string): Promise<void> {
  await deleteIfExists(mapPhotosDir(mapId));
}

export async function getFileSize(uri: string): Promise<number | null> {
  const info = await FileSystem.getInfoAsync(uri, { size: true } as any);
  if (info && "size" in info && typeof (info as { size?: number }).size === "number") {
    return (info as { size?: number }).size ?? null;
  }
  return null;
}

export async function compressPhotoToAppFile(options: {
  sourceRef?: string;
  assetId?: string;
  targetUri: string;
  maxImageSizeMB: number;
}): Promise<string | null> {
  const source = options.sourceRef
    ? await resolvePointPhotoUri(options.sourceRef, options.assetId)
    : options.assetId
      ? await resolvePointPhotoUri("", options.assetId)
      : null;
  if (!source) return null;

  await ensureParentDir(options.targetUri);
  const size = await getImageSizeSafe(source);
  const maxSide = maxPhotoSideForSetting(options.maxImageSizeMB);
  const actions: ImageManipulator.Action[] = [];
  if (size && Math.max(size.width, size.height) > maxSide) {
    if (size.width >= size.height) {
      actions.push({ resize: { width: maxSide } });
    } else {
      actions.push({ resize: { height: maxSide } });
    }
  }

  const originalBytes = await getFileSize(source);
  const maxBytes = Math.max(0.2, options.maxImageSizeMB) * 1024 * 1024;
  const compress = originalBytes && originalBytes > maxBytes
    ? Math.min(0.95, Math.max(0.2, maxBytes / originalBytes))
    : 0.9;

  const result = await ImageManipulator.manipulateAsync(source, actions, {
    compress,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: false,
  });
  if (!result.uri) return null;
  await deleteIfExists(options.targetUri);
  await FileSystem.copyAsync({ from: result.uri, to: options.targetUri });
  if (result.uri !== source) {
    await deleteIfExists(result.uri);
  }
  return options.targetUri;
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

async function ensureParentDir(uri: string): Promise<void> {
  const idx = uri.lastIndexOf("/");
  if (idx < 0) return;
  const dir = uri.slice(0, idx + 1);
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
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

function getImageSizeSafe(uri: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      async () => {
        try {
          const fallback = await ImageManipulator.manipulateAsync(uri, [], {
            compress: 1,
            format: ImageManipulator.SaveFormat.JPEG,
            base64: false,
          });
          if (fallback.uri && fallback.uri !== uri) {
            await deleteIfExists(fallback.uri);
          }
          resolve({ width: fallback.width, height: fallback.height });
        } catch {
          resolve(null);
        }
      }
    );
  });
}

function looksLikeUri(value: string): boolean {
  return value.startsWith("file://") || value.startsWith("content://") || value.startsWith("ph://");
}
