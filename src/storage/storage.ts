import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppSettings, MapItem, Observation, ObservationPhoto } from "../types/models";
import { getSafeUri, toStoredMapPath } from "../services/mapPaths";
import { buildPhotoFileName, buildPointPhotoFileName } from "../services/photoUtils";
import {
  deleteLocalPhotoFiles,
  getFileSize,
  guessImageExtension,
  isMapPhotoUri,
  mapPhotosDir,
  photoFileNameFromRef,
  removeMapPhotosDir,
  resolvePointPhotoUri,
} from "../services/photos";

const MAPS_KEY = "maps:v1";
const OBS_KEY = "observations:v1";
const OBS_MIGRATION_KEY = "observations:perMapMigration:v1";
const OBS_MAP_KEY_PREFIX = "observations:map:v1:";
const OBS_COUNTS_KEY = "observationCounts:v1";
const SETTINGS_KEY = "settings:v1";
const USER_SPECIES_KEY = "userSpecies.json";
const USER_SPECIES_GROUPS_KEY = "ownSpeciesGroups:v1";
const AREA_DESCRIPTION_KEY = "mapAreaDescriptions:v1";
const MAX_SIDE_SETTING_KEY = "maxSideSetting:v1";
const OBS_SIZE_WARNINGS_KEY = "observationSizeWarnings:v1";
const DEFAULT_MAX_SIDE = 1400;
const OBS_SIZE_FIRST_WARNING_BYTES = 750 * 1024;
const OBS_SIZE_SECOND_WARNING_BYTES = 1024 * 1024;

export type ObservationSizeWarning = {
  level: 1 | 2;
  sizeBytes: number;
  observationCount: number;
};

let observationMigrationPromise: Promise<void> | null = null;

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
  const list = await loadObservationsForMap(item.id);
  let didChange = false;
  const normalizedPreviousName = previousName.trim().toLowerCase();

  const nextObservations = list.map((obs) => {
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
    await saveObservationsForMap(item.id, nextObservations);
  }

  return nextMaps;
}

export async function removeMap(mapId: string): Promise<MapItem[]> {
  const all = await loadMaps();
  const next = all.filter((m) => m.id !== mapId);
  await saveMaps(next);
  await removeObservationsForMap(mapId);
  await removeAreaDescription(mapId);
  await removeMapPhotosDir(mapId);
  return next;
}

export async function loadAreaDescriptions(): Promise<Record<string, string>> {
  const raw = await AsyncStorage.getItem(AREA_DESCRIPTION_KEY);
  if (!raw) return {};
  const parsed = JSON.parse(raw) as Record<string, string>;
  return Object.fromEntries(
    Object.entries(parsed)
      .map(([mapId, description]) => [String(mapId ?? "").trim(), String(description ?? "").trim()])
      .filter(([mapId]) => mapId.length > 0)
  );
}

export async function saveAreaDescription(mapId: string, description: string): Promise<Record<string, string>> {
  const key = String(mapId ?? "").trim();
  if (!key) return await loadAreaDescriptions();
  const current = await loadAreaDescriptions();
  const next = { ...current, [key]: String(description ?? "").trim() };
  await AsyncStorage.setItem(AREA_DESCRIPTION_KEY, JSON.stringify(next));
  return next;
}

export async function removeAreaDescription(mapId: string): Promise<Record<string, string>> {
  const key = String(mapId ?? "").trim();
  if (!key) return await loadAreaDescriptions();
  const current = await loadAreaDescriptions();
  const next = Object.fromEntries(Object.entries(current).filter(([id]) => id !== key));
  await AsyncStorage.setItem(AREA_DESCRIPTION_KEY, JSON.stringify(next));
  return next;
}

export async function loadObservationsByMapId(): Promise<Record<string, Observation[]>> {
  await ensureObservationStorageMigrated();
  const keys = await observationMapKeys();
  if (!keys.length) return {};
  const pairs = await AsyncStorage.multiGet(keys);
  return Object.fromEntries(
    pairs
      .map(([key, raw]) => [mapIdFromObservationMapKey(key), parseObservationList(raw)] as const)
      .filter(([mapId]) => mapId.length > 0)
  );
}

