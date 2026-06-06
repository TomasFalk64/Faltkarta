import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import * as MailComposer from "expo-mail-composer";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import * as WebBrowser from "expo-web-browser";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import piexif from "piexifjs";
import { Alert, Image, Linking, Platform } from "react-native";
import { Observation, PointObservation } from "../types/models";
import { averageLatLon, wgs84ToSweref99tm } from "./coords";
import { exportDir } from "./files";
import { buildPointPhotoFileName, guessImageExtension, resolvePointPhotoUri, sanitizeForFileName } from "./photos";
import { speciesInfo } from "../data/species_info";


function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

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

function observationName(obs: Observation, polygonIndex: number): string {
  if (obs.kind === "point") {
    return obs.species;
  }
  const name = obs.polygonName?.trim();
  return name && name.length > 0 ? name : `Polygon${polygonIndex}`;
}

function getRedList(species: string): string {
  if (!species) return "";
  const direct = speciesInfo[species];
  if (direct?.redList) return String(direct.redList).trim();
  const lower = species.toLowerCase();
  for (const [name, info] of Object.entries(speciesInfo)) {
    if (name.toLowerCase() === lower && info?.redList) {
      return String(info.redList).trim();
    }
  }
  return "";
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

export function buildArtportalenTsv(
  observations: Observation[], 
  coordinateSystem: "SWEREF99" | "WGS84" = "SWEREF99"
): string {
  // Ändra rubrikerna för koordinaterna dynamiskt
  const coordLabel1 = coordinateSystem === "WGS84" ? "Lat" : "Ost";
  const coordLabel2 = coordinateSystem === "WGS84" ? "Lon" : "Nord";

  const header = `Artnamn\tLokalnamn\tStartdatum\tStarttid\t${coordLabel1}\t${coordLabel2}\tNoggrannhet\tPublik kommentar\tAntal\tEnhet\tArt som substrat\tAktivitet\tSubstrat\tÅlder-Stadium\tKön`;
  
  const pointsOnly = observations.filter((obs) => obs.kind === "point");

  const rows = pointsOnly.map((obs) => {
    const coord = observationToRepresentativeWgs84(obs);
    
    let val1 = "";
    let val2 = "";

    if (coordinateSystem === "WGS84") {
      // Artportalen vill ha punkt-decimaler för WGS84 (t.ex. 59.123456)
      val1 = coord.lat.toFixed(6);
      val2 = coord.lon.toFixed(6);
    } else {
      const sweref = wgs84ToSweref99tm(coord.lon, coord.lat);
      val1 = String(Math.round(sweref.x));
      val2 = String(Math.round(sweref.y));
    }

    const d = new Date(obs.dateISO);
    const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    
    const localName = obs.localName ?? "";
    const accuracy = obs.accuracyMeters !== null ? String(obs.accuracyMeters) : "";
    
    return [
      obs.species,
      localName,
      date,
      time,
      val1,
      val2,
      accuracy,
      obs.notes,
      (obs.quantity && obs.quantity !== 0) ? String(obs.quantity) : "", 
      obs.unit ?? "",
      obs.hostSpecies ?? "",
      obs.activity ?? "",
      obs.substrate ?? "",
      obs.stage ?? "",
      obs.gender ?? ""
    ]
      .map((v) => String(v).replace(/[\t\r\n]+/g, " ").trim())
      .join("\t");
  });

  return [header, ...rows].join("\n");
}

export async function copyTsvAndOpenArtportalen(tsv: string) {
  const url = "https://www.artportalen.se/ImportSighting";
  await Clipboard.setStringAsync(tsv);
  if (Platform.OS === "ios") {
    // iOS kan ibland tappa clipboard vid omedelbar app-vaxling, sa skriv igen efter kort delay.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await Clipboard.setStringAsync(tsv);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  try {
    if (Platform.OS === "ios") {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
        return;
      }
    }
    await WebBrowser.openBrowserAsync(url);
  } catch (error) {
    Alert.alert("Kunde inte öppna Artportalen", String(error));
  }
}

