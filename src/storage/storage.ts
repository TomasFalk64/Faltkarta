import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppSettings, MapItem, Observation } from "../types/models";
import { getSafeUri, toStoredMapPath } from "../services/mapPaths";

const MAPS_KEY = "maps:v1";
const OBS_KEY = "observations:v1";
const SETTINGS_KEY = "settings:v1";
const USER_SPECIES_KEY = "userSpecies.json";
const MAX_SIDE_SETTING_KEY = "maxSideSetting:v1";
const DEFAULT_MAX_SIDE = 1400;

export async function loadMaps(): Promise<MapItem[]> {
  const raw = await AsyncStorage.getItem(MAPS_KEY);
  if (!raw) {
    return [];
  }
  const parsed = JSON.parse(raw) as MapItem[];
  return parsed.map(normalizeMapForUse);
}

export async function saveMaps(maps: MapItem[]) {
  await AsyncStorage.setItem(MAPS_KEY, JSON.stringify(maps.map(normalizeMapForStorage)));
}

export async function upsertMap(item: MapItem): Promise<MapItem[]> {
  const all = await loadMaps();
  const normalizedItem = normalizeMapForUse(item);
  const idx = all.findIndex((m) => m.id === item.id);
  if (idx >= 0) {
    all[idx] = normalizedItem;
  } else {
    all.unshift(normalizedItem);
  }
  await saveMaps(all);
  return all;
}

export async function renameMapAndSyncPointLocalNames(
  item: MapItem,
  previousName: string
): Promise<MapItem[]> {
  const nextMaps = await upsertMap(item);
  const byMap = await loadObservationsByMapId();
  const list = byMap[item.id] ?? [];
  let didChange = false;
  const normalizedPreviousName = previousName.trim().toLowerCase();

  byMap[item.id] = list.map((obs) => {
    const normalizedLocalName = obs.kind === "point" ? obs.localName.trim().toLowerCase() : "";
    if (obs.kind !== "point" || normalizedLocalName !== normalizedPreviousName) {
      return obs;
    }
    didChange = true;
    return normalizeObservation({
      ...obs,
      localName: item.title,
    });
  });

  if (didChange) {
    await saveObservationsByMapId(byMap);
  }

  return nextMaps;
}

export async function removeMap(mapId: string): Promise<MapItem[]> {
  const all = await loadMaps();
  const next = all.filter((m) => m.id !== mapId);
  await saveMaps(next);
  const byMap = await loadObservationsByMapId();
  delete byMap[mapId];
  await saveObservationsByMapId(byMap);
  return next;
}

export async function loadObservationsByMapId(): Promise<Record<string, Observation[]>> {
  const raw = await AsyncStorage.getItem(OBS_KEY);
  if (!raw) {
    return {};
  }
  const parsed = JSON.parse(raw) as Record<string, Observation[]>;
  return Object.fromEntries(
    Object.entries(parsed).map(([mapId, list]) => [mapId, list.map(normalizeObservation)])
  );
}

export async function saveObservationsByMapId(value: Record<string, Observation[]>) {
  await AsyncStorage.setItem(OBS_KEY, JSON.stringify(value));
}

export async function loadObservationsForMap(mapId: string): Promise<Observation[]> {
  const byMap = await loadObservationsByMapId();
  return (byMap[mapId] ?? []).map(normalizeObservation);
}

export async function addObservation(obs: Observation): Promise<Observation[]> {
  const byMap = await loadObservationsByMapId();
  const list = byMap[obs.mapId] ?? [];
  const next = [normalizeObservation(obs), ...list.map(normalizeObservation)];
  byMap[obs.mapId] = next;
  await saveObservationsByMapId(byMap);
  return next;
}

export async function updateObservation(updated: Observation): Promise<Observation[]> {
  const byMap = await loadObservationsByMapId();
  const list = byMap[updated.mapId] ?? [];
  const normalizedUpdated = normalizeObservation(updated);
  const next = list.map((obs) => (obs.id === updated.id ? normalizedUpdated : normalizeObservation(obs)));
  byMap[updated.mapId] = next;
  await saveObservationsByMapId(byMap);
  return next;
}

export async function deleteObservation(mapId: string, observationId: string): Promise<Observation[]> {
  const byMap = await loadObservationsByMapId();
  const list = byMap[mapId] ?? [];
  const next = list.filter((obs) => obs.id !== observationId);
  byMap[mapId] = next;
  await saveObservationsByMapId(byMap);
  return next;
}

function normalizeObservation(obs: Observation): Observation {
  if (obs.kind !== "point") return obs;
  const photoNames = (obs.photoUris ?? []).map((value) => String(value ?? ""));
  const photoAssetIds = (obs.photoAssetIds ?? []).map((value) => String(value ?? ""));
  return {
    ...obs,
    photoUris: photoNames,
    pointNumber: typeof obs.pointNumber === "number" && Number.isFinite(obs.pointNumber) ? obs.pointNumber : undefined,
    localName: obs.localName ?? "",
    accuracyMeters: obs.accuracyMeters ?? null,
    photoAssetIds: photoAssetIds.length ? photoAssetIds : undefined,
  };
}

