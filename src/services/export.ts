import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import * as MailComposer from "expo-mail-composer";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import * as WebBrowser from "expo-web-browser";
import JSZip from "jszip";
import Papa from "papaparse";
import piexif from "piexifjs";
import { Image } from "react-native";
import { Observation, PointObservation } from "../types/models";
import { averageLatLon, wgs84ToSweref99tm } from "./coords";
import { exportDir } from "./files";
import { buildPointPhotoFileName, guessImageExtension, resolvePointPhotoUri, sanitizeForFileName } from "./photos";

function observationToRepresentativeWgs84(obs: Observation): { lat: number; lon: number } {
  if (obs.kind === "point") {
    return obs.wgs84;
  }
  return averageLatLon(obs.wgs84);
}

function pointLocalName(obs: Observation): string {
  return obs.kind === "point" ? obs.localName ?? "" : "";
}

function pointAccuracy(obs: Observation): string {
  return obs.kind === "point" && obs.accuracyMeters !== null ? String(obs.accuracyMeters) : "";
}

function toArtportalenNotes(obs: Observation): string {
  const parts: string[] = [];
  if (obs.notes.trim()) parts.push(obs.notes.trim());
  if (obs.kind === "point" && obs.localName.trim()) parts.push(`Lokal: ${obs.localName.trim()}`);
  if (obs.kind === "point" && obs.accuracyMeters !== null) {
    parts.push(`Noggrannhet: ${obs.accuracyMeters} m`);
  }
  return parts.join(" | ").replace(/[\t\r\n]+/g, " ");
}

export function buildArtportalenTsv(observations: Observation[]): string {
  const header = "Artnamn\tLokalnamn\tStartdatum\tStarttid\tOst\tNord\tNoggrannhet\tPublik kommentar\tAntal\tEnhet";
  
  // 1. Filtrera bort allt som inte är en punkt
  const pointsOnly = observations.filter((obs) => obs.kind === "point");

  // 2. Mappa endast de kvarvarande punkterna
  const rows = pointsOnly.map((obs) => {
    const coord = observationToRepresentativeWgs84(obs);
    const sweref = wgs84ToSweref99tm(coord.lon, coord.lat);
    const d = new Date(obs.dateISO);
    const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    
    // Vi vet nu att obs.kind är "point", så vi kan förenkla hämtningen
    const localName = obs.localName ?? "";
    const accuracy = obs.accuracyMeters !== null ? String(obs.accuracyMeters) : "";
    const east = String(Math.round(sweref.x));
    const north = String(Math.round(sweref.y));
    
    return [
      obs.species,
      localName,
      date,
      time,
      east,
      north,
      accuracy,
      obs.notes,
      (obs.quantity && obs.quantity !== 0) ? String(obs.quantity) : "", 
      obs.unit ?? ""
    ]
      .map((v) => String(v).replace(/[\t\r\n]+/g, " ").trim())
      .join("\t");
  });

  return [header, ...rows].join("\n");
}

export async function copyTsvAndOpenArtportalen(tsv: string) {
  await Clipboard.setStringAsync(tsv);
  await WebBrowser.openBrowserAsync("https://www.artportalen.se/ImportSighting");
}

export function buildCsv(observations: Observation[]): string {
  const fields = [
    "Artnamn",
    "Typ",
    "Datum",
    "Lat",
    "Lon",
    "Nord",
    "Ost",
    "Lokalnamn",
    "Noggrannhet",
    "Publik kommentar",
    "Antal",
    "Enhet",
    "Foton",
  ];
  let polygonCounter = 0;
  const data = observations.map((obs) => {
    if (obs.kind === "polygon") polygonCounter += 1;
    const label = observationLabel(obs, polygonCounter);
    const rep = observationToRepresentativeWgs84(obs);
    const sweref = wgs84ToSweref99tm(rep.lon, rep.lat);
    const photos = obs.photoUris
      .map((_, index) => buildPhotoFileName(label, obs.species, obs.dateISO, index, "jpg"))
      .filter((name) => name.length > 0)
      .join("|");
    const quantity = (obs.kind === "point" && obs.quantity && obs.quantity !== 0) ? String(obs.quantity) : "";
    const unit = obs.kind === "point" ? obs.unit : "";
    return [
      obs.species,
      obs.kind,
      new Date(obs.dateISO).toISOString(),
      formatNumberForExcel(rep.lat, 7),
      formatNumberForExcel(rep.lon, 7),
      formatNumberForExcel(sweref.y, 2),
      formatNumberForExcel(sweref.x, 2),
      pointLocalName(obs),
      pointAccuracy(obs),
      obs.notes,
      quantity,
      unit,
      photos,
    ];
  });
  const csvBody = Papa.unparse(
    {
      fields,
      data,
    },
    {
      delimiter: ";",
      newline: "\r\n",
      quotes: false,
      skipEmptyLines: false,
    }
  );
  return ensureUtf8Bom(`sep=;\r\n${csvBody}`);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export async function saveCsvAndShare(mapName: string, csv: string): Promise<string> {
  const path = await saveCsvFile(mapName, csv);
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(path, {
      mimeType: "text/csv",
      dialogTitle: "Dela exportfil",
    });
  }
  return path;
}