export function buildCsv(
  observations: Observation[], 
  coordinateSystem: "SWEREF99" | "WGS84" = "SWEREF99"
): string {
  const pointsOnly = observations.filter((obs) => obs.kind === "point");
  
  const coordLabel1 = coordinateSystem === "WGS84" ? "Lat" : "Ost";
  const coordLabel2 = coordinateSystem === "WGS84" ? "Lon" : "Nord";

  const fields = [
    "Artnamn",
    "Antal",
    "Enhet",
    "Lokalnamn",
    coordLabel1,
    coordLabel2,
    "Noggrannhet",
    "Startdatum",
    "Starttid",
    "Publik kommentar",
    "Biotop",
    "Art som substrat",
    "Substrat",
    "Substrat-beskrivning",
    "Aktivitet",
    // "Rödlistning",
  ];

  const data = pointsOnly.map((obs) => {
    const rep = observationToRepresentativeWgs84(obs);
    
    let coordVal1 = "";
    let coordVal2 = "";
    if (coordinateSystem === "WGS84") {
      coordVal1 = rep.lat.toFixed(6); // CSV hanterar oftast punkt bäst
      coordVal2 = rep.lon.toFixed(6);
    } else {
      const sweref = wgs84ToSweref99tm(rep.lon, rep.lat);
      coordVal1 = String(Math.round(sweref.x));
      coordVal2 = String(Math.round(sweref.y));
    }

    const d = new Date(obs.dateISO);
    const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const quantity = (obs.kind === "point" && obs.quantity && obs.quantity !== 0) ? String(obs.quantity) : "";
    const unit = obs.kind === "point" ? (obs.unit ?? "") : "";
    const species = obs.kind === "point" ? obs.species : "";
    const notes = obs.notes ?? "";
    // const redList = obs.kind === "point" ? getRedList(obs.species) : "";

    return [
      species,
      quantity,
      unit,
      pointLocalName(obs),
      coordVal1,
      coordVal2,
      pointAccuracy(obs),
      date,
      time,
      notes,
      "",
      "",
      "",
      "",
      "",
      // redList,
    ];
  });

  const csvBody = Papa.unparse(
    { fields, data },
    { delimiter: ";", newline: "\r\n", quotes: false, skipEmptyLines: false }
  );
  return ensureUtf8Bom(`sep=;\r\n${csvBody}`);
}

