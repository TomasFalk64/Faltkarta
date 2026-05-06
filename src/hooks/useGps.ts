import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { LatLon } from "../types/models";
import { distanceMeters } from "../services/coords";
import { emitGpsSample, GpsSample, subscribeGpsSamples } from "../services/gpsEvents";

type UseGpsOptions = {
  pingSeconds: number;
  backgroundGPS: boolean;
  headingEnabled: boolean;
  headingSuspended: boolean;
  onBackgroundDenied?: () => void;
};

type UseGpsResult = {
  gpsPos: LatLon | null;
  gpsHeading: number | null;
  foregroundPermissionKnown: boolean;
  foregroundPermissionGranted: boolean;
  requestForegroundPermission: () => Promise<boolean>;
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
const HEADING_MIN_INTERVAL_MS = 50;
const HEADING_MIN_DELTA_DEG = 0.8;

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
      //console.log("[GPS_BACK_TASK] pos", loc.coords.latitude, loc.coords.longitude, "acc", accuracy, "ts", loc.timestamp);
      emitGpsSample({
        lat: loc.coords.latitude,
        lon: loc.coords.longitude,
        rawAccuracy: Math.max(1, Math.round(accuracy)),
        timestamp: typeof loc.timestamp === "number" ? loc.timestamp : Date.now(),
        heading:
          typeof loc.coords.heading === "number" && Number.isFinite(loc.coords.heading)
            ? normalizeHeading(loc.coords.heading)
            : null,
      });
    });
  });
}

