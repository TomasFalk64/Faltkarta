import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as MailComposer from "expo-mail-composer";
import * as Sharing from "expo-sharing";
import * as WebBrowser from "expo-web-browser";
import { fromByteArray } from "base64-js";
import { Observation } from "../types/models";
import { averageLatLon, wgs84ToSweref99tm } from "./coords";
import { exportDir } from "./files";

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
    const photos = obs.photoUris.join("|");
    return [
      escapeCsv(obs.species),
      obs.kind,
      String(obs.count),
      new Date(obs.dateISO).toISOString(),
      rep.lat.toFixed(7),
      rep.lon.toFixed(7),
      sweref.y.toFixed(2),
      sweref.x.toFixed(2),
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

async function saveCsvFile(mapName: string, csv: string): Promise<string> {
  const dir = exportDir();
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  const path = `${dir}/${mapName.replace(/[^\w\-.]/g, "_")}_${Date.now()}.csv`;
  const utf16 = toUtf16LeWithBom(csv);
  await FileSystem.writeAsStringAsync(path, fromByteArray(utf16), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}

function toUtf16LeWithBom(value: string): Uint8Array {
  const out = new Uint8Array(2 + value.length * 2);
  // UTF-16 LE BOM
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const idx = 2 + i * 2;
    out[idx] = code & 0xff;
    out[idx + 1] = (code >> 8) & 0xff;
  }
  return out;
}