export async function saveObservationsByMapId(value: Record<string, Observation[]>) {
  await ensureObservationStorageMigrated();
  const normalizedEntries = Object.entries(value).map(([mapId, list]) => [
    observationMapKey(mapId),
    JSON.stringify(list.map(normalizeObservation)),
  ] as const);
  const keys = await observationMapKeys();
  const incomingKeys = new Set(normalizedEntries.map(([key]) => key));
  const keysToRemove = keys.filter((key) => !incomingKeys.has(key));
  if (normalizedEntries.length) {
    await AsyncStorage.multiSet(normalizedEntries);
  }
  if (keysToRemove.length) {
    await AsyncStorage.multiRemove(keysToRemove);
  }
  await saveObservationCountsFromEntries(value);
}

export async function loadObservationsForMap(mapId: string): Promise<Observation[]> {
  await ensureObservationStorageMigrated();
  const raw = await AsyncStorage.getItem(observationMapKey(mapId));
  return parseObservationList(raw);
}

export async function loadObservationCounts(): Promise<Record<string, number>> {
  await ensureObservationStorageMigrated();
  const raw = await AsyncStorage.getItem(OBS_COUNTS_KEY);
  if (!raw) {
    const byMap = await loadObservationsByMapId();
    const counts = countsFromObservationsByMap(byMap);
    await AsyncStorage.setItem(OBS_COUNTS_KEY, JSON.stringify(counts));
    return counts;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, number>;
    const entries: Array<[string, number]> = Object.entries(parsed)
      .map(([mapId, count]) => [String(mapId), Number(count)]);
    return Object.fromEntries(
      entries.filter(([mapId, count]) => mapId.length > 0 && Number.isFinite(count))
    );
  } catch {
    return {};
  }
}

export async function addObservation(obs: Observation): Promise<Observation[]> {
  const list = await loadObservationsForMap(obs.mapId);
  const next = [normalizeObservation(obs), ...list.map(normalizeObservation)];
  await saveObservationsForMap(obs.mapId, next);
  return next;
}

export async function updateObservation(updated: Observation): Promise<Observation[]> {
  const list = await loadObservationsForMap(updated.mapId);
  const normalizedUpdated = normalizeObservation(updated);
  const previous = list.find((obs) => obs.id === updated.id);
  const next = list.map((obs) => (obs.id === updated.id ? normalizedUpdated : normalizeObservation(obs)));
  await saveObservationsForMap(updated.mapId, next);
  if (previous?.photos?.length) {
    const nextLocalUris = new Set(normalizedUpdated.photos?.map((photo) => photo.localUri).filter(Boolean));
    const removed = previous.photos.filter((photo) => photo.localUri && !nextLocalUris.has(photo.localUri));
    const byMap = await loadObservationsByMapId();
    await deleteLocalPhotoFiles(removed.filter((photo) => !isPhotoReferenced(byMap, photo.localUri)));
  }
  return next;
}

export async function deleteObservation(mapId: string, observationId: string): Promise<Observation[]> {
  const list = await loadObservationsForMap(mapId);
  const deleted = list.find((obs) => obs.id === observationId);
  const next = list.filter((obs) => obs.id !== observationId);
  await saveObservationsForMap(mapId, next);
  if (deleted?.photos?.length) {
    const byMap = await loadObservationsByMapId();
    await deleteLocalPhotoFiles(deleted.photos.filter((photo) => !isPhotoReferenced(byMap, photo.localUri)));
  }
  return next;
}

export async function discardExportedCompressedPhotos(mapId: string): Promise<Observation[]> {
  const list = await loadObservationsForMap(mapId);
  const photosToDelete: ObservationPhoto[] = [];
  let didChange = false;
  const next = list.map((obs) => {
    const photos = (obs.photos ?? []).map((photo) => {
      const localUri = String(photo.localUri ?? "").trim();
      if (!localUri || !isMapPhotoUri(localUri, mapId) || !hasPhotoRebuildSource(photo, mapId)) {
        return photo;
      }
      didChange = true;
      photosToDelete.push(photo);
      return {
        ...photo,
        localUri: undefined,
        status: "failed" as const,
      };
    });
    if (photos === obs.photos) return obs;
    const photoUris = photos.map((photo) => photo.localUri ?? photo.originalUri ?? "");
    if (obs.kind !== "point") {
      return {
        ...obs,
        photos,
        photoUris,
      };
    }
    const photoAssetIds = photos.map((photo) => photo.assetId ?? "");
    const hasAnyAssetId = photoAssetIds.some((id) => id.trim().length > 0);
    return {
      ...obs,
      photos,
      photoUris,
      photoAssetIds: hasAnyAssetId ? photoAssetIds : undefined,
    };
  });
  if (!didChange) return list;
  await saveObservationsForMap(mapId, next);
  await deleteLocalPhotoFiles(photosToDelete.filter((photo) => !isPhotoReferenced({ [mapId]: next }, photo.localUri)));
  return next;
}

