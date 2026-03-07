import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as MailComposer from "expo-mail-composer";
import * as Sharing from "expo-sharing";
import * as WebBrowser from "expo-web-browser";
import JSZip from "jszip";
import { Observation, PointObservation } from "../types/models";
import { averageLatLon, wgs84ToSweref99tm } from "./coords";
import { exportDir } from "./files";
import { photoFileNameFromRef, resolvePointPhotoUri, sanitizeForFileName } from "./photos";

function escapeCsv(value: string): string {
  if (/[;"\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
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
  const header = "Artnamn\tLokalnamn\tStartdatum\tStarttid\tOst\tNord\tNoggrannhet";
  const rows = observations.map((obs) => {
    const coord = observationToRepresentativeWgs84(obs);
    const sweref = wgs84ToSweref99tm(coord.lon, coord.lat);
    const d = new Date(obs.dateISO);
    const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const localName = obs.kind === "point" ? obs.localName ?? "" : "";
    const accuracy = obs.kind === "point" && obs.accuracyMeters !== null ? String(obs.accuracyMeters) : "";
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
  const header =
    "Artnamn;Typ;Antal;Datum;Lat;Lon;SWEREF99TM_NordY;SWEREF99TM_OstX;Lokalnamn;Noggrannhet_m;Beskrivning;Foton";
  const rows = observations.map((obs) => {
    const rep = observationToRepresentativeWgs84(obs);
    const sweref = wgs84ToSweref99tm(rep.lon, rep.lat);
    const photos = obs.photoUris.map((name) => photoFileNameFromRef(name)).join("|");
    return [
      escapeCsv(obs.species),
      obs.kind,
      String(obs.count),
      new Date(obs.dateISO).toISOString(),
      formatNumberForExcel(rep.lat, 7),
      formatNumberForExcel(rep.lon, 7),
      formatNumberForExcel(sweref.y, 2),
      formatNumberForExcel(sweref.x, 2),
      escapeCsv(pointLocalName(obs)),
      pointAccuracy(obs),
      escapeCsv(obs.notes),
      escapeCsv(photos),
    ].join(";");
  });
  return ["sep=;", header, ...rows].join("\r\n");
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

export async function saveZipBundleAndShare(mapName: string, observations: Observation[]): Promise<string> {
  const dir = exportDir();
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  const zip = new JSZip();
  const safeMapName = sanitizeForFileName(mapName);
  const csv = buildCsv(observations);
  zip.file(`${safeMapName}.csv`, ensureUtf8Bom(csv));
  zip.file(`${safeMapName}.geojson`, buildGeoJson(mapName, observations));

  const uniquePhotos = collectPhotoRefs(observations);
  for (const photo of uniquePhotos) {
    const uri = await resolvePointPhotoUri(photo.fileName, photo.assetId);
    if (!uri) continue;
    try {
      const imageBase64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      zip.file(`bilder/${photo.fileName}`, imageBase64, { base64: true });
    } catch {
      // Continue even if a specific image no longer exists.
    }
  }

  const zipBase64 = await zip.generateAsync({ type: "base64" });
  const path = `${dir}/${safeMapName}.zip`;
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
  }
  return path;
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

function collectPhotoRefs(observations: Observation[]): Array<{ fileName: string; assetId?: string }> {
  const refs = new Map<string, { fileName: string; assetId?: string }>();
  observations.forEach((obs) => {
    if (obs.kind !== "point") return;
    obs.photoUris.forEach((fileName, index) => {
      const safeName = photoFileNameFromRef(String(fileName ?? "").trim());
      if (!safeName) return;
      if (!refs.has(safeName)) {
        refs.set(safeName, { fileName: safeName, assetId: obs.photoAssetIds?.[index] });
      }
    });
  });
  return Array.from(refs.values());
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