export async function saveCsvAndComposeEmail(
  mapName: string,
  csv: string
): Promise<{ path: string; opened: boolean }> {
  const path = await saveCsvFile(mapName, csv);
  const canEmail = await MailComposer.isAvailableAsync();
  if (!canEmail) {
    return { path, opened: false };
  }
  await MailComposer.composeAsync({
    subject: mapName,
    body: `CSV-export fran Faltkarta for kartan "${mapName}".`,
    attachments: [path],
  });
  return { path, opened: true };
}

export async function saveCsvGeoJsonAndMapAndComposeEmail(
  mapName: string,
  observations: Observation[],
  csv: string,
  mapFileUri?: string | null
): Promise<{ paths: string[]; opened: boolean }> {
  const csvPath = await saveCsvFile(mapName, csv);
  const canEmail = await MailComposer.isAvailableAsync();
  if (!canEmail) {
    const fallbackBundlePath = await saveEmailBundleZip(mapName, observations, csv, mapFileUri, exportDir());
    return { paths: [csvPath, fallbackBundlePath], opened: false };
  }
  const tempDir = await createExportSessionDir();
  try {
    const bundlePath = await saveEmailBundleZip(mapName, observations, csv, mapFileUri, tempDir);
    await MailComposer.composeAsync({
      subject: mapName,
      body: `Export fran Faltkarta for kartan "${mapName}" (ZIP med CSV, GeoJSON och GeoTIFF).`,
      attachments: [csvPath, bundlePath],
    });
    return { paths: [csvPath, bundlePath], opened: true };
  } finally {
    await cleanupExportSessionDir(tempDir);
  }
}