export async function prependObservationsForMap(mapId: string, observations: Observation[]): Promise<Observation[]> {
  const current = await loadObservationsForMap(mapId);
  const next = [...observations.map(normalizeObservation), ...current];
  await saveObservationsForMap(mapId, next);
  return next;
}

export async function consumeObservationSizeWarning(
  mapId: string,
  observations: Observation[]
): Promise<ObservationSizeWarning | null> {
  const normalized = observations.map(normalizeObservation);
  const sizeBytes = utf8ByteLength(JSON.stringify(normalized));
  const level = sizeBytes >= OBS_SIZE_SECOND_WARNING_BYTES
    ? 2
    : sizeBytes >= OBS_SIZE_FIRST_WARNING_BYTES
      ? 1
      : 0;
  if (level === 0) return null;

  const shown = await loadObservationSizeWarnings();
  const previousLevel = shown[mapId] ?? 0;
  if (previousLevel >= level) return null;

  await saveObservationSizeWarnings({
    ...shown,
    [mapId]: level,
  });
  return {
    level,
    sizeBytes,
    observationCount: normalized.length,
  };
}

async function saveObservationsForMap(mapId: string, observations: Observation[]): Promise<void> {
  await ensureObservationStorageMigrated();
  const normalized = observations.map(normalizeObservation);
  await AsyncStorage.setItem(observationMapKey(mapId), JSON.stringify(normalized));
  await updateObservationCount(mapId, normalized.length);
}

async function removeObservationsForMap(mapId: string): Promise<void> {
  await ensureObservationStorageMigrated();
  await AsyncStorage.removeItem(observationMapKey(mapId));
  await updateObservationCount(mapId, 0);
  const warnings = await loadObservationSizeWarnings();
  if (warnings[mapId] !== undefined) {
    const next = { ...warnings };
    delete next[mapId];
    await saveObservationSizeWarnings(next);
  }
}

async function ensureObservationStorageMigrated(): Promise<void> {
  if (observationMigrationPromise) {
    return observationMigrationPromise;
  }
  observationMigrationPromise = migrateObservationStorageIfNeeded().finally(() => {
    observationMigrationPromise = null;
  });
  return observationMigrationPromise;
}

async function migrateObservationStorageIfNeeded(): Promise<void> {
  const migrated = await AsyncStorage.getItem(OBS_MIGRATION_KEY);
  if (migrated === "true") return;

  const raw = await AsyncStorage.getItem(OBS_KEY);
  if (!raw) {
    await AsyncStorage.multiSet([
      [OBS_COUNTS_KEY, JSON.stringify({})],
      [OBS_MIGRATION_KEY, "true"],
    ]);
    return;
  }

  const parsed = JSON.parse(raw) as Record<string, Observation[]>;
  const byMap: Record<string, Observation[]> = {};
  for (const [mapId, list] of Object.entries(parsed)) {
    const normalizedMapId = String(mapId);
    byMap[normalizedMapId] = Array.isArray(list)
      ? await Promise.all(list.map((obs) => normalizeObservationForMigration(obs)))
      : [];
  }
  const entries = Object.entries(byMap);
  if (entries.length) {
    await AsyncStorage.multiSet(
      entries.map(([mapId, list]) => [observationMapKey(mapId), JSON.stringify(list)])
    );
  }

  const verifyPairs = entries.length
    ? await AsyncStorage.multiGet(entries.map(([mapId]) => observationMapKey(mapId)))
    : [];
  for (const [index, [, expectedList]] of entries.entries()) {
    const actualList = parseObservationList(verifyPairs[index]?.[1] ?? null);
    if (actualList.length !== expectedList.length) {
      throw new Error("Migrering av observationer kunde inte verifieras.");
    }
  }

  await AsyncStorage.multiSet([
    [OBS_COUNTS_KEY, JSON.stringify(countsFromObservationsByMap(byMap))],
    [OBS_MIGRATION_KEY, "true"],
  ]);
}

