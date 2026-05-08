import * as FileSystem from "expo-file-system/legacy";

const MAPS_DIR = `${FileSystem.documentDirectory}maps/`;
const PREVIEWS_DIR = `${FileSystem.documentDirectory}previews/`;

function extractFileName(savedPath: string): string {
  const raw = String(savedPath ?? "").trim();
  if (!raw) return "";
  const withoutQuery = raw.split("?")[0]?.split("#")[0] ?? "";
  return withoutQuery.split("/").pop() ?? "";
}

export function toStoredMapPath(savedPath: string): string {
  return extractFileName(savedPath);
}

export function getSafeUri(savedPath: string | undefined, kind: "map" | "preview" = "map"): string {
  if (!savedPath) return "";
  const fileName = extractFileName(savedPath);
  if (!fileName) return "";
  const baseDir = kind === "preview" ? PREVIEWS_DIR : MAPS_DIR;
  return `${baseDir}${fileName}`;
}
