import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { LatLon } from "../types/models";
import { distanceMeters } from "../services/coords";
import { emitGpsSample, GpsSample, subscribeGpsSamples } from "../services/gpsEvents";

type UseGpsOptions = {
  pingSeconds: number;
  backgroundGPS: boolean;
  onBackgroundDenied?: () => void;
};

type UseGpsResult = {
  gpsPos: LatLon | null;
  rawAccuracyMeters: number | null;
  displayAccuracyMeters: number | null;
  error: string | null;
  stopAllGps: () => Promise<void>;
};

const GPS_BACK_TASK = "GPS_BACK_TASK";
const STACK_MAX_COUNT = 10;
const STACK_MAX_AGE_MS = 30_000;
const MEMORY_DEPTH = 2;
const MAX_SPEED_MPS = 50;
const MAX_GOOD_ACCURACY = 100;
const DEBUG_GPS = false;

if (Platform.OS !== "web" && !TaskManager.isTaskDefined(GPS_BACK_TASK)) {
  TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(GPS_BACK_TASK, async ({ data, error }) => {
    if (error) {
      return;
    }
    const payload = data as { locations?: Location.LocationObject[] } | undefined;
    const locations = payload?.locations ?? [];
    locations.forEach((loc) => {
      const accuracy = loc.coords.accuracy;
      if (typeof accuracy !== "number" || !Number.isFinite(accuracy)) return;
      //console.log("[GPS_BACK_TASK] pos", loc.coords.latitude, loc.coords.longitude, "acc", accuracy, "ts", loc.timestamp);
      emitGpsSample({
        lat: loc.coords.latitude,
        lon: loc.coords.longitude,
        rawAccuracy: Math.max(1, Math.round(accuracy)),
        timestamp: typeof loc.timestamp === "number" ? loc.timestamp : Date.now(),
      });
    });
  });
}