async function observationMapKeys(): Promise<string[]> {
  const keys = await AsyncStorage.getAllKeys();
  return keys.filter((key) => key.startsWith(OBS_MAP_KEY_PREFIX));
}

function observationMapKey(mapId: string): string {
  return `${OBS_MAP_KEY_PREFIX}${mapId}`;
}

function mapIdFromObservationMapKey(key: string): string {
  return key.startsWith(OBS_MAP_KEY_PREFIX) ? key.slice(OBS_MAP_KEY_PREFIX.length) : "";
}

function parseObservationList(raw: string | null): Observation[] {
  if (!raw) return [];
  const parsed = JSON.parse(raw) as Observation[];
  return Array.isArray(parsed) ? parsed.map(normalizeObservation) : [];
}

async function normalizeObservationForMigration(obs: Observation): Promise<Observation> {
  const normalized = normalizeObservation(obs);
  const photos = await Promise.all(
    (normalized.photos ?? []).map((photo) => normalizePhotoForMigration(normalized, photo))
  );
  const photoUris = photos.map((photo) => photo.localUri ?? photo.originalUri ?? "");
  if (normalized.kind !== "point") {
    return {
      ...normalized,
      photos,
      photoUris,
    };
  }
  const photoAssetIds = photos.map((photo) => photo.assetId ?? "");
  const hasAnyAssetId = photoAssetIds.some((id) => id.trim().length > 0);
  return {
    ...normalized,
    photos,
    photoUris,
    photoAssetIds: hasAnyAssetId ? photoAssetIds : undefined,
  };
}

async function normalizePhotoForMigration(
  obs: Observation,
  photo: ObservationPhoto
): Promise<ObservationPhoto> {
  const existingLocal = await firstExistingFile([photo.localUri]);
  if (existingLocal) {
    return {
      ...photo,
      localUri: existingLocal,
      status: "ready",
    };
  }

  const migratedLocal = await firstExistingFile(buildMigratedPhotoCandidates(obs, photo));
  if (migratedLocal) {
    return {
      ...photo,
      localUri: migratedLocal,
      originalUri: photo.originalUri || photo.localUri,
      status: "ready",
    };
  }

  return {
    ...photo,
    status: "failed",
  };
}

function buildMigratedPhotoCandidates(obs: Observation, photo: ObservationPhoto): string[] {
  const dir = mapPhotosDir(obs.mapId);
  const names = uniqueStrings([
    photo.fileName,
    photoFileNameFromRef(photo.localUri ?? ""),
    photoFileNameFromRef(photo.originalUri ?? ""),
    ...buildLegacyPointPhotoNames(obs, photo),
  ]);
  return uniqueStrings(
    names.flatMap((name) => {
      const jpgName = name.replace(/\.[A-Za-z0-9]+$/, ".jpg");
      return [`${dir}${name}`, `${dir}${jpgName}`];
    })
  );
}

function buildLegacyPointPhotoNames(obs: Observation, photo: ObservationPhoto): string[] {
  if (obs.kind !== "point") return [];
  const index = photoIndexFromFileName(photo.fileName);
  const pointNumber = String(obs.pointNumber ?? obs.id);
  return [
    buildPointPhotoFileName(pointNumber, obs.species, obs.dateISO, index, "jpg"),
  ];
}