export function useGps({ pingSeconds, backgroundGPS, headingEnabled, headingSuspended, onBackgroundDenied }: UseGpsOptions): UseGpsResult {
  const [gpsPos, setGpsPos] = useState<LatLon | null>(null);
  const [gpsHeading, setGpsHeading] = useState<number | null>(null);
  const [rawAccuracyMeters, setRawAccuracyMeters] = useState<number | null>(null);
  const [displayAccuracyMeters, setDisplayAccuracyMeters] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appState, setAppState] = useState(AppState.currentState);
  const [foregroundPermissionKnown, setForegroundPermissionKnown] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [backgroundAllowed, setBackgroundAllowed] = useState(false);

  const lastSampleRef = useRef<GpsSample | null>(null);
  const stackRef = useRef<GpsSample[]>([]);
  const foregroundWatchRef = useRef<{ remove: () => void } | null>(null);
  const headingWatchRef = useRef<{ remove: () => void } | null>(null);
  const foregroundJustGrantedRef = useRef(false);
  const smoothedHeadingRef = useRef<number | null>(null);
  const lastHeadingEmitAtRef = useRef(0);
  const lastHeadingRenderedRef = useRef<number | null>(null);

  const showIosBackgroundPermissionAlert = useCallback(() => {
    if (Platform.OS !== "ios") return;
    Alert.alert(
      "Bakgrundsposition kräver 'Alltid'",
      "För att spårning i fickan ska fungera på iPhone behöver du gå till Inställningar och välja platsbehörigheten 'Alltid' för appen."
    );
  }, []);

  const requestForegroundPermission = useCallback(async (): Promise<boolean> => {
    try {
      const fg = await Location.requestForegroundPermissionsAsync();
      const granted = fg.status === "granted";
      setForegroundPermissionKnown(true);
      setPermissionGranted(granted);
      if (!granted) {
        setError("Platsbehorighet nekad.");
      } else {
        setError(null);
      }
      return granted;
    } catch (e) {
      setForegroundPermissionKnown(true);
      setPermissionGranted(false);
      setError(String(e));
      return false;
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
      foregroundWatchRef.current?.remove();
      foregroundWatchRef.current = null;
    } catch (e) {
      console.log("[GPS_FOREGROUND] stop rejected", String(e));
    }
    try {
      headingWatchRef.current?.remove();
      headingWatchRef.current = null;
    } catch (e) {
      console.log("[GPS_HEADING] stop rejected", String(e));
    }

    try {
      const started = await Location.hasStartedLocationUpdatesAsync(GPS_BACK_TASK);
      if (started) {
        await Location.stopLocationUpdatesAsync(GPS_BACK_TASK);
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
    setForegroundPermissionKnown(false);
    setPermissionGranted(false);
    setBackgroundAllowed(false);

    (async () => {
      foregroundJustGrantedRef.current = false;
      const fg = await Location.getForegroundPermissionsAsync();
      const granted = fg.status === "granted";
      if (!granted) {
        if (!cancelled) {
          setError("Platsbehorighet nekad.");
          setForegroundPermissionKnown(true);
          setPermissionGranted(false);
        }
        return;
      }

      if (!cancelled) {
        setForegroundPermissionKnown(true);
        setPermissionGranted(true);
        setError(null);
      }
    })().catch((e) => {
      if (!cancelled) {
        setForegroundPermissionKnown(true);
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
        foregroundWatchRef.current.remove();
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
            heading:
              typeof loc.coords.heading === "number" && Number.isFinite(loc.coords.heading)
                ? normalizeHeading(loc.coords.heading)
                : null,
          });
        }
      );
      foregroundWatchRef.current = next;
    };

    const startBackgroundUpdates = async () => {
      try {
        if (Platform.OS === "ios" && foregroundJustGrantedRef.current) {
          foregroundJustGrantedRef.current = false;
          showIosBackgroundPermissionAlert();
          onBackgroundDenied?.();
          return;
        }

        const bg = await Location.getBackgroundPermissionsAsync();
        const backgroundGranted = bg.status === "granted";
        setBackgroundAllowed(backgroundGranted);
        if (!backgroundGranted) {
          if (Platform.OS === "ios") {
            showIosBackgroundPermissionAlert();
          }
          onBackgroundDenied?.();
          return;
        }

        const started = await Location.hasStartedLocationUpdatesAsync(GPS_BACK_TASK);
        if (!started) {
          await Location.startLocationUpdatesAsync(GPS_BACK_TASK, {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: Math.max(1, pingSeconds) * 1000,
            distanceInterval: 1,
            activityType: Location.ActivityType.OtherNavigation,
            showsBackgroundLocationIndicator: true,
            pausesUpdatesAutomatically: false,
            foregroundService: {
              notificationTitle: "Fältkarta",
              notificationBody: "Positionering aktiv i bakgrunden",
              notificationColor: "#005f73",
            },
          });
        }
      } catch (e) {
        setBackgroundAllowed(false);
        if (Platform.OS === "ios") {
          showIosBackgroundPermissionAlert();
        }
        onBackgroundDenied?.();
        console.log("[GPS_BACK_TASK] start rejected", String(e));
      }
    };

    (async () => {
      if (!backgroundGPS) {
        setBackgroundAllowed(false);
        await stopBackgroundUpdates();
      }

      // Starta bakgrundstjänsten tidigt så den redan är igång när appen går i bakgrunden.
      if (backgroundGPS) {
        await startBackgroundUpdates();
      }

      if (appState === "active") {
        if (!cancelled) {
          await startForegroundWatch();
        }
      } else {
        foregroundWatchRef.current?.remove();
        foregroundWatchRef.current = null;
      }
    })().catch((e) => {
      if (!cancelled) setError(String(e));
    });

    return () => {
      cancelled = true;
      foregroundWatchRef.current?.remove();
      foregroundWatchRef.current = null;
    };
  }, [appState, backgroundAllowed, backgroundGPS, handleSample, permissionGranted, pingSeconds, showIosBackgroundPermissionAlert]);

  useEffect(() => {
    if (!headingEnabled || headingSuspended || !permissionGranted || appState !== "active") {
      smoothedHeadingRef.current = null;
      lastHeadingEmitAtRef.current = 0;
      lastHeadingRenderedRef.current = null;
      setGpsHeading(null);
      headingWatchRef.current?.remove();
      headingWatchRef.current = null;
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        headingWatchRef.current?.remove();
        const subscription = await Location.watchHeadingAsync((heading) => {
          if (cancelled) return;
          const now = Date.now();
          if (now - lastHeadingEmitAtRef.current < HEADING_MIN_INTERVAL_MS) return;
          const raw = Number.isFinite(heading.trueHeading) && heading.trueHeading >= 0
            ? heading.trueHeading
            : heading.magHeading;
          if (!Number.isFinite(raw)) return;
          
          const smoothed = smoothHeadingCircular(raw, smoothedHeadingRef.current);
          const prev = lastHeadingRenderedRef.current;
          if (typeof prev === "number") {
            const delta = circularDeltaDegrees(smoothed, prev);
            if (delta < HEADING_MIN_DELTA_DEG) return;
          }
          smoothedHeadingRef.current = smoothed;
          lastHeadingEmitAtRef.current = now;
          lastHeadingRenderedRef.current = smoothed;
          setGpsHeading(smoothed);
        });
        if (cancelled) {
          subscription.remove();
          return;
        }
        headingWatchRef.current = subscription;
      } catch (e) {
        console.log("[GPS_HEADING] watch rejected", String(e));
      }
    })();

    return () => {
      cancelled = true;
      smoothedHeadingRef.current = null;
      lastHeadingEmitAtRef.current = 0;
      lastHeadingRenderedRef.current = null;
      headingWatchRef.current?.remove();
      headingWatchRef.current = null;
    };
  }, [appState, headingEnabled, headingSuspended, permissionGranted]);

  return {
    gpsPos,
    gpsHeading,
    foregroundPermissionKnown,
    foregroundPermissionGranted: permissionGranted,
    requestForegroundPermission,
    rawAccuracyMeters,
    displayAccuracyMeters,
    error,
    stopAllGps,
  };
}

function normalizeHeading(value: number): number {
  const heading = value % 360;
  return heading < 0 ? heading + 360 : heading;
}

function smoothHeadingCircular(raw: number, previous: number | null, alpha: number = 0.15): number {
  if (previous === null) return raw;
  
  // Beräkna kortaste väg på cirkel (0-360)
  let delta = raw - previous;
  if (delta > 180) delta -= 360;
  else if (delta < -180) delta += 360;
  
  const smoothed = previous + delta * alpha;
  return normalizeHeading(smoothed);
}

function circularDeltaDegrees(a: number, b: number): number {
  let d = Math.abs(normalizeHeading(a) - normalizeHeading(b));
  if (d > 180) d = 360 - d;
  return d;
}
