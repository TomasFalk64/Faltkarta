import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as WebBrowser from "expo-web-browser";
import { Observation } from "../types/models";
import { averageLatLon, wgs84ToSweref99tm } from "./coords";
import { exportDir } from "./files";

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) {
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

export function buildArtportalenTsv(observations: Observation[]): string {
  return observations
    .map((obs) => {
      const coord = observationToRepresentativeWgs84(obs);
      const sweref = wgs84ToSweref99tm(coord.lon, coord.lat);
      const date = new Date(obs.dateISO).toISOString().slice(0, 10);
      return `${obs.species}\t${sweref.y.toFixed(2)}\t${sweref.x.toFixed(2)}\t${date}\t${obs.notes}`;
    })
    .join("\n");
}

export async function copyTsvAndOpenArtportalen(tsv: string) {
  await Clipboard.setStringAsync(tsv);
  await WebBrowser.openBrowserAsync("https://www.artportalen.se/");
}

export function buildCsv(observations: Observation[]): string {
  const header =
    "Artnamn,Typ,Antal,Datum,Lat,Lon,SWEREF99TM_NordY,SWEREF99TM_OstX,Beskrivning,Foton";
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
      escapeCsv(obs.notes),
      escapeCsv(photos),
    ].join(",");
  });
  return [header, ...rows].join("\n");
}

export async function saveCsvAndShare(mapName: string, csv: string): Promise<string> {
  const dir = exportDir();
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  const path = `${dir}/${mapName.replace(/[^\w\-.]/g, "_")}_${Date.now()}.csv`;
  await FileSystem.writeAsStringAsync(path, csv, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(path, {
      mimeType: "text/csv",
      dialogTitle: "Dela exportfil",
      UTI: "public.comma-separated-values-text",
    });
  }
  return path;
}
