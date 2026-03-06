import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/types";
import { MapCanvas } from "../components/MapCanvas";
import { ObservationModal } from "../components/ObservationModal";
import { useGps } from "../hooks/useGps";
import {
  addObservation,
  deleteObservation,
  loadMaps,
  loadObservationsForMap,
  loadSettings,
  upsertMap,
  updateObservation,
} from "../storage/storage";
import { LatLon, MapItem, Observation, PolygonObservation, PointObservation } from "../types/models";
import { averageLatLon, distanceMeters } from "../services/coords";
import { makeId } from "../utils/id";
import { ensureMapGeorefBounds } from "../services/files";

type Props = NativeStackScreenProps<RootStackParamList, "Map">;

export function MapScreen({ route }: Props) {
  const { mapId } = route.params;
  const [map, setMap] = useState<MapItem | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [centerCoord, setCenterCoord] = useState<LatLon>({ lat: 62.0, lon: 16.0 });
  const [toast, setToast] = useState<string | null>(null);
  const [showPointModal, setShowPointModal] = useState(false);
  const [showPolygonModal, setShowPolygonModal] = useState(false);
  const [showPointList, setShowPointList] = useState(false);
  const [pointModalSession, setPointModalSession] = useState(0);
  const [polygonModalSession, setPolygonModalSession] = useState(0);
  const [editingPoint, setEditingPoint] = useState<PointObservation | null>(null);
  const [polygonMode, setPolygonMode] = useState(false);
  const [draftPolygon, setDraftPolygon] = useState<LatLon[]>([]);
  const [gpsPingSeconds, setGpsPingSeconds] = useState(3);

  const { gpsPos, error: gpsError } = useGps({ pingSeconds: gpsPingSeconds });
  const lastGpsRef = useRef<{ pos: LatLon; ts: number } | null>(null);
  const gpsTrailRef = useRef<Array<{ pos: LatLon; ts: number }>>([]);

  useEffect(() => {
    (async () => {
      const [maps, obs, settings] = await Promise.all([
        loadMaps(),
        loadObservationsForMap(mapId),
        loadSettings(),
      ]);
      const current = maps.find((m) => m.id === mapId) ?? null;
      const hydrated = current ? await ensureMapGeorefBounds(current) : current;
      if (hydrated && hydrated !== current) {
        await upsertMap(hydrated);
      }
      setObservations(obs);
      setGpsPingSeconds(settings.gpsPingSeconds);
      if (hydrated?.bbox) {
        setCenterCoord({
          lat: (hydrated.bbox.minLat + hydrated.bbox.maxLat) / 2,
          lon: (hydrated.bbox.minLon + hydrated.bbox.maxLon) / 2,
        });
      }
      setMap(hydrated);
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
    gpsTrailRef.current = [...gpsTrailRef.current, { pos: gpsPos, ts: now }]
      .filter((item) => now - item.ts <= 60_000)
      .slice(-20);
  }, [gpsPos]);

  const crosshairPos = centerCoord;
  const pointList = useMemo(
    () =>
      observations
        .filter((obs): obs is PointObservation => obs.kind === "point")
        .sort((a, b) => b.dateISO.localeCompare(a.dateISO)),
    [observations]
  );

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 1500);
  }

  function clampToMapBounds(coord: LatLon): LatLon {
    if (!map?.bbox) return coord;
    return {
      lat: Math.max(map.bbox.minLat, Math.min(map.bbox.maxLat, coord.lat)),
      lon: Math.max(map.bbox.minLon, Math.min(map.bbox.maxLon, coord.lon)),
    };
  }

  function onCenterToGps() {
    if (!gpsPos) {
      showToast("Ingen GPS-position annu");
      return;
    }
    setCenterCoord(clampToMapBounds(gpsPos));
  }

  function estimateGpsAccuracyMeters(): number | null {
    const samples = gpsTrailRef.current.map((s) => s.pos);
    if (samples.length < 3) return null;
    const center = averageLatLon(samples);
    const avgDist = samples.reduce((sum, p) => sum + distanceMeters(p, center), 0) / samples.length;
    return Math.max(1, Math.round(avgDist));
  }

  async function onAddPoint(payload: {
    species: string;
    notes: string;
    photoUris: string[];
    localName?: string;
    accuracyMeters?: number | null;
  }) {
    if (!map) return;
    const obs: PointObservation = editingPoint
      ? {
          ...editingPoint,
          species: payload.species,
          notes: payload.notes,
          photoUris: payload.photoUris,
          localName: payload.localName?.trim() || map.name,
          accuracyMeters: payload.accuracyMeters ?? null,
        }
      : {
          id: makeId("obs"),
          mapId: map.id,
          kind: "point",
          species: payload.species,
          count: 1,
          notes: payload.notes,
          photoUris: payload.photoUris,
          localName: payload.localName?.trim() || map.name,
          accuracyMeters: payload.accuracyMeters ?? estimateGpsAccuracyMeters(),
          dateISO: new Date().toISOString(),
          wgs84: crosshairPos,
        };
    const next = editingPoint ? await updateObservation(obs) : await addObservation(obs);
    setObservations(next);
    setEditingPoint(null);
    showToast(editingPoint ? "Punkt uppdaterad" : "Punkt sparad");
  }

  async function onDeletePoint() {
    if (!map || !editingPoint) return;
    const next = await deleteObservation(map.id, editingPoint.id);
    setObservations(next);
    setEditingPoint(null);
    showToast("Punkt raderad");
  }

  async function onAddPolygon(payload: {
    species: string;
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
      count: 1,
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
          setCenterCoord((prev) => clampToMapBounds({ lat: prev.lat + dLat, lon: prev.lon + dLon }))
        }
        onManualPan={() => {}}
        onPressPoint={(id) => {
          const obs = observations.find((o) => o.id === id);
          if (obs && obs.kind === "point") {
            setEditingPoint(obs);
            setPointModalSession((v) => v + 1);
            setShowPointModal(true);
          }
        }}
      />

      <View style={styles.northWrap}>
        <View style={styles.northBtn}>
          <View style={styles.compassIcon}>
            <View style={styles.compassNeedleUp} />
            <View style={styles.compassNeedleDown} />
          </View>
        </View>
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
        <Pressable
          style={styles.mainBtn}
          onPress={() => {
            setEditingPoint(null);
            setPointModalSession((v) => v + 1);
            setShowPointModal(true);
          }}
        >
          <Text style={styles.mainBtnIcon}>📍</Text>
        </Pressable>
        <Pressable style={styles.mainBtn} onPress={() => setShowPointList((v) => !v)}>
          <Text style={styles.mainBtnIcon}>≡</Text>
        </Pressable>
      </View>

      <View style={styles.secondaryControls}>
        {polygonMode && (
          <>
            <Pressable style={styles.secondaryBtn} onPress={addPolygonVertex}>
              <Text style={styles.secondaryText}>+ Lagg till punkt ({draftPolygon.length})</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryBtn}
              onPress={() => {
                setPolygonModalSession((v) => v + 1);
                setShowPolygonModal(true);
              }}
            >
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

      {showPointList && (
        <View style={styles.pointListWrap}>
          <View style={styles.pointListCard}>
            <View style={styles.pointListHeader}>
              <Text style={styles.pointListTitle}>Alla punkter ({pointList.length})</Text>
              <Pressable style={styles.pointListCloseBtn} onPress={() => setShowPointList(false)}>
                <Text style={styles.pointListCloseText}>Stäng</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.pointListScroll} contentContainerStyle={styles.pointListContent}>
              {pointList.length === 0 ? (
                <Text style={styles.pointListEmpty}>Inga punkter sparade.</Text>
              ) : (
                pointList.map((obs) => (
                  <Pressable
                    key={obs.id}
                    style={styles.pointListItem}
                    onPress={() => {
                      setShowPointList(false);
                      setEditingPoint(obs);
                      setPointModalSession((v) => v + 1);
                      setShowPointModal(true);
                    }}
                  >
                    <Text style={styles.pointListItemSpecies}>{obs.species}</Text>
                    {!!obs.localName && (
                      <Text style={styles.pointListItemMeta}>{obs.localName}</Text>
                    )}
                    {obs.accuracyMeters !== null && (
                      <Text style={styles.pointListItemMeta}>Noggrannhet: {obs.accuracyMeters} m</Text>
                    )}
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      )}

      <ObservationModal
        visible={showPointModal}
        onClose={() => {
          setShowPointModal(false);
          setEditingPoint(null);
        }}
        onSave={onAddPoint}
        onDelete={editingPoint ? onDeletePoint : undefined}
        initialValues={
          editingPoint
            ? {
                species: editingPoint.species,
                notes: editingPoint.notes,
                photoUris: editingPoint.photoUris,
                localName: editingPoint.localName,
                accuracyMeters: editingPoint.accuracyMeters,
              }
            : {
                species: "",
                notes: "",
                photoUris: [],
                localName: map.name,
                accuracyMeters: estimateGpsAccuracyMeters(),
              }
        }
        title={editingPoint ? "Redigera punkt" : "Ny punktobservation"}
        sessionToken={pointModalSession}
        showPointMetaFields
      />
      <ObservationModal
        visible={showPolygonModal}
        onClose={() => setShowPolygonModal(false)}
        onSave={onAddPolygon}
        title="Ny polygonobservation"
        sessionToken={polygonModalSession}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  northWrap: { position: "absolute", right: 10, top: 10 },
  northBtn: {
    paddingVertical: 2,
    paddingHorizontal: 2,
    alignItems: "center",
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
  pointListWrap: {
    position: "absolute",
    right: 76,
    top: 78,
    width: 250,
    maxHeight: 360,
  },
  pointListCard: {
    backgroundColor: "rgba(0,0,0,0.82)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    padding: 10,
  },
  pointListHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  pointListTitle: { color: "#fff", fontWeight: "700" },
  pointListCloseBtn: {
    backgroundColor: "#8a939b",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pointListCloseText: { color: "#fff", fontWeight: "700" },
  pointListScroll: { maxHeight: 300 },
  pointListContent: { gap: 8 },
  pointListEmpty: { color: "#d9d9d9" },
  pointListItem: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  pointListItemSpecies: { color: "#fff", fontWeight: "700" },
  pointListItemMeta: { color: "#d9d9d9", marginTop: 2, fontSize: 12 },
});