export function useGps({ pingSeconds, backgroundGPS, onBackgroundDenied }: UseGpsOptions): UseGpsResult {
  const [gpsPos, setGpsPos] = useState<LatLon | null>(null);
  const [rawAccuracyMeters, setRawAccuracyMeters] = useState<number | null>(null);
  const [displayAccuracyMeters, setDisplayAccuracyMeters] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appState, setAppState] = useState(AppState.currentState);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [backgroundAllowed, setBackgroundAllowed] = useState(false);

  const lastSampleRef = useRef<GpsSample | null>(null);
  const stackRef = useRef<GpsSample[]>([]);
  const foregroundWatchRef = useRef<{ remove?: () => void } | null>(null);

  const safeRemoveSubscription = useCallback((sub: { remove?: () => void } | null) => {
    if (!sub) return;
    try {
      if (typeof sub.remove === "function") {
        sub.remove();
        return;
      }
      const anySub = sub as { removeSubscription?: () => void };
      if (typeof anySub.removeSubscription === "function") {
        anySub.removeSubscription();
      }
    } catch (e) {
      console.log("[GPS_FOREGROUND] remove rejected", String(e));
    }
  }, []);

  const handleSample = useCallback((sample: GpsSample) => {
    if (DEBUG_GPS) {
      console.log("[GPS] sample", {
        accuracy: sample.rawAccuracy,
        timestamp: sample.timestamp,
      });
    }
    if (lastSampleRef.current?.timestamp === sample.timestamp) return;
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

    if (DEBUG_GPS) {
      console.log(
        "[GPS] stack",
        next.map((item) => ({
          accuracy: item.rawAccuracy,
          ageSec: Math.max(0, (now - item.timestamp) / 1000),
        }))
      );
    }

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

    const weightedAccuracy = Math.max(5, Math.round(accSum / weightSum));
    const lastThreeRaw = next.slice(-3).map((item) => item.rawAccuracy);

    if (DEBUG_GPS) {
      console.log(`[GPS] accuracy raw=[${lastThreeRaw.join(",")}] weighted=${weightedAccuracy}`);
      console.log("[GPS] weighted", {
        lat: latSum / weightSum,
        lon: lonSum / weightSum,
        displayAccuracy: weightedAccuracy,
        weightSum,
      });
    }

    setGpsPos({
      lat: latSum / weightSum,
      lon: lonSum / weightSum,
    });
    setRawAccuracyMeters(sample.rawAccuracy);
    setDisplayAccuracyMeters(weightedAccuracy);
    setError(null);
  }, []);

  const stopAllGps = useCallback(async () => {
    try {
      safeRemoveSubscription(foregroundWatchRef.current);
      foregroundWatchRef.current = null;
    } catch (e) {
      console.log("[GPS_FOREGROUND] stop rejected", String(e));
    }

    try {
      if (Platform.OS !== "web") {
        const started = await Location.hasStartedLocationUpdatesAsync(GPS_BACK_TASK);
        if (started) {
          await Location.stopLocationUpdatesAsync(GPS_BACK_TASK);
        }
      }
    } catch (e) {
      console.log("[GPS_BACK_TASK] stop rejected", String(e));
    }
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
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status !== "granted") {
        if (!cancelled) {
          setError("Platsbehorighet nekad.");
          setPermissionGranted(false);
        }
        return;
      }

      let backgroundGranted = false;
      if (backgroundGPS && Platform.OS !== "web") {
        const bg = await Location.requestBackgroundPermissionsAsync();
        backgroundGranted = bg.status === "granted";
        if (!backgroundGranted) {
          onBackgroundDenied?.();
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
    let cancelled = false;

    const stopBackgroundUpdates = async () => {
      try {
        if (Platform.OS === "web") return;
        const started = await Location.hasStartedLocationUpdatesAsync(GPS_BACK_TASK);
        if (started) {
          await Location.stopLocationUpdatesAsync(GPS_BACK_TASK);
        }
      } catch (e) {
        console.log("[GPS_BACK_TASK] stop rejected", String(e));
      }
    };

    const startForegroundWatch = async () => {
      if (foregroundWatchRef.current) {
        safeRemoveSubscription(foregroundWatchRef.current);
        foregroundWatchRef.current = null;
      }
      const next = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: Math.max(1, pingSeconds) * 1000,
          distanceInterval: 1,
        },
        (loc) => {
          const accuracy = loc.coords.accuracy;
          if (typeof accuracy !== "number" || !Number.isFinite(accuracy)) return;
          //console.log("[GPS_FOREGROUND] pos", loc.coords.latitude, loc.coords.longitude, "acc", accuracy, "ts", loc.timestamp);
          handleSample({
            lat: loc.coords.latitude,
            lon: loc.coords.longitude,
            rawAccuracy: Math.max(1, Math.round(accuracy)),
            timestamp: typeof loc.timestamp === "number" ? loc.timestamp : Date.now(),
          });
        }
      );
      foregroundWatchRef.current = next;
    };

    const startBackgroundUpdates = async () => {
      try {
        if (Platform.OS === "web") return;
        const started = await Location.hasStartedLocationUpdatesAsync(GPS_BACK_TASK);
        if (!started) {
          await Location.startLocationUpdatesAsync(GPS_BACK_TASK, {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: Math.max(1, pingSeconds) * 1000,
            distanceInterval: 1,
            foregroundService: {
              notificationTitle: "Fältkarta",
              notificationBody: "Positionering aktiv i bakgrunden",
              notificationColor: "#005f73",
            },
          });
        }
      } catch (e) {
        console.log("[GPS_BACK_TASK] start rejected", String(e));
      }
    };

    (async () => {
      if (!backgroundGPS) {
        await stopBackgroundUpdates();
      }

      // Starta bakgrundstjänsten tidigt så den redan är igång när appen går i bakgrunden.
      if (backgroundGPS && backgroundAllowed && Platform.OS !== "web") {
        await startBackgroundUpdates();
      }

      if (appState === "active") {
        if (!cancelled) {
          await startForegroundWatch();
        }
      } else {
        safeRemoveSubscription(foregroundWatchRef.current);
        foregroundWatchRef.current = null;
      }
    })().catch((e) => {
      if (!cancelled) setError(String(e));
    });

    return () => {
      cancelled = true;
      safeRemoveSubscription(foregroundWatchRef.current);
      foregroundWatchRef.current = null;
    };
  }, [appState, backgroundAllowed, backgroundGPS, handleSample, permissionGranted, pingSeconds, safeRemoveSubscription]);

  return { gpsPos, rawAccuracyMeters, displayAccuracyMeters, error, stopAllGps };
}
