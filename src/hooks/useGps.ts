import { useEffect, useState } from "react";
import * as Location from "expo-location";
import { LatLon } from "../types/models";

type UseGpsOptions = {
  pingSeconds: number;
};

type UseGpsResult = {
  gpsPos: LatLon | null;
  error: string | null;
};

export function useGps({ pingSeconds }: UseGpsOptions): UseGpsResult {
  const [gpsPos, setGpsPos] = useState<LatLon | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setError("Platsbehörighet nekad.");
        return;
      }
      sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: Math.max(1, pingSeconds) * 1000,
          distanceInterval: 1,
        },
        (loc) => {
          setGpsPos({
            lat: loc.coords.latitude,
            lon: loc.coords.longitude,
          });
          setError(null);
        }
      );
    })().catch((e) => {
      setError(String(e));
    });

    return () => {
      sub?.remove();
    };
  }, [pingSeconds]);

  return { gpsPos, error };
}