export async function loadSettings(): Promise<AppSettings> {
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    // Returnera standardvärden för båda inställningarna
    return {
      gpsPingSeconds: 3,
      showQuantityField: false,
      visibleFields: {
        quantity: false,
        unit: false,
        hostSpecies: false,
        activity: false,
        substrate: false,
        stage: false,
        gender: false,
      },
      maxImageSizeMB: 3,
      backgroundGPS: false,
      autoFollow: false,
      coordinateSystem: "SWEREF99",
      mapSortMode: "ALPHA",
      mapSortAnchor: undefined,
    };
  }
  const parsed = JSON.parse(raw) as Partial<AppSettings>;
  return {
    gpsPingSeconds: parsed.gpsPingSeconds ?? 3,
    showQuantityField: parsed.showQuantityField ?? false,
    visibleFields: parsed.visibleFields ?? {
      quantity: false,
      unit: false,
      hostSpecies: false,
      activity: false,
      substrate: false,
      stage: false,
      gender: false,
    },
    maxImageSizeMB: parsed.maxImageSizeMB ?? 2,
    backgroundGPS: parsed.backgroundGPS ?? false,
    autoFollow: parsed.autoFollow ?? false,
    coordinateSystem: parsed.coordinateSystem === "WGS84" ? "WGS84" : "SWEREF99",
    mapSortMode:
      parsed.mapSortMode === "ALPHA" || parsed.mapSortMode === "NEAREST" ? parsed.mapSortMode : "ALPHA",
    mapSortAnchor:
      parsed.mapSortAnchor &&
      Number.isFinite(parsed.mapSortAnchor.lat) &&
      Number.isFinite(parsed.mapSortAnchor.lon)
        ? parsed.mapSortAnchor
        : undefined,
  };
}

function normalizeMapForStorage(item: MapItem): MapItem {
  const title = String(item.title ?? item.name ?? "").trim();
  const fileName = toStoredMapPath(item.fileName ?? item.fileUri ?? "");
  const previewFileName = item.previewFileName
    ? toStoredMapPath(item.previewFileName)
    : item.thumbnailUri
      ? toStoredMapPath(item.thumbnailUri)
      : undefined;
  return {
    ...item,
    title,
    fileName,
    previewFileName,
    name: undefined,
    fileUri: undefined,
    thumbnailUri: undefined,
  };
}

function normalizeMapForUse(item: MapItem): MapItem {
  const title = String(item.title ?? item.name ?? "").trim();
  const fileName = toStoredMapPath(item.fileName ?? item.fileUri ?? "");
  const previewFileName = item.previewFileName
    ? toStoredMapPath(item.previewFileName)
    : item.thumbnailUri
      ? toStoredMapPath(item.thumbnailUri)
      : undefined;
  return {
    ...item,
    title,
    fileName,
    previewFileName,
    // Keep resolved legacy aliases in-memory for old callsites.
    name: title,
    fileUri: getSafeUri(fileName, "map"),
    thumbnailUri: previewFileName ? getSafeUri(previewFileName, "preview") : undefined,
  };
}

export async function saveSettings(settings: AppSettings) {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function loadUserSpecies(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(USER_SPECIES_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as string[];
  return parsed.map((v) => String(v ?? "").trim()).filter((v) => v.length > 0);
}

export async function addUserSpecies(value: string): Promise<string[]> {
  const name = String(value ?? "").trim();
  if (!name) return await loadUserSpecies();
  const list = await loadUserSpecies();
  const exists = list.some((item) => item.toLowerCase() === name.toLowerCase());
  if (exists) return list;
  const next = [...list, name];
  await AsyncStorage.setItem(USER_SPECIES_KEY, JSON.stringify(next));
  return next;
}

export async function removeUserSpecies(value: string): Promise<string[]> {
  const name = String(value ?? "").trim();
  if (!name) return await loadUserSpecies();
  const list = await loadUserSpecies();
  const next = list.filter((item) => item.toLowerCase() !== name.toLowerCase());
  await AsyncStorage.setItem(USER_SPECIES_KEY, JSON.stringify(next));
  return next;
}

function clampMaxSideSetting(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_SIDE;
  return Math.min(4000, Math.max(1000, Math.round(value)));
}

export async function saveMaxSideSetting(value: number) {
  const clamped = clampMaxSideSetting(value);
  await AsyncStorage.setItem(MAX_SIDE_SETTING_KEY, String(clamped));
}

export async function getMaxSideSetting(): Promise<number> {
  const raw = await AsyncStorage.getItem(MAX_SIDE_SETTING_KEY);
  if (!raw) return DEFAULT_MAX_SIDE;
  const parsed = Number.parseInt(raw, 10);
  return clampMaxSideSetting(parsed);
}
