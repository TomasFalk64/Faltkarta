import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle, Polygon } from "react-native-svg";
import { RootStackParamList } from "../navigation/types";
import { MapCanvas } from "../components/MapCanvas";
import { ObservationModal } from "../components/ObservationModal";
import { useGpsContext } from "../contexts/GpsContext";
import {
  addObservation,
  deleteObservation,
  loadMaps,
  loadObservationsForMap,
  loadSettings,
  loadUserSpeciesGroups,
  upsertMap,
  updateObservation,
} from "../storage/storage";
import { speciesGroups } from "../data/speciesGroups";
import { LatLon, MapItem, Observation, PolygonObservation, PointObservation, VisibleFields } from "../types/models";
import { makeId } from "../utils/id";
import { ensureMapGeorefBounds } from "../services/files";
import { resolvePointPhotoUri } from "../services/photos";
import { distanceMeters } from "../services/coords";
import { getSafeUri } from "../services/mapPaths";

type Props = NativeStackScreenProps<RootStackParamList, "Map">;

const defaultVisibleFields: VisibleFields = {
  quantity: false,
  unit: false,
  hostSpecies: false,
  activity: false,
  substrate: false,
  stage: false,
  gender: false,
};

export function MapScreen({ route, navigation }: Props) {
  const { mapId } = route.params;
  const [autoFollow, setAutoFollow] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [map, setMap] = useState<MapItem | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [centerCoord, setCenterCoord] = useState<LatLon>({ lat: 62.0, lon: 16.0 });
  const [toast, setToast] = useState<string | null>(null);
  const [showPointModal, setShowPointModal] = useState(false);
  const [showPolygonModal, setShowPolygonModal] = useState(false);
  const [showPointList, setShowPointList] = useState(false);
  const [pointModalSession, setPointModalSession] = useState(0);
  const [pointModalInitialValues, setPointModalInitialValues] = useState<{
    species: string;
    notes: string;
    photoUris: string[];
    photoAssetIds?: string[];
    localName?: string;
    quantity?: number;
    unit?: string;
    hostSpecies?: string;
    activity?: string;
    substrate?: string;
    stage?: string;
    gender?: string;
    accuracyMeters?: number | null;
  }>({
    species: "",
    notes: "",
    photoUris: [],
    photoAssetIds: [],
    localName: "",
    accuracyMeters: null,
  });
  const [pointModalInitialSpeciesGroup, setPointModalInitialSpeciesGroup] = useState("");
  const [polygonModalSession, setPolygonModalSession] = useState(0);
  const [editingPoint, setEditingPoint] = useState<PointObservation | null>(null);
  const [editingPolygon, setEditingPolygon] = useState<PolygonObservation | null>(null);
  const [editingPointPhotoPreviewUris, setEditingPointPhotoPreviewUris] = useState<string[]>([]);
  const [editingPointPhotoPreviewAssetIds, setEditingPointPhotoPreviewAssetIds] = useState<string[]>([]);
  const [ownSpeciesGroups, setOwnSpeciesGroups] = useState<Record<string, string>>({});
  const [polygonMode, setPolygonMode] = useState(false);
  const [draftPolygon, setDraftPolygon] = useState<LatLon[]>([]);
  const [gpsPingSeconds, setGpsPingSeconds] = useState(3);
  const [visibleFields, setVisibleFields] = useState<VisibleFields>(defaultVisibleFields);
  const [backgroundGPS, setBackgroundGPS] = useState(false);
  const [showScaleBar, setShowScaleBar] = useState(true);
  const [showAccuracyHelp, setShowAccuracyHelp] = useState(false);
  const [frozenPointCoord, setFrozenPointCoord] = useState<LatLon | null>(null);
  const [frozenAccuracyMeters, setFrozenAccuracyMeters] = useState<number | null>(null);

  const {
    gpsPos,
    gpsHeading,
    headingEnabled,
    setHeadingEnabled,
    setHeadingSuspended,
    displayAccuracyMeters,
    rawAccuracyMeters,
    error: gpsError,
  } = useGpsContext();
  const editingPhotoLookupRef = useRef<Record<string, { ref: string; assetId?: string }>>({});
  const editingMissingPhotosRef = useRef<Array<{ ref: string; assetId?: string }>>([]);

  const speciesGroupsByLower = useMemo(() => {
    const map = new Map<string, string>();
    Object.entries(speciesGroups).forEach(([name, group]) => {
      const normalized = String(group ?? "").trim();
      if (normalized) map.set(name.toLowerCase(), normalized);
    });
    Object.entries(ownSpeciesGroups).forEach(([name, group]) => {
      const normalized = String(group ?? "").trim();
      if (normalized) map.set(name.toLowerCase(), normalized);
    });
    return map;
  }, [ownSpeciesGroups]);

  function findSpeciesGroup(value: string): string {
    return speciesGroupsByLower.get(value.trim().toLowerCase()) ?? "";
  }

  useEffect(() => {
    (async () => {
      const [maps, obs, settings, groups] = await Promise.all([
        loadMaps(),
        loadObservationsForMap(mapId),
        loadSettings(),
        loadUserSpeciesGroups(),
      ]);
      const current = maps.find((m) => m.id === mapId) ?? null;
      const hydrated = current ? await ensureMapGeorefBounds(current) : current;
      if (hydrated && hydrated !== current) {
        await upsertMap(hydrated);
      }
      setObservations(obs);
      setOwnSpeciesGroups(groups);
      setAutoFollow(settings.autoFollow ?? false);
      setGpsPingSeconds(settings.gpsPingSeconds);
      setVisibleFields(settings.visibleFields ?? defaultVisibleFields);
      setBackgroundGPS(settings.backgroundGPS ?? false);
      if (hydrated?.bbox) {
        setCenterCoord({
          lat: (hydrated.bbox.minLat + hydrated.bbox.maxLat) / 2,
          lon: (hydrated.bbox.minLon + hydrated.bbox.maxLon) / 2,
        });
      }
      setMap(hydrated);
      if (hydrated) {
        navigation.setOptions({
          title: hydrated.title,
          headerStyle: {
          backgroundColor: '#f4f0e7', 
          },
          headerTitleStyle: {
            fontSize: 15,
          },
        });
      }
    })().catch((e) => Alert.alert("Fel", String(e)));
  }, [mapId]);

  useEffect(() => {
    if (autoFollow) return;
    setIsFollowing(false);
  }, [autoFollow]);

  useEffect(() => {
    return () => {
      setHeadingSuspended(false);
    };
  }, [setHeadingSuspended]);

  useEffect(() => {
    if (!isFollowing || !gpsPos) return;
    const nextTarget = clampToMapBounds(gpsPos);
    if (distanceMeters(centerCoord, nextTarget) < 2) {
      return;
    }
    setCenterCoord(nextTarget);
  }, [centerCoord, gpsPos, isFollowing, map]);

  const crosshairPos = centerCoord;
  const pointList = useMemo(
    () =>
      observations
        .filter((obs) => obs.kind === "point" || obs.kind === "polygon") //.filter((obs): obs is PointObservation => obs.kind === "point")
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

  function isOutsideMapBounds(coord: LatLon): boolean {
    if (!map?.bbox) return false;
    return (
      coord.lat < map.bbox.minLat ||
      coord.lat > map.bbox.maxLat ||
      coord.lon < map.bbox.minLon ||
      coord.lon > map.bbox.maxLon
    );
  }

  function centerOnObservation(coord: LatLon) {
    setIsFollowing(false);
    setCenterCoord(clampToMapBounds(coord));
  }

  function polygonCenter(obs: PolygonObservation): LatLon | null {
    if (obs.wgs84.length === 0) return null;
    const lats = obs.wgs84.map((coord) => coord.lat);
    const lons = obs.wgs84.map((coord) => coord.lon);
    return {
      lat: (Math.min(...lats) + Math.max(...lats)) / 2,
      lon: (Math.min(...lons) + Math.max(...lons)) / 2,
    };
  }

  function onCenterToGps() {
    if (autoFollow && isFollowing) {
      setIsFollowing(false);
      return;
    }
    if (!gpsPos) {
      showToast("Ingen GPS-position annu");
      return;
    }
    if (autoFollow) {
      setIsFollowing(true);
    }
    setCenterCoord(clampToMapBounds(gpsPos));
  }

  const combinedRaw = displayAccuracyMeters ?? rawAccuracyMeters ?? 0;
  const displayCombined = combinedRaw > 0 ? Math.min(99, Math.max(5, combinedRaw)) : 0;
  const clampAccuracy = (value?: number | null): number | null => {
    if (value === null || value === undefined) return null;
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.min(99, Math.max(5, value));
  };

  function getNextPointNumber(): number {
    const numbers = observations
      .filter((obs): obs is PointObservation => obs.kind === "point")
      .map((obs) => obs.pointNumber)
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
    const max = numbers.length ? Math.max(...numbers) : 0;
    return max + 1;
  }

  function derivePointNumberFromExisting(pointId: string): number {
    const byCreated = observations
      .filter((obs): obs is PointObservation => obs.kind === "point")
      .slice()
      .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    const idx = byCreated.findIndex((obs) => obs.id === pointId);
    return idx >= 0 ? idx + 1 : getNextPointNumber();
  }

  async function onAddPoint(payload: {
    species?: string;
    notes: string;
    photoUris: string[];
    photoAssetIds?: string[];
    localName?: string;
    accuracyMeters?: number | null;
    quantity?: number;
    unit?: string;
    hostSpecies?: string;
    activity?: string;
    substrate?: string;
    stage?: string;
    gender?: string;
    accuracyMetersWasModified?: boolean;
  }): Promise<boolean> {
    if (!map) return false;
    try {
      const species = payload.species?.trim();
      if (!species) {
        Alert.alert("Art", "Du måste ange ett artnamn.");
        return false;
      }
      const pointId = editingPoint?.id ?? makeId("obs");
      const dateISO = editingPoint?.dateISO ?? new Date().toISOString();
      const pointNumber = editingPoint?.pointNumber ?? derivePointNumberFromExisting(pointId);
      const currentLookup = editingPhotoLookupRef.current;
      const missingExisting = editingMissingPhotosRef.current;
      const ordered = payload.photoUris.map((uri, index) => {
        const existing = currentLookup[uri];
        if (existing) return { ref: existing.ref, assetId: existing.assetId };
        const payloadAssetId = String(payload.photoAssetIds?.[index] ?? "");
        return { ref: uri, assetId: payloadAssetId };
      });
      const photoUris = [...ordered.map((p) => p.ref), ...missingExisting.map((p) => p.ref)];
      const photoAssetIds = [...ordered.map((p) => p.assetId ?? ""), ...missingExisting.map((p) => p.assetId ?? "")];
      const hasAnyAssetId = photoAssetIds.some((id) => String(id ?? "").trim().length > 0);

      const obs: PointObservation = editingPoint
        ? {
            ...editingPoint,
            species,
            notes: payload.notes,
            photoUris,
            photoAssetIds: hasAnyAssetId ? photoAssetIds : undefined,
            pointNumber,
            localName: payload.localName?.trim() || map.title,
            accuracyMeters: payload.accuracyMetersWasModified
              ? clampAccuracy(payload.accuracyMeters)
              : editingPoint.accuracyMeters,
            quantity: payload.quantity !== undefined ? payload.quantity : editingPoint.quantity ?? 0,
            unit: payload.unit !== undefined ? payload.unit : editingPoint.unit ?? "",
            hostSpecies:
              payload.hostSpecies !== undefined
                ? payload.hostSpecies.trim() || undefined
                : editingPoint.hostSpecies,
            activity:
              payload.activity !== undefined
                ? payload.activity.trim() || undefined
                : editingPoint.activity,
            substrate:
              payload.substrate !== undefined
                ? payload.substrate.trim() || undefined
                : editingPoint.substrate,
            stage:
              payload.stage !== undefined
                ? payload.stage.trim() || undefined
                : editingPoint.stage,
            gender:
              payload.gender !== undefined
                ? payload.gender.trim() || undefined
                : editingPoint.gender,
          }
        : {
            id: pointId,
            mapId: map.id,
            kind: "point",
            species,
            count: 1,
            notes: payload.notes,
            photoUris,
            photoAssetIds: hasAnyAssetId ? photoAssetIds : undefined,
            pointNumber,
            localName: payload.localName?.trim() || map.title,
            accuracyMeters: clampAccuracy(
              payload.accuracyMeters ?? frozenAccuracyMeters
            ),
            quantity: payload.quantity ?? 0,
            unit: payload.unit ?? "",
            hostSpecies: payload.hostSpecies?.trim() || undefined,
            activity: payload.activity?.trim() || undefined,
            substrate: payload.substrate?.trim() || undefined,
            stage: payload.stage?.trim() || undefined,
            gender: payload.gender?.trim() || undefined,
            dateISO,
            wgs84: frozenPointCoord || crosshairPos,
          };

      const next = editingPoint ? await updateObservation(obs) : await addObservation(obs);
      setObservations(next);
      setEditingPoint(null);
      setEditingPointPhotoPreviewUris([]);
      setEditingPointPhotoPreviewAssetIds([]);
      editingPhotoLookupRef.current = {};
      editingMissingPhotosRef.current = [];
      showToast(editingPoint ? "Punkt uppdaterad" : "Punkt sparad");
      return true;
    } catch (error) {
      Alert.alert("Foto", String(error));
      return false;
    }
  }

  async function onDeletePoint() {
    if (!map || !editingPoint) return;
    const next = await deleteObservation(map.id, editingPoint.id);
    setObservations(next);
    setEditingPoint(null);
    setEditingPointPhotoPreviewUris([]);
    setEditingPointPhotoPreviewAssetIds([]);
    editingPhotoLookupRef.current = {};
    editingMissingPhotosRef.current = [];
    showToast("Punkt raderad");
  }

  async function onDeletePolygon() {
    if (!map || !editingPolygon) return;
    const next = await deleteObservation(map.id, editingPolygon.id);
    setObservations(next);
    setEditingPolygon(null);
    showToast("Polygon raderad");
  }

  async function onAddPolygon(payload: {
    polygonName?: string;
    notes: string;
    photoUris: string[];
    photoAssetIds?: string[];
  }) {
    if (!map) return;
    const polygonName = payload.polygonName?.trim();
    if (!polygonName) {
      Alert.alert("Polygon", "Du m??ste ange ett namn.");
      return;
    }
    if (editingPolygon) {
      const obs: PolygonObservation = {
        ...editingPolygon,
        polygonName,
        notes: payload.notes,
        photoUris: payload.photoUris,
      };
      const next = await updateObservation(obs);
      setObservations(next);
      setEditingPolygon(null);
      showToast("Polygon uppdaterad");
      return;
    }
    if (draftPolygon.length < 2) {
      Alert.alert("Polygon", "Minst 2 punkter kravs.");
      return;
    }
    const obs: PolygonObservation = {
      id: makeId("obs"),
      mapId: map.id,
      kind: "polygon",
      polygonName,
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

  async function openPointEditor(obs: PointObservation) {
    centerOnObservation(obs.wgs84);
    const existing = obs.photoUris.map((ref, index) => ({
      ref: String(ref ?? ""),
      assetId: obs.photoAssetIds?.[index],
    }));
    const resolved = await Promise.all(
      existing.map(async (item) => ({
        ...item,
        uri: await resolvePointPhotoUri(item.ref, item.assetId),
      }))
    );
    const previewLookup: Record<string, { ref: string; assetId?: string }> = {};
    const previewUris: string[] = [];
    const previewAssetIds: string[] = [];
    const missing: Array<{ ref: string; assetId?: string }> = [];
    resolved.forEach((item) => {
      if (item.uri) {
        previewLookup[item.uri] = { ref: item.ref, assetId: item.assetId };
        previewUris.push(item.uri);
        previewAssetIds.push(String(item.assetId ?? ""));
      } else {
        missing.push({ ref: item.ref, assetId: item.assetId });
      }
    });
    editingPhotoLookupRef.current = previewLookup;
    editingMissingPhotosRef.current = missing;
    setEditingPointPhotoPreviewUris(previewUris);
    setEditingPointPhotoPreviewAssetIds(previewAssetIds);
    setEditingPoint(obs);
    setFrozenPointCoord(obs.wgs84);
    setFrozenAccuracyMeters(obs.accuracyMeters);
    setPointModalInitialValues({
      species: obs.species,
      notes: obs.notes,
      photoUris: previewUris,
      photoAssetIds: previewAssetIds,
      localName: obs.localName,
      accuracyMeters: obs.accuracyMeters,
      quantity: obs.quantity,
      unit: obs.unit,
      hostSpecies: obs.hostSpecies,
      activity: obs.activity,
      substrate: obs.substrate,
      stage: obs.stage,
      gender: obs.gender,
    });
    setPointModalInitialSpeciesGroup(findSpeciesGroup(obs.species));
    setPointModalSession((v) => v + 1);
    setShowPointModal(true);
  }

  function openNewPointModal() {
    const useCrosshair = () => {
      setEditingPoint(null);
      setEditingPointPhotoPreviewUris([]);
      setEditingPointPhotoPreviewAssetIds([]);
      editingPhotoLookupRef.current = {};
      editingMissingPhotosRef.current = [];
      setFrozenPointCoord(crosshairPos);
      setFrozenAccuracyMeters(displayAccuracyMeters ?? rawAccuracyMeters ?? null);
      setPointModalInitialValues({
        species: "",
        notes: "",
        photoUris: [],
        photoAssetIds: [],
        localName: map?.title ?? "",
        accuracyMeters: displayAccuracyMeters ?? rawAccuracyMeters ?? null,
      });
      setPointModalInitialSpeciesGroup("");
      setPointModalSession((v) => v + 1);
      setShowPointModal(true);
    };

    const useCurrentPosition = (coord: LatLon) => {
      setEditingPoint(null);
      setEditingPointPhotoPreviewUris([]);
      setEditingPointPhotoPreviewAssetIds([]);
      editingPhotoLookupRef.current = {};
      editingMissingPhotosRef.current = [];
      setFrozenPointCoord(coord);
      setFrozenAccuracyMeters(displayAccuracyMeters ?? rawAccuracyMeters ?? null);
      setPointModalInitialValues({
        species: "",
        notes: "",
        photoUris: [],
        photoAssetIds: [],
        localName: map?.title ?? "",
        accuracyMeters: displayAccuracyMeters ?? rawAccuracyMeters ?? null,
      });
      setPointModalInitialSpeciesGroup("");
      setPointModalSession((v) => v + 1);
      setShowPointModal(true);
    };

    if (map?.bbox && gpsPos && isOutsideMapBounds(gpsPos)) {
      Alert.alert(
        "Du är utanför kartan",
        "Vill du använda din aktuella GPS-position eller hårkorsets placering?",
        [
          {
            text: "   GPS-position   ",
            onPress: () => useCurrentPosition(gpsPos),
          },
          {
            text: "   Hårkors   ",
            style: "cancel",
            onPress: useCrosshair,
          },
        ],
        { cancelable: true }
      );
      return;
    }

    useCrosshair();
  }

  function openCopiedPointModal(obs: PointObservation) {
    setShowPointList(false);
    setTimeout(() => {
      setEditingPoint(null);
      setEditingPointPhotoPreviewUris([]);
      setEditingPointPhotoPreviewAssetIds([]);
      editingPhotoLookupRef.current = {};
      editingMissingPhotosRef.current = [];
      setFrozenPointCoord(crosshairPos);
      setFrozenAccuracyMeters(displayAccuracyMeters ?? rawAccuracyMeters ?? null);
      setPointModalInitialValues({
        species: obs.species,
        notes: obs.notes,
        photoUris: [],
        photoAssetIds: [],
        localName: obs.localName,
        accuracyMeters: displayAccuracyMeters ?? rawAccuracyMeters ?? null,
        quantity: obs.quantity,
        unit: obs.unit,
        hostSpecies: obs.hostSpecies,
        activity: obs.activity,
        substrate: obs.substrate,
        stage: obs.stage,
        gender: obs.gender,
      });
      setPointModalInitialSpeciesGroup(findSpeciesGroup(obs.species));
      setPointModalSession((v) => v + 1);
      setShowPointModal(true);
    }, 120);
  }

  function handleSharePoint(obs: PointObservation) {
    //console.log("Hela observationen:", JSON.stringify(obs, null, 2));
    // Stäng listan först
    setShowPointList(false);

    // Vänta ut animationen och dela sedan
    setTimeout(async () => {
      try {
        const lat = obs.wgs84.lat;
        const lon = obs.wgs84.lon;
        console.log("Hela observationen:", lat, "  ", lon);
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
        const message = `Fältkarta\n ${obs.species}\n\nSe platsen på kartan:\n${mapsUrl}`;

        await Share.share({
          message: message,
        });
      } catch (error) {
        Alert.alert("Kunde inte dela", "Ett fel uppstod när delningsmenyn skulle öppnas.");
        console.error("Dela-fel:", error);
      }
    }, 150);
  }

  function openPolygonEditor(obs: PolygonObservation) {
    const center = polygonCenter(obs);
    if (center) {
      centerOnObservation(center);
    }
    setEditingPolygon(obs);
    setPolygonModalSession((v) => v + 1);
    setShowPolygonModal(true);
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
        imageUri={getSafeUri(map.previewFileName, "preview")}
        centerCoord={centerCoord}
        gpsPos={gpsPos}
        gpsHeading={gpsHeading}
        showHeadingIndicator={headingEnabled}
        observations={observations}
        draftPolygon={draftPolygon}
        showScaleBar={showScaleBar}
        onPanGeoDelta={(dLat, dLon) =>
          setCenterCoord((prev) => clampToMapBounds({ lat: prev.lat + dLat, lon: prev.lon + dLon }))
        }
        onPanDrag={() => setIsFollowing(false)}
        onPanStateChange={(isPanning) => setHeadingSuspended(isPanning)}
        onZoom={() => setIsFollowing(false)}
        onPressPoint={(id) => {
          const obs = observations.find((o) => o.id === id);
          if (obs && obs.kind === "point") {
            void openPointEditor(obs);
          }
        }}
      />

      <View style={styles.northWrap}>
        <Pressable
          style={styles.northBtn}
          onPress={() => setHeadingEnabled(!headingEnabled)}
        >
          <View style={styles.compassIcon}>
            <View style={styles.compassNeedleUp} />
            <View style={styles.compassNeedleDown} />
          </View>
        </Pressable>
      </View>

      <Pressable
        style={[
          styles.accuracyPill,
          displayCombined > 15 ? styles.accuracyPillBad : undefined,
        ]}
        onPress={() => {
          setShowAccuracyHelp(true);
        }}
      >
        <Text style={styles.accuracyPillText}>{displayCombined > 0 ? String(displayCombined) : "..."}</Text>
      </Pressable>

      <View style={styles.controls}>
        <Pressable
          style={[styles.mainBtn, polygonMode ? styles.polyOn : undefined]}
          onPress={() => {
            setPolygonMode((v) => !v);
            if (polygonMode) setDraftPolygon([]);
          }}
        >
          <PolygonModeIcon />
        </Pressable>
        <Pressable style={styles.mainBtn} onPress={() => setShowPointList((v) => !v)}>
          <Text style={styles.mainBtnIcon}>≡</Text>
        </Pressable>
        <Pressable
          style={[styles.mainBtn, isFollowing ? styles.followOn : undefined]}
          onPress={onCenterToGps}
        >
          <Ionicons
            name="navigate"
            size={22}
            color="#fff"
            style={{ transform: [{ translateX: -2 }, { rotate: "0deg" }] }}
          />
        </Pressable>
        <Pressable
          style={styles.mainBtn}
          onPress={openNewPointModal}
        >
          <Text style={styles.mainBtnIcon}>📍</Text>
        </Pressable>
      </View>

      <View style={styles.secondaryControls}>
        {polygonMode && (
          <>
            <Pressable style={styles.secondaryBtn} onPress={addPolygonVertex}>
              <Text style={styles.secondaryText}>
                {`+ L\u00e4gg till punkt (${draftPolygon.length + 1})`}
              </Text>
            </Pressable>
            <Pressable
              style={styles.secondaryBtn}
              onPress={() => {
                if (draftPolygon.length < 2) {
                  Alert.alert("Polygon", "L\u00e4gg till minst 2 punkter innan du markerar polygon klar.");
                  return;
                }
                setPolygonModalSession((v) => v + 1);
                setShowPolygonModal(true);
              }}
            >
              <Text style={styles.secondaryText}>Polygon klar</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryBtn, styles.secondaryDangerBtn]}
              onPress={() => {
                setDraftPolygon([]);
                setPolygonMode(false);
              }}
            >
              <Text style={styles.secondaryText}>Avbryt polygon</Text>
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
              <Text style={styles.pointListTitle}>Observationer ({pointList.length})</Text>{/* Rubrik för punktlistan */}
              <Pressable style={styles.pointListCloseBtn} onPress={() => setShowPointList(false)}>
                <Text style={styles.pointListCloseText}>Stäng</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.pointListScroll} contentContainerStyle={styles.pointListContent}>
              {pointList.length === 0 ? (
                <Text style={styles.pointListEmpty}>Inga punkter sparade.</Text>
              ) : (
                pointList.map((obs) => (
                  <View key={obs.id} style={styles.pointListItem}>
                    <Pressable
                      style={styles.pointListItemMain}
                      onPress={() => {
                        setShowPointList(false);
                        if (obs.kind === "point") {
                          void openPointEditor(obs);
                        } else {
                          openPolygonEditor(obs);
                        }
                      }}
                    >
                      <Text style={styles.pointListItemSpecies}>
                        {obs.kind === "point" ? obs.species : obs.polygonName}
                      </Text>
                      {obs.kind === "point" ? (
                        <Text style={styles.pointListItemMeta}>
                          Noggrannhet: {obs.accuracyMeters} m
                        </Text>
                      ) : (
                        <Text style={styles.pointListItemMeta}>Polygon</Text>
                      )}
                    </Pressable>
                    {obs.kind === "point" ? (
                      <>
                        {/* Vänster: Kopiera */}
                        <Pressable style={styles.copySpeciesBtn} onPress={() => openCopiedPointModal(obs)}>
                          <Ionicons name="copy-outline" size={16} color="#fff" />
                        </Pressable>

                        {/* Höger: Dela */}
                        <Pressable style={styles.shareSpeciesBtn} onPress={() => handleSharePoint(obs)}>
                          <Ionicons name="share-social-outline" size={16} color="#fff" />
                        </Pressable>
                      </>
                    ) : null}
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      )}

      <Modal transparent visible={showAccuracyHelp} onRequestClose={() => setShowAccuracyHelp(false)} animationType="fade">
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowAccuracyHelp(false)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Felmarginal i meter</Text>
            <View style={styles.helpBox}>
              <Text style={styles.helpText}>
                Din faktiska position ligger med ca 68 % sannolikhet inom en cirkel med denna radie från pricken på
                kartan. Ju fler satelliter telefonen når, desto lägre värde. Siffran kan dock bli missvisande om signalen
                studsar mot t.ex. en husvägg eller bergvägg.
              </Text>
            </View>
          </View>
        </View>
      </Modal>

      <ObservationModal
        visible={showPointModal}
        onClose={() => {
          setShowPointModal(false);
          setEditingPoint(null);
          setEditingPointPhotoPreviewUris([]);
          setEditingPointPhotoPreviewAssetIds([]);
          editingPhotoLookupRef.current = {};
          editingMissingPhotosRef.current = [];
          setFrozenPointCoord(null);
          setFrozenAccuracyMeters(null);
          setPointModalInitialSpeciesGroup("");
        }}
        onSave={onAddPoint}
        onDelete={editingPoint ? onDeletePoint : undefined}
        initialValues={editingPoint ? {
          species: editingPoint.species,
          notes: editingPoint.notes,
          photoUris: editingPointPhotoPreviewUris,
          photoAssetIds: editingPointPhotoPreviewAssetIds,
          localName: editingPoint.localName,
          accuracyMeters: editingPoint.accuracyMeters,
          quantity: editingPoint.quantity,
          unit: editingPoint.unit,
          hostSpecies: editingPoint.hostSpecies,
          activity: editingPoint.activity,
          substrate: editingPoint.substrate,
          stage: editingPoint.stage,
          gender: editingPoint.gender,
        } : pointModalInitialValues}
        title={editingPoint ? "Redigera punkt" : "Ny punktobservation"}
        sessionToken={pointModalSession}
        visibleFields={visibleFields}
        showPointMetaFields
        initialSpeciesGroup={pointModalInitialSpeciesGroup}
        autoFocusSpecies={!editingPoint && pointModalInitialValues.species === ""}
      />
      <ObservationModal
        visible={showPolygonModal}
        onClose={() => {
          setShowPolygonModal(false);
          setEditingPolygon(null);
        }}
        onSave={onAddPolygon}
        onDelete={editingPolygon ? onDeletePolygon : undefined}
        initialValues={
          editingPolygon
            ? {
                polygonName: editingPolygon.polygonName,
                notes: editingPolygon.notes,
                photoUris: editingPolygon.photoUris,
              }
            : {
                polygonName: "",
                notes: "",
                photoUris: [],
              }
        }
        title={editingPolygon ? "Redigera polygon" : "Ny polygon"}
        sessionToken={polygonModalSession}
        visibleFields={visibleFields}
        speciesPlaceholder="Polygonnamn"
        kind="polygon"
      />
    </View>
  );
}

function PolygonModeIcon() {
  return (
    <Svg width={26} height={26} viewBox="0 0 26 26">
      <Polygon points="13,23.5 22.5,16.5 18.8,4.2 7.2,4.2 3.5,16.5" fill="none" stroke="#fff" strokeWidth={2} />
      <Circle cx={13} cy={23.5} r={2.1} fill="#fff" />
      <Circle cx={22.5} cy={16.5} r={2.1} fill="#fff" />
      <Circle cx={18.8} cy={4.2} r={2.1} fill="#fff" />
      <Circle cx={7.2} cy={4.2} r={2.1} fill="#fff" />
      <Circle cx={3.5} cy={16.5} r={2.1} fill="#fff" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  northWrap: { position: "absolute", right: 10, top: 10 },
  accuracyPill: {
    position: "absolute",
    left: 10,
    top: 10,
    minWidth: 44,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#1b4332",
    backgroundColor: "rgba(0,95,115,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  accuracyPillBad: {
    borderColor: "#d62828",
  },
  accuracyPillText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
  },
  modalTitle: {
    fontWeight: "700",
    marginBottom: 8,
    fontSize: 16,
  },
  helpBox: {
    backgroundColor: "#eef6f7",
    borderColor: "#c8dde1",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },
  helpText: {
    color: "#22323b",
    lineHeight: 18,
    marginBottom: 4,
  },
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
    borderColor: "#1e2428",
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
  followOn: { backgroundColor: "#3a8fa1" },
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
  secondaryDangerBtn: {
    backgroundColor: "rgba(155,34,38,0.85)",
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
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pointListItemMain: {
    flex: 1,
    gap: 2,
  },
  pointListItemSpecies: { color: "#fff", fontWeight: "700" },
  pointListItemMeta: { color: "#d9d9d9", marginTop: 2, fontSize: 12 },
  copySpeciesBtn: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  shareSpeciesBtn: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginLeft: 1, // Mellanrum mellan ikonerna!
  },
});

