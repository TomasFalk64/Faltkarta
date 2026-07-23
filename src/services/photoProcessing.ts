import { Observation, ObservationPhoto } from "../types/models";
import { loadObservationsForMap, loadSettings, updateObservation } from "../storage/storage";
import {
  compressPhotoToAppFile,
  ensureMapPhotosDir,
  getFileSize,
  resolvePointPhotoUri,
} from "./photos";

const activeJobs = new Set<string>();
let processingChain = Promise.resolve();

export function photoSignature(photos: ObservationPhoto[]): string {
  return photos
    .map((photo) => [photo.fileName, photo.originalUri ?? "", photo.assetId ?? ""].join("|"))
    .join(";");
}

export function queuePendingPhotoProcessing(mapId: string, observationId: string): void {
  const key = `${mapId}:${observationId}`;
  if (activeJobs.has(key)) return;
  activeJobs.add(key);
  processingChain = processingChain
    .then(() => processPendingPhotos(mapId, observationId))
    .catch(() => {
      // Keep later queued jobs alive even if one job fails unexpectedly.
    })
    .finally(() => activeJobs.delete(key));
}

export function queuePendingPhotoProcessingForMap(mapId: string): void {
  void loadObservationsForMap(mapId)
    .then((observations) => {
      observations.forEach((obs) => {
        if (obs.photos?.some((photo) => photo.status === "pending")) {
          queuePendingPhotoProcessing(mapId, obs.id);
        }
      });
    })
    .catch(() => {
      // Best-effort recovery queue.
    });
}

async function processPendingPhotos(mapId: string, observationId: string): Promise<void> {
  const settings = await loadSettings();
  const initial = await findObservation(mapId, observationId);
  if (!initial) return;
  const expectedSignature = photoSignature(initial.photos ?? []);
  const dir = await ensureMapPhotosDir(mapId);

  for (const photo of initial.photos ?? []) {
    if (photo.status !== "pending") continue;

    const current = await findObservation(mapId, observationId);
    if (!current || photoSignature(current.photos ?? []) !== expectedSignature) return;

    const targetUri = `${dir}${photo.fileName.replace(/\.[A-Za-z0-9]+$/, ".jpg")}`;
    const sourceAvailable = await canResolveSource(photo);
    if (!sourceAvailable) {
      await updatePhotoStatus(current, photo.fileName, { status: "failed" });
      continue;
    }

    try {
      const localUri = await compressPhotoToAppFile({
        sourceRef: photo.originalUri,
        assetId: photo.assetId,
        targetUri,
        maxImageSizeMB: settings.maxImageSizeMB ?? 2,
      });
      const latest = await findObservation(mapId, observationId);
      if (!latest || photoSignature(latest.photos ?? []) !== expectedSignature) return;
      await updatePhotoStatus(latest, photo.fileName, localUri ? { localUri, status: "ready" } : { status: "failed" });
    } catch {
      const latest = await findObservation(mapId, observationId);
      if (!latest || photoSignature(latest.photos ?? []) !== expectedSignature) return;
      await updatePhotoStatus(latest, photo.fileName, { status: "failed" });
    }
  }
}

async function canResolveSource(photo: ObservationPhoto): Promise<boolean> {
  if (photo.localUri && await getFileSize(photo.localUri) !== null) return true;
  const source = await resolvePointPhotoUri(photo.originalUri ?? "", photo.assetId);
  return !!source;
}

async function findObservation(mapId: string, observationId: string): Promise<Observation | null> {
  const observations = await loadObservationsForMap(mapId);
  return observations.find((obs) => obs.id === observationId) ?? null;
}

async function updatePhotoStatus(
  obs: Observation,
  fileName: string,
  patch: Partial<ObservationPhoto>
): Promise<void> {
  const photos = (obs.photos ?? []).map((photo) =>
    photo.fileName === fileName
      ? { ...photo, ...patch }
      : photo
  );
  const photoUris = photos.map((photo) => photo.localUri ?? photo.originalUri ?? "");
  const photoAssetIds = obs.kind === "point"
    ? photos.map((photo) => photo.assetId ?? "")
    : undefined;
  await updateObservation({
    ...obs,
    photos,
    photoUris,
    ...(obs.kind === "point" ? { photoAssetIds } : {}),
  } as Observation);
}
