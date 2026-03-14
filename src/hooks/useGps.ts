import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { LatLon } from "../types/models";
import { distanceMeters } from "../services/coords";
import { emitGpsSample, GpsSample, subscribeGpsSamples } from "../services/gpsEvents";

type UseGpsOptions = {
  pingSeconds: number;
  backgroundGPS: boolean;
};

type UseGpsResult = {
  gpsPos: LatLon | null;
  rawAccuracyMeters: number | null;
  displayAccuracyMeters: number | null;
  error: string | null;
};

const GPS_BACK_TASK = "GPS_BACK_TASK";
const STACK_MAX_COUNT = 10;
const STACK_MAX_AGE_MS = 30_000;
const MEMORY_DEPTH = 2;
const MAX_SPEED_MPS = 50;
const MAX_GOOD_ACCURACY = 100;

if (!TaskManager.isTaskDefined(GPS_BACK_TASK)) {
  TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(GPS_BACK_TASK, async ({ data, error }) => {
    if (error) {
      return;
    }
    const payload = data as { locations?: Location.LocationObject[] } | undefined;
    const locations = payload?.locations ?? [];
    locations.forEach((loc) => {
      const accuracy = loc.coords.accuracy;
      if (typeof accuracy !== "number" || !Number.isFinite(accuracy)) return;
      emitGpsSample({
        lat: loc.coords.latitude,
        lon: loc.coords.longitude,
        rawAccuracy: Math.max(1, Math.round(accuracy)),
        timestamp: typeof loc.timestamp === "number" ? loc.timestamp : Date.now(),
      });
    });
  });
}

export function useGps({ pingSeconds, backgroundGPS }: UseGpsOptions): UseGpsResult {
  const [gpsPos, setGpsPos] = useState<LatLon | null>(null);
  const [rawAccuracyMeters, setRawAccuracyMeters] = useState<number | null>(null);
  const [displayAccuracyMeters, setDisplayAccuracyMeters] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appState, setAppState] = useState(AppState.currentState);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [backgroundAllowed, setBackgroundAllowed] = useState(false);

  const lastSampleRef = useRef<GpsSample | null>(null);
  const stackRef = useRef<GpsSample[]>([]);

  const handleSample = useCallback((sample: GpsSample) => {
    if (!Number.isFinite(sample.rawAccuracy)) return;
    if (sample.rawAccuracy > MAX_GOOD_ACCURACY) return;

    if (lastSampleRef.current) {
      const dtSec = (sample.timestamp - lastSampleRef.current.timestamp) / 1000;
      if (dtSec > 0) {
        const jump = distanceMeters(
          { lat: lastSampleRef.current.lat, lon: lastSampleRef.current.lon },
          { lat: sample.lat, lon: sample.lon }
        );
        if (jump >= dtSec * MAX_SPEED_MPS) {
          return;
        }
      }
    }

    lastSampleRef.current = sample;

    const now = Date.now();
    const next = [...stackRef.current, sample]
      .filter((item) => now - item.timestamp <= STACK_MAX_AGE_MS)
      .slice(-STACK_MAX_COUNT);

    stackRef.current = next;

    const recent = next.slice(-MEMORY_DEPTH);
    if (!recent.length) return;

    let weightSum = 0;
    let latSum = 0;
    let lonSum = 0;
    let accSum = 0;

    recent.forEach((item) => {
      const timeSince = Math.max(0, (now - item.timestamp) / 1000);
      const weight = 1 / (1 + item.rawAccuracy + timeSince);
      weightSum += weight;
      latSum += item.lat * weight;
      lonSum += item.lon * weight;
      accSum += item.rawAccuracy * weight;
    });

    if (!Number.isFinite(weightSum) || weightSum <= 0) return;

    setGpsPos({
      lat: latSum / weightSum,
      lon: lonSum / weightSum,
    });
    setRawAccuracyMeters(sample.rawAccuracy);
    setDisplayAccuracyMeters(Math.max(1, Math.round(accSum / weightSum)));
    setError(null);
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      setAppState(nextState);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPermissionGranted(false);
    setBackgroundAllowed(false);

    (async () => {
      let backgroundGranted = false;
      if (backgroundGPS) {
        const bg = await Location.requestBackgroundPermissionsAsync();
        backgroundGranted = bg.status === "granted";
      }

      if (!backgroundGranted) {
        const fg = await Location.requestForegroundPermissionsAsync();
        if (fg.status !== "granted") {
          if (!cancelled) {
            setError("Platsbehorighet nekad.");
            setPermissionGranted(false);
          }
          return;
        }
      }

      if (!cancelled) {
        setBackgroundAllowed(backgroundGranted);
        setPermissionGranted(true);
      }
    })().catch((e) => {
      if (!cancelled) {
        setError(String(e));
        setPermissionGranted(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [backgroundGPS]);

  useEffect(() => {
    const unsubscribe = subscribeGpsSamples(handleSample);
    return () => unsubscribe();
  }, [handleSample]);

  useEffect(() => {
    if (!permissionGranted) return;
    let sub: { remove: () => void } | null = null;
    let cancelled = false;

    const stopBackgroundUpdates = async () => {
      const started = await Location.hasStartedLocationUpdatesAsync(GPS_BACK_TASK);
      if (started) {
        await Location.stopLocationUpdatesAsync(GPS_BACK_TASK);
      }
    };

    const startForegroundWatch = async () => {
      sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: Math.max(1, pingSeconds) * 1000,
          distanceInterval: 1,
        },
        (loc) => {
          const accuracy = loc.coords.accuracy;
          if (typeof accuracy !== "number" || !Number.isFinite(accuracy)) return;
          handleSample({
            lat: loc.coords.latitude,
            lon: loc.coords.longitude,
            rawAccuracy: Math.max(1, Math.round(accuracy)),
            timestamp: typeof loc.timestamp === "number" ? loc.timestamp : Date.now(),
          });
        }
      );
    };

    const startBackgroundUpdates = async () => {
      const started = await Location.hasStartedLocationUpdatesAsync(GPS_BACK_TASK);
      if (!started) {
        await Location.startLocationUpdatesAsync(GPS_BACK_TASK, {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 10_000,
          distanceInterval: 1,
        });
      }
    };

    (async () => {
      if (!backgroundGPS || !backgroundAllowed || appState === "active") {
        await stopBackgroundUpdates();
        if (!cancelled) {
          await startForegroundWatch();
        }
      } else {
        await startBackgroundUpdates();
      }
    })().catch((e) => {
      if (!cancelled) setError(String(e));
    });

    return () => {
      cancelled = true;
      sub?.remove();
      void Location.hasStartedLocationUpdatesAsync(GPS_BACK_TASK).then((started) => {
        if (started) {
          return Location.stopLocationUpdatesAsync(GPS_BACK_TASK);
        }
        return undefined;
      });
    };
  }, [appState, backgroundAllowed, backgroundGPS, handleSample, permissionGranted, pingSeconds]);

  return { gpsPos, rawAccuracyMeters, displayAccuracyMeters, error };
}