export function buildXlsx(observations: Observation[], 
  coordinateSystem: "SWEREF99" | "WGS84" = "SWEREF99"): string {
  const pointsOnly = observations.filter((obs) => obs.kind === "point");
  const coordLabel1 = coordinateSystem === "WGS84" ? "Lat" : "Ost";
  const coordLabel2 = coordinateSystem === "WGS84" ? "Lon" : "Nord";
  const fields = [
    "Artnamn",
    "Antal",
    "Enhet",
    "Lokalnamn",
    coordLabel1, // Blir Lat eller Ost
    coordLabel2,
    "Noggrannhet",
    "Startdatum",
    "Starttid",
    "Publik kommentar",
    "Biotop",
    "Art som substrat",
    "Substrat",
    "Substrat-beskrivning",
    "Aktivitet",
    "Ålder-Stadium",
    "Kön",
    //"Rödlistning",
  ];
  const data = pointsOnly.map((obs) => {
    const rep = observationToRepresentativeWgs84(obs);
    let coordVal1 = "";
    let coordVal2 = "";
    if (coordinateSystem === "WGS84") {
      coordVal1 = formatNumberForExcel(rep.lat, 6);
      coordVal2 = formatNumberForExcel(rep.lon, 6);
    } else {
      const sweref = wgs84ToSweref99tm(rep.lon, rep.lat);
      coordVal1 = String(Math.round(sweref.x));
      coordVal2 = String(Math.round(sweref.y));
    }
    const d = new Date(obs.dateISO);
    const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const quantity = (obs.kind === "point" && obs.quantity && obs.quantity !== 0) ? String(obs.quantity) : "";
    const unit = obs.kind === "point" ? (obs.unit ?? "") : "";
    const species = obs.kind === "point" ? obs.species : "";
    const notes = obs.notes ?? "";
    // const redList = obs.kind === "point" ? getRedList(obs.species) : "";
    return [
      species,
      quantity,
      unit,
      pointLocalName(obs),
      coordVal1,
      coordVal2,
      pointAccuracy(obs),
      date,
      time,
      notes,
      "",
      obs.hostSpecies ?? "",
      obs.substrate ?? "",
      "",
      obs.activity ?? "",
      obs.stage ?? "",
      obs.gender ?? "",
      // redList,
    ];
  });
  const worksheet = XLSX.utils.aoa_to_sheet([fields, ...data]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Export");
  return XLSX.write(workbook, { type: "base64", bookType: "xlsx" });
}

export async function saveXlsxAndShare(
  mapName: string,
  xlsxBase64: string
): Promise<{ xlsxPath: string; shared: boolean }> {
  const xlsxPath = await saveXlsxFile(mapName, xlsxBase64);
  const canShare = await Sharing.isAvailableAsync();
  let shared = false;
  if (canShare) {
    await Sharing.shareAsync(xlsxPath, {
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      dialogTitle: "Dela exportfil",
    });
    shared = true;
  }
  return { xlsxPath, shared };
}

export async function saveXlsxAndComposeEmail(
  mapName: string,
  xlsxBase64: string
): Promise<{ path: string; opened: boolean }> {
  const path = await saveXlsxFile(mapName, xlsxBase64);
  const canEmail = await MailComposer.isAvailableAsync();
  if (!canEmail) {
    return { path, opened: false };
  }
  await MailComposer.composeAsync({
    subject: mapName,
    body: `Excel-export fran Faltkarta for kartan "${mapName}".`,
    attachments: [path],
  });
  return { path, opened: true };
}

export async function saveXlsxGeoJsonAndMapAndComposeEmail(
  mapName: string,
  mapNotes: string,
  observations: Observation[],
  xlsxBase64: string,
  mapFileUri?: string | null
): Promise<{ paths: string[]; opened: boolean }> {
  const xlsxPath = await saveXlsxFile(mapName, xlsxBase64);
  const txtPath = await saveNotesTxtFile(mapName, mapNotes, observations);
  const canEmail = await MailComposer.isAvailableAsync();
  if (!canEmail) {
    const fallbackBundlePath = await saveEmailBundleZip(mapName, mapNotes, observations, mapFileUri, exportDir());
    return { paths: [xlsxPath, fallbackBundlePath], opened: false };
  }
  const tempDir = await createExportSessionDir();
  try {
    const bundlePath = await saveEmailBundleZip(mapName, mapNotes, observations, mapFileUri, tempDir);
    await MailComposer.composeAsync({
      subject: mapName,
      body: `Export fran Faltkarta for kartan "${mapName}" (Excel, Textfil, samt ZIP med GeoJSON och GeoTIFF).`,
      attachments: [xlsxPath, txtPath, bundlePath],
    });
    return { paths: [xlsxPath, bundlePath], opened: true };
  } finally {
    await cleanupExportSessionDir(tempDir);
  }
}

export async function saveZipBundleAndShare(
  mapName: string,
  mapNotes: string,
  observations: Observation[],
  mapFileUri?: string | null,
  maxImageSizeMB = 2,
  coordinateSystem: "SWEREF99" | "WGS84" = "SWEREF99"
): Promise<{ shared: boolean }> {
  const dir = await createExportSessionDir();
  const zip = new JSZip();
  const safeMapName = sanitizeForFileName(mapName);
  const xlsx = buildXlsx(observations, coordinateSystem);
  zip.file(`${safeMapName}.xlsx`, xlsx, { base64: true });
  zip.file(`${safeMapName}.geojson`, buildGeoJson(mapName, observations));
  zip.file(`${safeMapName}_anteckningar.txt`, buildNotesTxt(mapName, mapNotes, observations));
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
    const name = observationName(obs, polygonCounter);
    for (let index = 0; index < obs.photoUris.length; index++) {
      const ref = String(obs.photoUris[index] ?? "").trim();
      if (!ref) continue;
      try {
        const assetId = obs.kind === "point" ? obs.photoAssetIds?.[index] : undefined;
        const optimized = await optimizePhotoForZip(ref, assetId, obs.dateISO, maxImageSizeMB);
        if (!optimized) continue;
        const fileName = buildPhotoFileName(label, name, optimized.dateISO, index, optimized.extension);
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

async function saveXlsxFile(mapName: string, xlsxBase64: string): Promise<string> {
  const dir = exportDir();
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  const safeMapName = sanitizeForFileName(mapName);
  const path = `${dir}/${safeMapName}.xlsx`;
  await FileSystem.writeAsStringAsync(path, xlsxBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}

async function saveNotesTxtFile(mapName: string, mapNotes: string, observations: Observation[]): Promise<string> {
  const dir = exportDir();
  const safeMapName = sanitizeForFileName(mapName);
  const path = `${dir}/${safeMapName}_anteckningar.txt`;
  await FileSystem.writeAsStringAsync(path, buildNotesTxt(mapName, mapNotes, observations), {
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
  mapNotes: string,
  observations: Observation[],
  mapFileUri: string | null | undefined,
  targetDir: string
): Promise<string> {
  const dirInfo = await FileSystem.getInfoAsync(targetDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true });
  }
  const safeMapName = sanitizeForFileName(mapName);
  const zip = new JSZip();
  const xlsx = buildXlsx(observations);
  zip.file(`${safeMapName}.xlsx`, xlsx, { base64: true });
  zip.file(`${safeMapName}.geojson`, buildGeoJson(mapName, observations));
  zip.file(`${safeMapName}_anteckningar.txt`, buildNotesTxt(mapName, mapNotes, observations));
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
  const name = obs.polygonName?.trim();
  return name && name.length > 0 ? name : `Polygon${polygonIndex}`;
}

function buildPhotoFileName(
  label: string,
  name: string,
  dateISO: string,
  index: number,
  extension: string
): string {
  return buildPointPhotoFileName(label, name, dateISO, index + 1, extension);
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
  const info = await FileSystem.getInfoAsync(uri, { size: true } as any);
  const originalBytes =
    info && "size" in info && typeof (info as { size?: number }).size === "number"
      ? (info as { size?: number }).size ?? null
      : null;
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
    const name = observationName(obs, polygonCounter);
    return observationToGeoJsonFeature(mapName, obs, name);
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
        species: point.species,
        redList: getRedList(point.species),
        localName: point.localName,
        accuracyMeters: point.accuracyMeters,
        quantity: point.quantity,
        unit: point.unit,
        hostSpecies: point.hostSpecies ?? "",
        activity: point.activity ?? "",
        substrate: point.substrate ?? "",
        stage: point.stage ?? "",
        gender: point.gender ?? "",
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
    properties: {
      ...baseProps,
      polygonName: obs.polygonName,
    },
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

export function buildNotesTxt(
  mapTitle: string, 
  mapNotes: string, // Vi lägger till kartans egna anteckning här!
  observations: Observation[]
): string {
  const lines: string[] = [];
  lines.push(`INFORMATION OCH ANTECKNINGAR FÖR KARTA: ${mapTitle}`);
  lines.push(`Datum för export: ${new Date().toLocaleDateString("sv-SE")}`);
  lines.push(`Antal observationer: ${observations.length}`);
  lines.push(` `);
  
  // Här hamnar kartans övergripande anteckning, direkt i huvudet!
  lines.push(`KARTANTECKNING:`);
  lines.push(mapNotes.trim() || "(Ingen övergripande anteckning finns för denna karta)");
  lines.push(` \n`);

  // Objekt för att hålla reda på artstatistiken
  const speciesSummary: Record<string, { observationsCount: number; totalQuantity: number; unit?: string }> = {};

  // Loopa igenom för att samla ihop arterna till listan
  observations.forEach((obs) => {
    if (obs.kind === "point" && obs.species) {
      if (!speciesSummary[obs.species]) {
        speciesSummary[obs.species] = { observationsCount: 0, totalQuantity: 0, unit: obs.unit };
      }
      speciesSummary[obs.species].observationsCount += 1;
      if (obs.quantity && obs.quantity > 0) {
        speciesSummary[obs.species].totalQuantity += obs.quantity;
      }
    }
  });

  lines.push(`SAMMANSTÄLLNING: ANTAL PER ART`);

  const speciesNames = Object.keys(speciesSummary).sort();
  
  if (speciesNames.length === 0) {
    lines.push(`Inga artobservationer registrerade på denna karta.`);
  } else {
    speciesNames.forEach((species) => {
      const stats = speciesSummary[species];
      const paddedSpecies = species.padEnd(30, " ");
      lines.push(`${paddedSpecies}: ${stats.observationsCount} st fyndplatser`);
    });
  }
  
  return lines.join("\r\n");
}
