import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
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

class GpsErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    if (Platform.OS === "web") {
      console.warn("[GPS] ErrorBoundary caught:", error);
    }
  }

  render() {
    if (this.state.hasError) {
      const fallback: GpsContextValue = {
        gpsPos: null,
        rawAccuracyMeters: null,
        displayAccuracyMeters: null,
        error: "GPS är inte tillgängligt i webbläsaren.",
        gpsOptions: { pingSeconds: 3, backgroundGPS: false },
        setGpsOptions: () => {},
        stopAllGps: async () => {},
      };
      return <GpsContext.Provider value={fallback}>{this.props.children}</GpsContext.Provider>;
    }
    return this.props.children as React.ReactElement;
  }
}

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

  return (
    <GpsErrorBoundary>
      <GpsContext.Provider value={value}>{children}</GpsContext.Provider>
    </GpsErrorBoundary>
  );
}

export function useGpsContext() {
  const ctx = useContext(GpsContext);
  if (!ctx) {
    throw new Error("useGpsContext must be used within a GpsProvider");
  }
  return ctx;
}
