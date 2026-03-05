import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/types";
import { MapCanvas } from "../components/MapCanvas";
import { ObservationModal } from "../components/ObservationModal";
import { useGps } from "../hooks/useGps";
import {
  addObservation,
  loadMaps,
  loadObservationsForMap,
  loadSettings,
  upsertMap,
} from "../storage/storage";
import { LatLon, MapItem, Observation, PolygonObservation, PointObservation } from "../types/models";
import { distanceMeters } from "../services/coords";
import { ensureGeoTiffPreview } from "../services/files";
import { makeId } from "../utils/id";

type Props = NativeStackScreenProps<RootStackParamList, "Map">;

export function MapScreen({ route, navigation }: Props) {
  const { mapId } = route.params;
  const [map, setMap] = useState<MapItem | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [centerCoord, setCenterCoord] = useState<LatLon>({ lat: 62.0, lon: 16.0 });
  const [followMe, setFollowMe] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [rotationDeg, setRotationDeg] = useState(0);
  const [rotationResetSignal, setRotationResetSignal] = useState(0);
  const [showPointModal, setShowPointModal] = useState(false);
  const [showPolygonModal, setShowPolygonModal] = useState(false);
  const [polygonMode, setPolygonMode] = useState(false);
  const [draftPolygon, setDraftPolygon] = useState<LatLon[]>([]);
  const [gpsPingSeconds, setGpsPingSeconds] = useState(3);

  const { gpsPos, error: gpsError } = useGps({ pingSeconds: gpsPingSeconds });
  const lastGpsRef = useRef<{ pos: LatLon; ts: number } | null>(null);

  useEffect(() => {
    (async () => {
      const [maps, obs, settings] = await Promise.all([
        loadMaps(),
        loadObservationsForMap(mapId),
        loadSettings(),
      ]);
      const current = maps.find((m) => m.id === mapId) ?? null;
      if (current) {
        const withPreview = await ensureGeoTiffPreview(current);
        if (withPreview.thumbnailUri && !current.thumbnailUri) {
          await upsertMap(withPreview);
        }
        setMap(withPreview);
      } else {
        setMap(null);
      }
      setObservations(obs);
      setGpsPingSeconds(settings.gpsPingSeconds);
      if (current?.bbox) {
        setCenterCoord({
          lat: (current.bbox.minLat + current.bbox.maxLat) / 2,
          lon: (current.bbox.minLon + current.bbox.maxLon) / 2,
        });
      }
    })().catch((e) => Alert.alert("Fel", String(e)));
  }, [mapId]);

  useEffect(() => {
    if (!gpsPos) return;
    const now = Date.now();
    if (lastGpsRef.current) {
      const dtSec = (now - lastGpsRef.current.ts) / 1000;
      const jump = distanceMeters(lastGpsRef.current.pos, gpsPos);
      if (followMe && dtSec < 10 && jump > 80) {
        setFollowMe(false);
        showToast("Folj mig av");
      }
    }
    lastGpsRef.current = { pos: gpsPos, ts: now };
    if (followMe) {
      setCenterCoord(gpsPos);
    }
  }, [gpsPos, followMe]);

  const crosshairPos = centerCoord;

  const topRightLabel = useMemo(
    () => `${crosshairPos.lat.toFixed(5)}, ${crosshairPos.lon.toFixed(5)}`,
    [crosshairPos]
  );

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 1500);
  }

  function onManualPan() {
    if (followMe) {
      setFollowMe(false);
      showToast("Folj mig av");
    }
  }

  function onCenterToGps() {
    if (!gpsPos) {
      showToast("Ingen GPS-position annu");
      return;
    }
    setCenterCoord(gpsPos);
  }

  async function onAddPoint(payload: {
    species: string;
    count: number;
    notes: string;
    photoUris: string[];
  }) {
    if (!map) return;
    const obs: PointObservation = {
      id: makeId("obs"),
      mapId: map.id,
      kind: "point",
      species: payload.species,
      count: payload.count,
      notes: payload.notes,
      photoUris: payload.photoUris,
      dateISO: new Date().toISOString(),
      wgs84: crosshairPos,
    };
    const next = await addObservation(obs);
    setObservations(next);
    showToast("Punkt sparad");
  }

  async function onAddPolygon(payload: {
    species: string;
    count: number;
    notes: string;
    photoUris: string[];
  }) {
    if (!map) return;
    if (draftPolygon.length < 3) {
      Alert.alert("Polygon", "Minst 3 punkter kravs.");
      return;
    }
    const obs: PolygonObservation = {
      id: makeId("obs"),
      mapId: map.id,
      kind: "polygon",
      species: payload.species,
      count: payload.count,
      notes: payload.notes,
      photoUris: payload.photoUris,
      dateISO: new Date().toISOString(),
      wgs84: draftPolygon,
    };
    const next = await addObservation(obs);
    setObservations(next);
    setDraftPolygon([]);
    setPolygonMode(false);
    showToast("Polygon sparad");
  }

  function addPolygonVertex() {
    setDraftPolygon((prev) => [...prev, crosshairPos]);
  }

  if (!map) {
    return (
      <View style={styles.centered}>
        <Text>Laddar karta...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapCanvas
        map={map}
        imageUri={map.thumbnailUri}
        centerCoord={centerCoord}
        gpsPos={gpsPos}
        observations={observations}
        draftPolygon={draftPolygon}
        onPanGeoDelta={(dLat, dLon) =>
          setCenterCoord((prev) => ({ lat: prev.lat + dLat, lon: prev.lon + dLon }))
        }
        onManualPan={onManualPan}
        onRotationChanged={setRotationDeg}
        resetRotationSignal={rotationResetSignal}
      />

      <View style={styles.infoChip}>
        <Text style={styles.infoText}>{topRightLabel}</Text>
      </View>

      <View style={styles.northWrap}>
        <Pressable style={styles.northBtn} onPress={() => setRotationResetSignal((s) => s + 1)}>
          <Text style={styles.northText}>N</Text>
          <Text style={styles.northSub}>{Math.round(rotationDeg)}°</Text>
        </Pressable>
      </View>

      <View style={styles.controls}>
        <Pressable style={styles.mainBtn} onPress={onCenterToGps}>
          <Text style={styles.mainBtnText}>Centrera</Text>
        </Pressable>
        <Pressable
          style={[styles.mainBtn, followMe ? styles.followOn : styles.followOff]}
          onPress={() => setFollowMe((v) => !v)}
        >
          <Text style={styles.mainBtnText}>{followMe ? "Foljer" : "Folj mig"}</Text>
        </Pressable>
        <Pressable style={styles.mainBtn} onPress={() => setShowPointModal(true)}>
          <Text style={styles.mainBtnText}>Registrera punkt</Text>
        </Pressable>
        <Pressable
          style={[styles.mainBtn, polygonMode ? styles.polyOn : undefined]}
          onPress={() => {
            setPolygonMode((v) => !v);
            if (polygonMode) setDraftPolygon([]);
          }}
        >
          <Text style={styles.mainBtnText}>Polygonlage</Text>
        </Pressable>
        <Pressable style={styles.mainBtn} onPress={() => navigation.navigate("Export", { mapId })}>
          <Text style={styles.mainBtnText}>Export</Text>
        </Pressable>
      </View>

      <View style={styles.secondaryControls}>
        {polygonMode && (
          <>
            <Pressable style={styles.secondaryBtn} onPress={addPolygonVertex}>
              <Text style={styles.secondaryText}>+ Lägg till punkt ({draftPolygon.length})</Text>
            </Pressable>
            <Pressable style={styles.secondaryBtn} onPress={() => setShowPolygonModal(true)}>
              <Text style={styles.secondaryText}>Klar polygon</Text>
            </Pressable>
          </>
        )}
      </View>

      {toast && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      {gpsError && (
        <View style={styles.gpsError}>
          <Text style={styles.gpsErrorText}>{gpsError}</Text>
        </View>
      )}

      <ObservationModal
        visible={showPointModal}
        onClose={() => setShowPointModal(false)}
        onSave={onAddPoint}
        title="Ny punktobservation"
      />
      <ObservationModal
        visible={showPolygonModal}
        onClose={() => setShowPolygonModal(false)}
        onSave={onAddPolygon}
        title="Ny polygonobservation"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  infoChip: {
    position: "absolute",
    top: 10,
    left: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: "rgba(0,0,0,0.58)",
    borderRadius: 8,
  },
  infoText: {
    color: "#fff",
    fontWeight: "600",
  },
  northWrap: {
    position: "absolute",
    right: 10,
    top: 10,
  },
  northBtn: {
    backgroundColor: "rgba(0,0,0,0.62)",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: "center",
    minWidth: 58,
  },
  northText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
  },
  northSub: {
    color: "#fff",
    fontSize: 11,
  },
  controls: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  mainBtn: {
    backgroundColor: "#005f73",
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 10,
  },
  followOn: {
    backgroundColor: "#0a9396",
  },
  followOff: {
    backgroundColor: "#9b2226",
  },
  polyOn: {
    backgroundColor: "#ca6702",
  },
  mainBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
  },
  secondaryControls: {
    position: "absolute",
    right: 8,
    bottom: 76,
    gap: 8,
    alignItems: "flex-end",
  },
  secondaryBtn: {
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  secondaryText: {
    color: "#fff",
    fontWeight: "600",
  },
  toast: {
    position: "absolute",
    alignSelf: "center",
    bottom: 128,
    backgroundColor: "rgba(0,0,0,0.75)",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  toastText: {
    color: "#fff",
    fontWeight: "600",
  },
  gpsError: {
    position: "absolute",
    top: 46,
    alignSelf: "center",
    backgroundColor: "#9b2226",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  gpsErrorText: {
    color: "#fff",
    fontWeight: "700",
  },
});