export async function saveZipBundleAndShare(
  mapName: string,
  observations: Observation[],
  mapFileUri?: string | null,
  maxImageSizeMB = 2
): Promise<{ shared: boolean }> {
  const dir = await createExportSessionDir();
  const zip = new JSZip();
  const safeMapName = sanitizeForFileName(mapName);
  const csv = buildCsv(observations);
  zip.file(`${safeMapName}.csv`, ensureUtf8Bom(csv));
  zip.file(`${safeMapName}.geojson`, buildGeoJson(mapName, observations));
  if (mapFileUri) {
    try {
      const mapBase64 = await FileSystem.readAsStringAsync(mapFileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const ext = mapFileUri.toLowerCase().endsWith(".tiff") ? "tiff" : "tif";
      zip.file(`${safeMapName}.${ext}`, mapBase64, { base64: true });
    } catch {
      // ...
    }
  }

  let polygonCounter = 0;
  for (const obs of observations) {
    if (obs.kind === "polygon") polygonCounter += 1;
    const label = observationLabel(obs, polygonCounter);
    for (let index = 0; index < obs.photoUris.length; index++) {
      const ref = String(obs.photoUris[index] ?? "").trim();
      if (!ref) continue;
      try {
        const assetId = obs.kind === "point" ? obs.photoAssetIds?.[index] : undefined;
        const optimized = await optimizePhotoForZip(ref, assetId, obs.dateISO, maxImageSizeMB);
        if (!optimized) continue;
        const fileName = buildPhotoFileName(label, obs.species, optimized.dateISO, index, optimized.extension);
        zip.file(`bilder/${fileName}`, optimized.base64, { base64: true });
      } catch {
        // Continue even if a specific image no longer exists.
      }
    }
  }

  const zipBase64 = await zip.generateAsync({ type: "base64" });
  const path = `${dir}${safeMapName}.zip`;
  let shared = false;
  try {
    await FileSystem.writeAsStringAsync(path, zipBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(path, {
        mimeType: "application/zip",
        dialogTitle: "Dela ZIP-export",
        UTI: "public.zip-archive",
      });
      shared = true;
    }
    return { shared };
  } finally {
    await cleanupExportSessionDir(dir);
  }
}

async function saveCsvFile(mapName: string, csv: string): Promise<string> {
  const dir = exportDir();
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  const path = `${dir}/${mapName.replace(/[^\w\-.]/g, "_")}.csv`;
  await FileSystem.writeAsStringAsync(path, ensureUtf8Bom(csv), {
    encoding: FileSystem.EncodingType.UTF8,
  });
  return path;
}

async function saveGeoJsonFile(mapName: string, observations: Observation[]): Promise<string> {
  const dir = exportDir();
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  const safeMapName = sanitizeForFileName(mapName);
  const path = `${dir}/${safeMapName}.geojson`;
  await FileSystem.writeAsStringAsync(path, buildGeoJson(mapName, observations), {
    encoding: FileSystem.EncodingType.UTF8,
  });
  return path;
}

async function saveEmailBundleZip(
  mapName: string,
  observations: Observation[],
  csv: string,
  mapFileUri: string | null | undefined,
  targetDir: string
): Promise<string> {
  const dirInfo = await FileSystem.getInfoAsync(targetDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true });
  }
  const safeMapName = sanitizeForFileName(mapName);
  const zip = new JSZip();
  zip.file(`${safeMapName}.csv`, ensureUtf8Bom(csv));
  zip.file(`${safeMapName}.geojson`, buildGeoJson(mapName, observations));

  if (mapFileUri) {
    try {
      const mapBase64 = await FileSystem.readAsStringAsync(mapFileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const ext = mapFileUri.toLowerCase().endsWith(".tiff") ? "tiff" : "tif";
      zip.file(`${safeMapName}.${ext}`, mapBase64, { base64: true });
    } catch {
      // Continue without GeoTIFF if file cannot be read.
    }
  }

  const zipBase64 = await zip.generateAsync({ type: "base64" });
  const path = `${targetDir}${safeMapName}_email.zip`;
  await FileSystem.writeAsStringAsync(path, zipBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}

function observationLabel(obs: Observation, polygonIndex: number): string {
  if (obs.kind === "point") {
    return String(obs.pointNumber ?? obs.id);
  }
  return `Polygon${polygonIndex}`;
}

function buildPhotoFileName(
  label: string,
  species: string,
  dateISO: string,
  index: number,
  extension: string
): string {
  return buildPointPhotoFileName(label, species, dateISO, index + 1, extension);
}

async function createExportSessionDir(): Promise<string> {
  const base = FileSystem.cacheDirectory ?? exportDir();
  const safeBase = base.endsWith("/") ? base : `${base}/`;
  const name = `export_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  const dir = `${safeBase}${name}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

async function cleanupExportSessionDir(dir: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(dir, { idempotent: true });
  } catch {
    // Ignore cleanup failures.
  }
}

async function optimizePhotoForZip(
  ref: string,
  assetId: string | undefined,
  fallbackDateISO: string,
  maxImageSizeMB: number
): Promise<{ base64: string; extension: string; dateISO: string } | null> {
  const uri = await resolvePointPhotoUri(ref, assetId);
  if (!uri) return null;
  const originalExt = guessImageExtension(uri);
  const shouldCopyExif = originalExt === "jpg" || originalExt === "jpeg";
  const originalBase64 = shouldCopyExif
    ? await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })
    : "";
  const assetDateISO = await resolveAssetDateISO(assetId);
  const exifDateISO = shouldCopyExif ? extractExifDateISO(originalBase64) : null;
  const dateISO = assetDateISO ?? exifDateISO ?? fallbackDateISO;
  const maxBytes = Math.max(0.2, maxImageSizeMB) * 1024 * 1024;
  const info = await FileSystem.getInfoAsync(uri, { size: true });
  const originalBytes = typeof info.size === "number" ? info.size : null;
  const size = await getImageSizeSafe(uri);
  const maxSide = size ? Math.max(size.width, size.height) : null;
  const actions: ImageManipulator.Action[] = [];
  if (maxSide && maxSide > 2000) {
    if (size && size.width >= size.height) {
      actions.push({ resize: { width: 2000 } });
    } else {
      actions.push({ resize: { height: 2000 } });
    }
  }
  const needsCompression = originalBytes !== null ? originalBytes > maxBytes : false;
  const compressionGuess = originalBytes !== null && originalBytes > 0
    ? Math.min(0.95, Math.max(0.2, maxBytes / originalBytes))
    : 1;
  const compress = needsCompression ? compressionGuess : 1;
  const result = await ImageManipulator.manipulateAsync(uri, actions, {
    compress,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });
  if (!result.base64) return null;
  const withExif = shouldCopyExif ? copyExifIntoJpeg(originalBase64, result.base64) : result.base64;
  return { base64: withExif, extension: "jpg", dateISO };
}

