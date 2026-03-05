import React, { useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/types";
import { MapCanvas } from "../components/MapCanvas";
import { ObservationModal } from "../components/ObservationModal";
import { useGps } from "../hooks/useGps";
import { addObservation, loadMaps, loadObservationsForMap, loadSettings } from "../storage/storage";
import { LatLon, MapItem, Observation, PolygonObservation, PointObservation } from "../types/models";
import { distanceMeters } from "../services/coords";
import { makeId } from "../utils/id";

type Props = NativeStackScreenProps<RootStackParamList, "Map">;

export function MapScreen({ route }: Props) {
  const { mapId } = route.params;
  const [map, setMap] = useState<MapItem | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [centerCoord, setCenterCoord] = useState<LatLon>({ lat: 62.0, lon: 16.0 });
  const [toast, setToast] = useState<string | null>(null);
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
      setMap(current);
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
      if (dtSec < 2 && jump > 200) return;
    }
    lastGpsRef.current = { pos: gpsPos, ts: now };
  }, [gpsPos]);

  const crosshairPos = centerCoord;

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 1500);
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
        onManualPan={() => {}}
        resetRotationSignal={rotationResetSignal}
      />

      <View style={styles.northWrap}>
        <Pressable style={styles.northBtn} onPress={() => setRotationResetSignal((s) => s + 1)}>
          <View style={styles.compassIcon}>
            <View style={styles.compassNeedleUp} />
            <View style={styles.compassNeedleDown} />
          </View>
        </Pressable>
      </View>

      <View style={styles.controls}>
        <Pressable
          style={[styles.mainBtn, polygonMode ? styles.polyOn : undefined]}
          onPress={() => {
            setPolygonMode((v) => !v);
            if (polygonMode) setDraftPolygon([]);
          }}
        >
          <Text style={styles.mainBtnIcon}>⬠</Text>
        </Pressable>
        <Pressable style={styles.mainBtn} onPress={onCenterToGps}>
          <Text style={styles.mainBtnIcon}>↗</Text>
        </Pressable>
        <Pressable style={styles.mainBtn} onPress={() => setShowPointModal(true)}>
          <Text style={styles.mainBtnIcon}>📍</Text>
        </Pressable>
      </View>

      <View style={styles.secondaryControls}>
        {polygonMode && (
          <>
            <Pressable style={styles.secondaryBtn} onPress={addPolygonVertex}>
              <Text style={styles.secondaryText}>+ Lagg till punkt ({draftPolygon.length})</Text>
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
  container: { flex: 1, backgroundColor: "#000" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  northWrap: { position: "absolute", right: 10, top: 10 },
  northBtn: {
    backgroundColor: "#005f73",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: "center",
    minWidth: 58,
  },
  compassIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "#ffffff",
    backgroundColor: "#f8f8f8",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  compassNeedleUp: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 11,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#d62828",
    position: "absolute",
    top: 2,
  },
  compassNeedleDown: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 11,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "#ffffff",
    position: "absolute",
    bottom: 2,
  },
  controls: {
    position: "absolute",
    right: 10,
    top: 78,
    flexDirection: "column",
    gap: 8,
    alignItems: "center",
  },
  mainBtn: {
    backgroundColor: "#005f73",
    borderRadius: 10,
    width: 58,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  polyOn: { backgroundColor: "#ca6702" },
  mainBtnIcon: { color: "#fff", fontWeight: "700", fontSize: 20, lineHeight: 22 },
  secondaryControls: {
    position: "absolute",
    right: 76,
    top: 78,
    gap: 8,
    alignItems: "flex-end",
  },
  secondaryBtn: {
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  secondaryText: { color: "#fff", fontWeight: "600" },
  toast: {
    position: "absolute",
    alignSelf: "center",
    bottom: 128,
    backgroundColor: "rgba(0,0,0,0.75)",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  toastText: { color: "#fff", fontWeight: "600" },
  gpsError: {
    position: "absolute",
    top: 46,
    alignSelf: "center",
    backgroundColor: "#9b2226",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  gpsErrorText: { color: "#fff", fontWeight: "700" },
});
