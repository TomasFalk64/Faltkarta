import * as FileSystem from "expo-file-system/legacy";
import * as DocumentPicker from "expo-document-picker";
import { Alert, Platform } from "react-native";
import { fromByteArray, toByteArray } from "base64-js";
import * as UTIF from "utif";
import UPNG from "upng-js";
import proj4 from "proj4";
import { MapItem } from "../types/models";
import { makeId } from "../utils/id";
import {
  deleteWebFile,
  getWebObjectUrl,
  isWebUri,
  makeWebUri,
  readWebFileAsArrayBuffer,
  writeWebFileBlob,
} from "./webFileSystem";

const MAPS_DIR = `${FileSystem.documentDirectory}maps`;
const PREVIEWS_DIR = `${FileSystem.documentDirectory}previews`;
const EXPORT_DIR = `${FileSystem.documentDirectory}exports`;
const WEB_MAPS_BUCKET = "maps";
const WEB_PREVIEWS_BUCKET = "previews";
const WEB_EXPORTS_BUCKET = "exports";
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
  if (Platform.OS === "web") return;
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
  const targetUri =
    Platform.OS === "web"
      ? makeWebUri(WEB_MAPS_BUCKET, `${id}_${safeName}`)
      : `${MAPS_DIR}/${id}_${safeName}`;
  if (Platform.OS === "web") {
    const blob = await readAssetAsBlob(asset);
    if (!blob) {
      Alert.alert("Importfel", "Kunde inte läsa filen i webbläsaren.");
      return null;
    }
    await writeWebFileBlob(targetUri, blob);
  } else {
    await FileSystem.copyAsync({ from: asset.uri, to: targetUri });
  }
  const metadata = await extractGeoTiffMetadata(targetUri);
  const thumbnailUri = await generatePreviewFromGeoTiff(targetUri, id);

  return {
    id,
    name: asset.name.replace(/\.(tif|tiff)$/i, ""),
    importName: asset.name.replace(/\.(tif|tiff)$/i, ""),
    fileUri: targetUri,
    thumbnailUri: thumbnailUri ?? undefined,
    createdAt: new Date().toISOString(),
    bbox: metadata?.bbox ?? undefined,
    georef: metadata?.georef ?? undefined,
  };
}


export async function downloadAndImportGeoTiffFromUrl(url: string): Promise<MapItem | null> {
  await ensureDataDirs();
  const info = extractFileNameFromUrl(url);
  if (!info) return null;
  const ext = info.ext.toLowerCase();
  if (ext !== "tif" && ext !== "tiff") {
    return null;
  }
  const id = makeId("map");
  const safeName = sanitizeFileName(info.fileName);
  const targetUri =
    Platform.OS === "web"
      ? makeWebUri(WEB_MAPS_BUCKET, `${id}_${safeName}`)
      : `${MAPS_DIR}/${id}_${safeName}`;
  if (Platform.OS === "web") {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    await writeWebFileBlob(targetUri, blob);
  } else {
    await FileSystem.downloadAsync(url, targetUri);
  }
  const metadata = await extractGeoTiffMetadata(targetUri);
  const thumbnailUri = await generatePreviewFromGeoTiff(targetUri, id);
  return {
    id,
    name: info.baseName,
    importName: info.baseName,
    fileUri: targetUri,
    thumbnailUri: thumbnailUri ?? undefined,
    createdAt: new Date().toISOString(),
    bbox: metadata?.bbox ?? undefined,
    georef: metadata?.georef ?? undefined,
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
  if (hasNonLegacyBbox(map) && map.georef) {
    return map;
  }
  const metadata = await extractGeoTiffMetadata(map.fileUri);
  if (!metadata) {
    return map;
  }
  return { ...map, bbox: metadata.bbox, georef: metadata.georef };
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
  const targetUri =
    Platform.OS === "web"
      ? makeWebUri(WEB_PREVIEWS_BUCKET, `${mapId}_${safeName}`)
      : `${PREVIEWS_DIR}/${mapId}_${safeName}`;
  if (Platform.OS === "web") {
    const blob = await readAssetAsBlob(asset);
    if (!blob) return null;
    await writeWebFileBlob(targetUri, blob);
  } else {
    await FileSystem.copyAsync({ from: asset.uri, to: targetUri });
  }
  return targetUri;
}

export async function deleteIfExists(uri: string) {
  if (!uri) return;
  if (Platform.OS === "web" && isWebUri(uri)) {
    await deleteWebFile(uri);
    return;
  }
  const info = await FileSystem.getInfoAsync(uri);
  if (info.exists) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  }
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^\w\-.]/g, "_");
}