function copyExifIntoJpeg(originalBase64: string, resizedBase64: string): string {
  try {
    const exif = piexif.load(`data:image/jpeg;base64,${originalBase64}`);
    const exifBytes = piexif.dump(exif);
    const merged = piexif.insert(exifBytes, `data:image/jpeg;base64,${resizedBase64}`);
    return merged.replace(/^data:image\/jpeg;base64,/, "");
  } catch {
    return resizedBase64;
  }
}

async function resolveAssetDateISO(assetId?: string): Promise<string | null> {
  if (!assetId) return null;
  try {
    const info = await MediaLibrary.getAssetInfoAsync(assetId);
    const ts = info.creationTime ?? info.modificationTime;
    if (!ts) return null;
    const ms = ts > 1e12 ? ts : ts * 1000;
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

function extractExifDateISO(originalBase64: string): string | null {
  try {
    const exif = piexif.load(`data:image/jpeg;base64,${originalBase64}`);
    const raw =
      exif?.Exif?.DateTimeOriginal ||
      exif?.Exif?.DateTimeDigitized ||
      exif?.Image?.DateTime;
    if (!raw || typeof raw !== "string") return null;
    const match = raw.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!match) return null;
    const [, yyyy, mm, dd, hh, min, ss] = match;
    return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`;
  } catch {
    return null;
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
            await FileSystem.deleteAsync(fallback.uri, { idempotent: true });
          }
          resolve({ width: fallback.width, height: fallback.height });
        } catch {
          resolve(null);
        }
      }
    );
  });
}

function buildGeoJson(mapName: string, observations: Observation[]): string {
  let polygonCounter = 0;
  const features = observations.map((obs) => {
    if (obs.kind === "point") {
      return observationToGeoJsonFeature(mapName, obs, obs.pointNumber ? `Obs${obs.pointNumber}` : obs.id);
    }
    polygonCounter += 1;
    return observationToGeoJsonFeature(mapName, obs, `Polygon${polygonCounter}`);
  });
  return JSON.stringify(
    {
      type: "FeatureCollection",
      features,
    },
    null,
    2
  );
}

function observationToGeoJsonFeature(
  mapName: string,
  obs: Observation,
  publicId: string
): Record<string, unknown> {
  const baseProps: Record<string, unknown> = {
    id: publicId,
    mapName,
    kind: obs.kind,
    species: obs.species,
    count: obs.count,
    notes: obs.notes,
    dateISO: obs.dateISO,
    photos: obs.photoUris,
  };
  if (obs.kind === "point") {
    const point = obs as PointObservation;
    return {
      type: "Feature",
      properties: {
        ...baseProps,
        localName: point.localName,
        accuracyMeters: point.accuracyMeters,
        quantity: point.quantity,
        unit: point.unit,
      },
      geometry: {
        type: "Point",
        coordinates: [point.wgs84.lon, point.wgs84.lat],
      },
    };
  }
  const ring = obs.wgs84.map((p) => [p.lon, p.lat]);
  if (ring.length > 2) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
  }
  return {
    type: "Feature",
    properties: baseProps,
    geometry: {
      type: "Polygon",
      coordinates: [ring],  
    },
  };
}

function ensureUtf8Bom(value: string): string {
  return value.startsWith("\uFEFF") ? value : `\uFEFF${value}`;
}

function formatNumberForExcel(value: number, decimals: number): string {
  return value.toFixed(decimals).replace(".", ",");
}
