import * as FileSystem from "expo-file-system/legacy";
import * as DocumentPicker from "expo-document-picker";
import { Alert } from "react-native";
import { fromByteArray, toByteArray } from "base64-js";
import * as UTIF from "utif";
import UPNG from "upng-js";
import proj4 from "proj4";
import { MapItem } from "../types/models";
import { makeId } from "../utils/id";

const MAPS_DIR = `${FileSystem.documentDirectory}maps`;
const PREVIEWS_DIR = `${FileSystem.documentDirectory}previews`;
const EXPORT_DIR = `${FileSystem.documentDirectory}exports`;
const LEGACY_SWEDEN_BBOX = {
  minLat: 55.0,
  minLon: 11.0,
  maxLat: 69.5,
  maxLon: 24.2,
};
const SWEREF99_TM_DEF =
  "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";

proj4.defs("EPSG:3006", SWEREF99_TM_DEF);

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
  const bbox = await extractGeoTiffBboxWgs84(targetUri);
  const thumbnailUri = await generatePreviewFromGeoTiff(targetUri, id);

  return {
    id,
    name: asset.name.replace(/\.(tif|tiff)$/i, ""),
    fileUri: targetUri,
    thumbnailUri: thumbnailUri ?? undefined,
    createdAt: new Date().toISOString(),
    bbox: bbox ?? undefined,
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

export async function ensureMapGeorefBounds(map: MapItem): Promise<MapItem> {
  if (hasNonLegacyBbox(map)) {
    return map;
  }
  const bbox = await extractGeoTiffBboxWgs84(map.fileUri);
  if (!bbox) {
    return map;
  }
  return { ...map, bbox };
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

async function extractGeoTiffBboxWgs84(geoTiffUri: string): Promise<MapItem["bbox"] | null> {
  try {
    const base64 = await FileSystem.readAsStringAsync(geoTiffUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const tiffBytes = toByteArray(base64);
    const tiffBuffer = toArrayBuffer(tiffBytes);
    const ifds = UTIF.decode(tiffBuffer);
    if (!ifds.length) return null;

    const ifd = ifds[0] as Record<string, unknown>;
    const width = Number(ifd.width ?? ifd.t256 ?? 0);
    const height = Number(ifd.height ?? ifd.t257 ?? 0);
    if (width <= 0 || height <= 0) return null;

    const toModel = makePixelToModelTransform(ifd, width, height);
    if (!toModel) return null;

    const srcCrs = extractGeoCrs(ifd);
    if (!srcCrs) return null;

    const cornersPx = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: 0, y: height },
      { x: width, y: height },
    ];
    const cornersWgs84 = cornersPx
      .map((p) => toModel(p.x, p.y))
      .map((p) => projectToWgs84(srcCrs, p.x, p.y))
      .filter((p): p is { lon: number; lat: number } => !!p);

    if (cornersWgs84.length < 4) return null;
    const lats = cornersWgs84.map((p) => p.lat);
    const lons = cornersWgs84.map((p) => p.lon);
    const bbox = {
      minLat: Math.min(...lats),
      minLon: Math.min(...lons),
      maxLat: Math.max(...lats),
      maxLon: Math.max(...lons),
    };

    if (!isValidBbox(bbox)) return null;
    return bbox;
  } catch {
    return null;
  }
}

function hasNonLegacyBbox(map: MapItem): boolean {
  if (!map.bbox) return false;
  return !(
    map.bbox.minLat === LEGACY_SWEDEN_BBOX.minLat &&
    map.bbox.minLon === LEGACY_SWEDEN_BBOX.minLon &&
    map.bbox.maxLat === LEGACY_SWEDEN_BBOX.maxLat &&
    map.bbox.maxLon === LEGACY_SWEDEN_BBOX.maxLon
  );
}

function makePixelToModelTransform(
  ifd: Record<string, unknown>,
  width: number,
  height: number
): ((x: number, y: number) => { x: number; y: number }) | null {
  const matrix = asNumberArray(ifd.t34264 ?? ifd.ModelTransformationTag);
  if (matrix && matrix.length >= 16) {
    // Affine matrix from raster space to model space.
    return (x: number, y: number) => ({
      x: matrix[0] * x + matrix[1] * y + matrix[3],
      y: matrix[4] * x + matrix[5] * y + matrix[7],
    });
  }

  const scales = asNumberArray(ifd.t33550 ?? ifd.ModelPixelScaleTag);
  const tie = asNumberArray(ifd.t33922 ?? ifd.ModelTiepointTag);
  if (!scales || scales.length < 2 || !tie || tie.length < 6) {
    return null;
  }
  const scaleX = scales[0];
  const scaleY = scales[1];
  let best: ((x: number, y: number) => { x: number; y: number }) | null = null;

  for (let i = 0; i + 5 < tie.length; i += 6) {
    const tieI = tie[i];
    const tieJ = tie[i + 1];
    const tieX = tie[i + 3];
    const tieY = tie[i + 4];
    const candidate = (x: number, y: number) => ({
      x: tieX + (x - tieI) * scaleX,
      y: tieY - (y - tieJ) * scaleY,
    });
    // Keep the first candidate that gives non-zero extent.
    const c0 = candidate(0, 0);
    const c1 = candidate(width, height);
    if (Math.abs(c1.x - c0.x) > 0 && Math.abs(c1.y - c0.y) > 0) {
      best = candidate;
      break;
    }
  }

  return best;
}

function extractGeoCrs(ifd: Record<string, unknown>): string | null {
  const geoKeys = asNumberArray(ifd.t34735 ?? ifd.GeoKeyDirectoryTag);
  if (!geoKeys || geoKeys.length < 8) {
    return null;
  }

  const entries = Math.floor((geoKeys.length - 4) / 4);
  for (let i = 0; i < entries; i++) {
    const base = 4 + i * 4;
    const keyId = geoKeys[base];
    const tiffTagLocation = geoKeys[base + 1];
    const valueOffset = geoKeys[base + 3];
    if (tiffTagLocation !== 0) continue;
    if (keyId === 3072 || keyId === 2048) {
      return `EPSG:${valueOffset}`;
    }
  }
  return null;
}

function projectToWgs84(srcCrs: string, x: number, y: number): { lon: number; lat: number } | null {
  try {
    if (srcCrs === "EPSG:4326") {
      return { lon: x, lat: y };
    }
    const [lon, lat] = proj4(srcCrs, "EPSG:4326", [x, y]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return { lon, lat };
  } catch {
    return null;
  }
}

function asNumberArray(value: unknown): number[] | null {
  if (!value) return null;
  if (Array.isArray(value)) return value.map(Number);
  if (value instanceof Float32Array || value instanceof Float64Array) return Array.from(value, Number);
  if (
    value instanceof Uint8Array ||
    value instanceof Uint16Array ||
    value instanceof Uint32Array ||
    value instanceof Int16Array ||
    value instanceof Int32Array
  ) {
    return Array.from(value, Number);
  }
  return null;
}

function isValidBbox(bbox: { minLat: number; minLon: number; maxLat: number; maxLon: number }): boolean {
  if (
    !Number.isFinite(bbox.minLat) ||
    !Number.isFinite(bbox.minLon) ||
    !Number.isFinite(bbox.maxLat) ||
    !Number.isFinite(bbox.maxLon)
  ) {
    return false;
  }
  if (bbox.minLat >= bbox.maxLat || bbox.minLon >= bbox.maxLon) return false;
  if (bbox.minLat < -90 || bbox.maxLat > 90 || bbox.minLon < -180 || bbox.maxLon > 180) return false;
  return true;
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