function photoIndexFromFileName(fileName: string): number {
  const match = String(fileName ?? "").match(/_(\d+)\.[A-Za-z0-9]+$/);
  const parsed = match ? Number(match[1]) : 1;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

async function firstExistingFile(values: Array<string | undefined>): Promise<string | null> {
  for (const value of values) {
    const uri = String(value ?? "").trim();
    if (!uri) continue;
    if (await getFileSize(uri) !== null) {
      return uri;
    }
  }
  return null;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => String(value ?? "").trim())
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

async function updateObservationCount(mapId: string, count: number): Promise<void> {
  const raw = await AsyncStorage.getItem(OBS_COUNTS_KEY);
  const current = raw ? JSON.parse(raw) as Record<string, number> : {};
  const next = { ...current };
  if (count > 0) {
    next[mapId] = count;
  } else {
    delete next[mapId];
  }
  await AsyncStorage.setItem(OBS_COUNTS_KEY, JSON.stringify(next));
}

async function saveObservationCountsFromEntries(value: Record<string, Observation[]>): Promise<void> {
  await AsyncStorage.setItem(OBS_COUNTS_KEY, JSON.stringify(countsFromObservationsByMap(value)));
}

function countsFromObservationsByMap(value: Record<string, Observation[]>): Record<string, number> {
  const entries: Array<[string, number]> = Object.entries(value)
    .map(([mapId, list]) => [mapId, Array.isArray(list) ? list.length : 0]);
  return Object.fromEntries(entries.filter(([, count]) => count > 0));
}

async function loadObservationSizeWarnings(): Promise<Record<string, number>> {
  const raw = await AsyncStorage.getItem(OBS_SIZE_WARNINGS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, number>;
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([mapId, level]) => [String(mapId), Number(level)] as const)
        .filter(([mapId, level]) => mapId.length > 0 && (level === 1 || level === 2))
    );
  } catch {
    return {};
  }
}

async function saveObservationSizeWarnings(value: Record<string, number>): Promise<void> {
  await AsyncStorage.setItem(OBS_SIZE_WARNINGS_KEY, JSON.stringify(value));
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function normalizeObservation(obs: Observation): Observation {
  const photoNames = (obs.photoUris ?? []).map((value) => String(value ?? ""));
  const photoAssetIds = obs.kind === "point"
    ? (obs.photoAssetIds ?? []).map((value) => String(value ?? ""))
    : [];
  const photos = normalizeObservationPhotos(obs, photoNames, photoAssetIds);
  const syncedPhotoUris = photos.map((photo) => photo.localUri ?? photo.originalUri ?? "");
  if (obs.kind !== "point") {
    return {
      ...obs,
      photos,
      photoUris: syncedPhotoUris,
    };
  }
  return {
    ...obs,
    photos,
    photoUris: syncedPhotoUris,
    pointNumber: typeof obs.pointNumber === "number" && Number.isFinite(obs.pointNumber) ? obs.pointNumber : undefined,
    localName: obs.localName ?? "",
    accuracyMeters: obs.accuracyMeters ?? null,
    photoAssetIds: photoAssetIds.length ? photoAssetIds : undefined,
  };
}

function normalizeObservationPhotos(
  obs: Observation,
  photoUris: string[],
  photoAssetIds: string[]
): ObservationPhoto[] {
  const rawPhotos = Array.isArray((obs as { photos?: unknown }).photos)
    ? ((obs as { photos?: Partial<ObservationPhoto>[] }).photos ?? [])
    : [];
  if (rawPhotos.length) {
    return rawPhotos
      .map((photo, index) => normalizePhoto(obs, photo, photoUris[index], photoAssetIds[index], index))
      .filter((photo) => Boolean(photo.localUri || photo.originalUri || photo.assetId));
  }
  return photoUris
    .map((uri, index) => normalizePhoto(obs, undefined, uri, photoAssetIds[index], index))
    .filter((photo) => Boolean(photo.localUri || photo.originalUri || photo.assetId));
}

function normalizePhoto(
  obs: Observation,
  photo: Partial<ObservationPhoto> | undefined,
  legacyUri: string | undefined,
  legacyAssetId: string | undefined,
  index: number
): ObservationPhoto {
  const localUri = String(photo?.localUri ?? "").trim();
  const originalUri = String(photo?.originalUri ?? legacyUri ?? "").trim();
  const assetId = String(photo?.assetId ?? legacyAssetId ?? "").trim();
  const fallbackRef = localUri || originalUri;
  const extension = guessImageExtension(photo?.fileName ?? fallbackRef);
  const status =
    photo?.status === "ready" || photo?.status === "pending" || photo?.status === "failed"
      ? photo.status
      : localUri || isMapPhotoUri(originalUri, obs.mapId)
        ? "ready"
        : "failed";
  const resolvedLocalUri = localUri || (isMapPhotoUri(originalUri, obs.mapId) ? originalUri : undefined);
  const resolvedOriginalUri = resolvedLocalUri === originalUri ? undefined : originalUri || undefined;
  return {
    localUri: resolvedLocalUri,
    originalUri: resolvedOriginalUri,
    assetId: assetId || undefined,
    status,
    fileName: String(photo?.fileName ?? "").trim() || buildPhotoFileName({
      observationId: obs.id,
      label: obs.kind === "point" ? String(obs.pointNumber ?? obs.id) : obs.polygonName || obs.id,
      name: obs.kind === "point" ? obs.species : obs.polygonName || `Polygon${index + 1}`,
      dateISO: obs.dateISO,
      index,
      extension: extension === "jpg" || extension === "jpeg" ? "jpg" : "jpg",
    }),
  };
}

function isPhotoReferenced(byMap: Record<string, Observation[]>, localUri?: string): boolean {
  if (!localUri) return false;
  return Object.values(byMap).some((list) =>
    list.some((obs) => obs.photos?.some((photo) => photo.localUri === localUri))
  );
}

function hasPhotoRebuildSource(photo: ObservationPhoto, mapId: string): boolean {
  const originalUri = String(photo.originalUri ?? "").trim();
  return Boolean(photo.assetId || (originalUri && !isMapPhotoUri(originalUri, mapId)));
}

export async function loadSettings(): Promise<AppSettings> {
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    // Returnera standardvärden för båda inställningarna
    return {
      gpsPingSeconds: 3,
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
      artportalenTimeEnabled: true,
      coordinateSystem: "SWEREF99",
      mapSortMode: "LATEST",
      mapSortAnchor: undefined,
    };
  }
  const parsed = JSON.parse(raw) as Partial<AppSettings>;
  return {
    gpsPingSeconds: parsed.gpsPingSeconds ?? 3,
    visibleFields: parsed.visibleFields ?? {
      quantity: false,
      unit: false,
      hostSpecies: false,
      activity: false,
      substrate: false,
      stage: false,
      gender: false,
    },
    maxImageSizeMB: clampMaxImageSizeSetting(parsed.maxImageSizeMB ?? 2),
    backgroundGPS: parsed.backgroundGPS ?? false,
    autoFollow: parsed.autoFollow ?? false,
    artportalenTimeEnabled: parsed.artportalenTimeEnabled ?? true,
    coordinateSystem: parsed.coordinateSystem === "WGS84" ? "WGS84" : "SWEREF99",
    mapSortMode:
      parsed.mapSortMode === "ALPHA" || parsed.mapSortMode === "NEAREST" || parsed.mapSortMode === "LATEST"
        ? parsed.mapSortMode
        : "LATEST",
    mapSortAnchor:
      parsed.mapSortAnchor &&
      Number.isFinite(parsed.mapSortAnchor.lat) &&
      Number.isFinite(parsed.mapSortAnchor.lon)
        ? parsed.mapSortAnchor
        : undefined,
  };
}