function extractFileNameFromUrl(url: string): { fileName: string; baseName: string; ext: string } | null {
  const raw = String(url ?? "");
  if (!raw) return null;
  let path = raw;
  try {
    const parsed = new URL(raw);
    path = parsed.pathname || raw;
  } catch {
    // Keep raw value if URL parsing fails.
  }
  const withoutQuery = path.split("?")[0]?.split("#")[0] ?? "";
  const fileName = withoutQuery.split("/").pop() ?? "";
  const dot = fileName.lastIndexOf(".");
  if (!fileName || dot <= 0 || dot === fileName.length - 1) return null;
  const ext = fileName.slice(dot + 1);
  const baseName = fileName.slice(0, dot);
  return { fileName, baseName, ext };
}


export function exportDir(): string {
  if (Platform.OS === "web") {
    return makeWebUri(WEB_EXPORTS_BUCKET, "");
  }
  return EXPORT_DIR;
}

async function generatePreviewFromGeoTiff(geoTiffUri: string, mapId: string): Promise<string | null> {
  try {
    const tiffBuffer = await readGeoTiffBuffer(geoTiffUri);
    if (!tiffBuffer) return null;
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
    const outUri =
      Platform.OS === "web"
        ? makeWebUri(WEB_PREVIEWS_BUCKET, `${mapId}_preview.png`)
        : `${PREVIEWS_DIR}/${mapId}_preview.png`;
    if (Platform.OS === "web") {
      const blob = new Blob([pngBytes], { type: "image/png" });
      await writeWebFileBlob(outUri, blob);
    } else {
      const pngBase64 = fromByteArray(pngBytes);
      await FileSystem.writeAsStringAsync(outUri, pngBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }
    return outUri;
  } catch {
    return null;
  }
}

async function extractGeoTiffMetadata(
  geoTiffUri: string
): Promise<{ bbox: MapItem["bbox"]; georef: NonNullable<MapItem["georef"]> } | null> {
  try {
    const tiffBuffer = await readGeoTiffBuffer(geoTiffUri);
    if (!tiffBuffer) return null;
    const ifds = UTIF.decode(tiffBuffer);
    if (!ifds.length) return null;

    const ifd = ifds[0] as Record<string, unknown>;
    const width = Number(ifd.width ?? ifd.t256 ?? 0);
    const height = Number(ifd.height ?? ifd.t257 ?? 0);
    if (width <= 0 || height <= 0) return null;

    const pixelToSource = makePixelToModelTransform(ifd, width, height);
    if (!pixelToSource) return null;
    const sourceEpsg = extractGeoEpsg(ifd);
    if (!sourceEpsg) return null;
    const srcCrs = `EPSG:${sourceEpsg}`;

    const cornersPx = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: 0, y: height },
      { x: width, y: height },
    ];
    const cornersWgs84 = cornersPx
      .map((p) => pixelToSource(p.x, p.y))
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
    return {
      bbox,
      georef: {
        sourceEpsg,
        imageWidth: width,
        imageHeight: height,
        pixelToSource: extractAffine(pixelToSource),
      },
    };
  } catch {
    return null;
  }
}

async function readGeoTiffBuffer(uri: string): Promise<ArrayBuffer | null> {
  if (Platform.OS === "web" && isWebUri(uri)) {
    return await readWebFileAsArrayBuffer(uri);
  }
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const tiffBytes = toByteArray(base64);
  return toArrayBuffer(tiffBytes);
}

async function readAssetAsBlob(asset: DocumentPicker.DocumentPickerAsset): Promise<Blob | null> {
  const file = (asset as DocumentPicker.DocumentPickerAsset & { file?: File }).file;
  if (file) return file;
  if (asset.uri) {
    const res = await fetch(asset.uri);
    if (!res.ok) return null;
    return await res.blob();
  }
  return null;
}

export async function readDocumentAssetAsText(asset: DocumentPicker.DocumentPickerAsset): Promise<string> {
  if (Platform.OS !== "web") {
    return await FileSystem.readAsStringAsync(asset.uri);
  }
  const file = (asset as DocumentPicker.DocumentPickerAsset & { file?: File }).file;
  if (file) return await file.text();
  if (asset.uri) {
    const res = await fetch(asset.uri);
    if (!res.ok) throw new Error("Kunde inte läsa filen.");
    return await res.text();
  }
  throw new Error("Kunde inte läsa filen.");
}

export async function resolveImageUri(uri?: string | null): Promise<string | null> {
  if (!uri) return null;
  if (Platform.OS === "web" && isWebUri(uri)) {
    return await getWebObjectUrl(uri);
  }
  return uri;
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

function extractGeoEpsg(ifd: Record<string, unknown>): number | null {
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
      return valueOffset;
    }
  }
  return null;
}

function extractAffine(
  fn: (x: number, y: number) => { x: number; y: number }
): { a: number; b: number; c: number; d: number; e: number; f: number } {
  const p00 = fn(0, 0);
  const p10 = fn(1, 0);
  const p01 = fn(0, 1);
  return {
    a: p10.x - p00.x,
    b: p01.x - p00.x,
    c: p00.x,
    d: p10.y - p00.y,
    e: p01.y - p00.y,
    f: p00.y,
  };
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
