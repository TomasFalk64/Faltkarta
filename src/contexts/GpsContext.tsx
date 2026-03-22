import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useGps } from "../hooks/useGps";
import { loadSettings } from "../storage/storage";

type GpsOptions = {
  pingSeconds: number;
  backgroundGPS: boolean;
};

type GpsContextValue = {
  gpsPos: { lat: number; lon: number } | null;
  rawAccuracyMeters: number | null;
  displayAccuracyMeters: number | null;
  error: string | null;
  gpsOptions: GpsOptions;
  setGpsOptions: (next: GpsOptions) => void;
  stopAllGps: () => Promise<void>;
};

const GpsContext = createContext<GpsContextValue | null>(null);

export function GpsProvider({ children }: { children: React.ReactNode }) {
  const [gpsOptions, setGpsOptionsState] = useState<GpsOptions>({
    pingSeconds: 3,
    backgroundGPS: false,
  });

  useEffect(() => {
    let cancelled = false;
    loadSettings()
      .then((settings) => {
        if (cancelled) return;
        setGpsOptionsState({
          pingSeconds: settings.gpsPingSeconds,
          backgroundGPS: settings.backgroundGPS ?? false,
        });
      })
      .catch(() => {
        if (cancelled) return;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleBackgroundDenied = useCallback(() => {
    setGpsOptionsState((prev) => ({ ...prev, backgroundGPS: false }));
  }, []);

  const { gpsPos, rawAccuracyMeters, displayAccuracyMeters, error, stopAllGps } = useGps({
    pingSeconds: gpsOptions.pingSeconds,
    backgroundGPS: gpsOptions.backgroundGPS,
    onBackgroundDenied: handleBackgroundDenied,
  });

  const setGpsOptions = useCallback((next: GpsOptions) => {
    setGpsOptionsState(next);
  }, []);

  const value = useMemo(
    () => ({
      gpsPos,
      rawAccuracyMeters,
      displayAccuracyMeters,
      error,
      gpsOptions,
      setGpsOptions,
      stopAllGps,
    }),
    [displayAccuracyMeters, error, gpsOptions, gpsPos, rawAccuracyMeters, setGpsOptions, stopAllGps]
  );

  return <GpsContext.Provider value={value}>{children}</GpsContext.Provider>;
}

export function useGpsContext() {
  const ctx = useContext(GpsContext);
  if (!ctx) {
    throw new Error("useGpsContext must be used within a GpsProvider");
  }
  return ctx;
}
