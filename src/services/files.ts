import * as FileSystem from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import { Alert } from "react-native";
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
    type: ["image/tiff", "application/octet-stream", "*/*"],
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

  return {
    id,
    name: asset.name.replace(/\.(tif|tiff)$/i, ""),
    fileUri: targetUri,
    createdAt: new Date().toISOString(),
    bbox: {
      minLat: 55.0,
      minLon: 11.0,
      maxLat: 69.5,
      maxLon: 24.2,
    },
  };
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