function clampMaxImageSizeSetting(value: number): number {
  return Number.isFinite(value) ? Math.min(3, Math.max(1, value)) : 2;
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

export async function loadUserSpeciesGroups(): Promise<Record<string, string>> {
  const raw = await AsyncStorage.getItem(USER_SPECIES_GROUPS_KEY);
  if (!raw) return {};
  const parsed = JSON.parse(raw) as Record<string, string>;
  return Object.fromEntries(
    Object.entries(parsed)
      .map(([species, group]) => [String(species ?? "").trim(), String(group ?? "").trim()])
      .filter(([species, group]) => species.length > 0 && group.length > 0)
  );
}

export async function saveUserSpeciesGroup(species: string, group: string): Promise<Record<string, string>> {
  const name = String(species ?? "").trim();
  const value = String(group ?? "").trim();
  const current = await loadUserSpeciesGroups();
  if (!name || !value) return current;

  const existingKey = Object.keys(current).find((key) => key.toLowerCase() === name.toLowerCase());
  const next = { ...current };
  if (existingKey && existingKey !== name) {
    delete next[existingKey];
  }
  next[name] = value;
  await AsyncStorage.setItem(USER_SPECIES_GROUPS_KEY, JSON.stringify(next));
  return next;
}

export async function removeUserSpeciesGroup(species: string): Promise<Record<string, string>> {
  const name = String(species ?? "").trim();
  if (!name) return await loadUserSpeciesGroups();
  const current = await loadUserSpeciesGroups();
  const next = Object.fromEntries(
    Object.entries(current).filter(([key]) => key.toLowerCase() !== name.toLowerCase())
  );
  await AsyncStorage.setItem(USER_SPECIES_GROUPS_KEY, JSON.stringify(next));
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
