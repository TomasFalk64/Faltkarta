import * as FileSystem from "expo-file-system/legacy";
import * as DocumentPicker from "expo-document-picker";
import { Alert } from "react-native";
import { fromByteArray, toByteArray } from "base64-js";
import * as UTIF from "utif";
import UPNG from "upng-js";
import { MapItem } from "../types/models";
import { makeId } from "../utils/id";

const MAPS_DIR = `${FileSystem.documentDirectory}maps`;
const PREVIEWS_DIR = `${FileSystem.documentDirectory}previews`;
const EXPORT_DIR = `${FileSystem.documentDirectory}exports`;

export async function ensureDataDirs() {
  await ensureDir(MAPS_DIR);
  await ensureDir(PREVIEWS_DIR);
  await ensureDir(EXPORT_DIR);
}

async function ensureDir(uri: string) {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
  }
}

export async function pickAndImportGeoTiff(): Promise<MapItem | null> {
  await ensureDataDirs();
  const result = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.[0]) {
    return null;
  }
  const asset = result.assets[0];
  const ext = asset.name.toLowerCase();
  if (!ext.endsWith(".tif") && !ext.endsWith(".tiff")) {
    Alert.alert("Fel filtyp", "Välj en .tif eller .tiff-fil.");
    return null;
  }
  const id = makeId("map");
  const safeName = sanitizeFileName(asset.name);
  const targetUri = `${MAPS_DIR}/${id}_${safeName}`;
  await FileSystem.copyAsync({ from: asset.uri, to: targetUri });
  const thumbnailUri = await generatePreviewFromGeoTiff(targetUri, id);

  return {
    id,
    name: asset.name.replace(/\.(tif|tiff)$/i, ""),
    fileUri: targetUri,
    thumbnailUri: thumbnailUri ?? undefined,
    createdAt: new Date().toISOString(),
    bbox: {
      minLat: 55.0,
      minLon: 11.0,
      maxLat: 69.5,
      maxLon: 24.2,
    },
  };
}

export async function ensureGeoTiffPreview(map: MapItem): Promise<MapItem> {
  if (map.thumbnailUri) {
    return map;
  }
  const preview = await generatePreviewFromGeoTiff(map.fileUri, map.id);
  if (!preview) {
    return map;
  }
  return { ...map, thumbnailUri: preview };
}

export async function pickPreviewImageForMap(mapId: string): Promise<string | null> {
  await ensureDataDirs();
  const result = await DocumentPicker.getDocumentAsync({
    type: ["image/*"],
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.[0]) {
    return null;
  }
  const asset = result.assets[0];
  const safeName = sanitizeFileName(asset.name);
  const targetUri = `${PREVIEWS_DIR}/${mapId}_${safeName}`;
  await FileSystem.copyAsync({ from: asset.uri, to: targetUri });
  return targetUri;
}

export async function deleteIfExists(uri: string) {
  if (!uri) return;
  const info = await FileSystem.getInfoAsync(uri);
  if (info.exists) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  }
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^\w\-.]/g, "_");
}

export function exportDir(): string {
  return EXPORT_DIR;
}

async function generatePreviewFromGeoTiff(geoTiffUri: string, mapId: string): Promise<string | null> {
  try {
    const base64 = await FileSystem.readAsStringAsync(geoTiffUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const tiffBytes = toByteArray(base64);
    const tiffBuffer = toArrayBuffer(tiffBytes);
    const ifds = UTIF.decode(tiffBuffer);
    if (!ifds.length) {
      return null;
    }

    const ifd = ifds[0];
    UTIF.decodeImage(tiffBuffer, ifd);
    const rgba = UTIF.toRGBA8(ifd);
    const srcW = Number(ifd.width ?? 0);
    const srcH = Number(ifd.height ?? 0);
    if (srcW <= 0 || srcH <= 0 || !rgba?.length) {
      return null;
    }

    const { w: dstW, h: dstH } = fitSize(srcW, srcH, 1400);
    const scaled = resizeRgbaNearest(rgba, srcW, srcH, dstW, dstH);
    const pngArrayBuffer = UPNG.encode([toArrayBuffer(scaled)], dstW, dstH, 0);
    const pngBytes = new Uint8Array(pngArrayBuffer);
    const pngBase64 = fromByteArray(pngBytes);
    const outUri = `${PREVIEWS_DIR}/${mapId}_preview.png`;
    await FileSystem.writeAsStringAsync(outUri, pngBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return outUri;
  } catch {
    return null;
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function fitSize(width: number, height: number, maxSide: number): { w: number; h: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) {
    return { w: width, h: height };
  }
  const scale = maxSide / longest;
  return {
    w: Math.max(1, Math.round(width * scale)),
    h: Math.max(1, Math.round(height * scale)),
  };
}

function resizeRgbaNearest(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8Array {
  if (srcW === dstW && srcH === dstH) {
    return src;
  }
  const dst = new Uint8Array(dstW * dstH * 4);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor(y * yRatio));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor(x * xRatio));
      const srcIdx = (sy * srcW + sx) * 4;
      const dstIdx = (y * dstW + x) * 4;
      dst[dstIdx] = src[srcIdx];
      dst[dstIdx + 1] = src[srcIdx + 1];
      dst[dstIdx + 2] = src[srcIdx + 2];
      dst[dstIdx + 3] = src[srcIdx + 3];
    }
  }
  return dst;
}
