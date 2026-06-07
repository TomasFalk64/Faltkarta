import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
  Linking,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { RootStackParamList } from "../navigation/types";
import { AppSettings, LatLon, MapItem, VisibleFields, VisibleFieldKey } from "../types/models";
import {
  getMaxSideSetting,
  loadAreaDescriptions,
  loadMaps,
  loadObservationsByMapId,
  loadSettings,
  removeMap,
  renameMapAndSyncPointLocalNames,
  saveAreaDescription,
  saveMaxSideSetting,
  saveObservationsByMapId,
  saveSettings,
  upsertMap,
} from "../storage/storage";
import { useGpsContext } from "../contexts/GpsContext";
import { createBlankGeoTiffMap, deleteIfExists, ensureMapGeorefBounds, pickAndImportGeoTiff } from "../services/files";
import { distanceMeters, meters3857ToWgs84, sweref99tmToWgs84 } from "../services/coords";
import { cleanupAllPendingPhotoCopies } from "../services/photos";
import { Ionicons } from '@expo/vector-icons';
import * as Location from "expo-location";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { makeId } from "../utils/id";
import { PolygonObservation } from "../types/models";
import { getSafeUri } from "../services/mapPaths";

type Props = NativeStackScreenProps<RootStackParamList, "MapList">;

export function MapListScreen({ navigation }: Props) {
  const [maps, setMaps] = useState<MapItem[]>([]);
  const [autoFollow, setAutoFollow] = useState(true);
  const [gpsPingSeconds, setGpsPingSeconds] = useState("2");
  const { gpsPos, gpsOptions, setGpsOptions, foregroundPermissionKnown, foregroundPermissionGranted, requestForegroundPermission } = useGpsContext();
  const [visibleFields, setVisibleFields] = useState<VisibleFields>({
    quantity: false,
    unit: false,
    hostSpecies: false,
    activity: false,
    substrate: false,
    stage: false,
    gender: false,
  });
  const visibleFieldOptions: Array<{ key: VisibleFieldKey | "quantityUnit"; label: string }> = [
    { key: "quantityUnit", label: "Antal och Enhet" },
    { key: "hostSpecies", label: "Art som substrat (Värdväxt/värdart)" },
    { key: "activity", label: "Aktivitet (t.ex. Spel/sång)" },
    { key: "substrate", label: "Substrat (t.ex. Död gren, Gnejs)" },
    { key: "stage", label: "Ålder-Stadium" },
    { key: "gender", label: "Kön" },
  ];
  const [maxImageSizeMB, setMaxImageSizeMB] = useState("3");
  const [maxSide, setMaxSide] = useState("1400");
  const [coordinateSystem, setCoordinateSystem] = useState<"SWEREF99" | "WGS84">("SWEREF99");
  const [renameMap, setRenameMap] = useState<MapItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameMode, setRenameMode] = useState<"import" | "edit" | null>(null);
  const [showRenameHint, setShowRenameHint] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [menuMap, setMenuMap] = useState<MapItem | null>(null);
  const [deleteMap, setDeleteMap] = useState<MapItem | null>(null);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showMapBuildLoading, setShowMapBuildLoading] = useState(false);
  const [importPolygonMap, setImportPolygonMap] = useState<MapItem | null>(null);
  const [showBackgroundDisclosure, setShowBackgroundDisclosure] = useState(false);
  const [areaDescriptions, setAreaDescriptions] = useState<Record<string, string>>({});
  const [descriptionModalMap, setDescriptionModalMap] = useState<MapItem | null>(null);
  const [descriptionText, setDescriptionText] = useState("");
  const [changeDateMap, setChangeDateMap] = useState<MapItem | null>(null);
  const [changeDateText, setChangeDateText] = useState("");
  const changeDateInputRef = useRef<TextInput | null>(null);
  const [showStartDisclosure, setShowStartDisclosure] = useState(false);
  const [startDisclosureDismissed, setStartDisclosureDismissed] = useState(false);
  const [mapSortMode, setMapSortMode] = useState<"LATEST" | "ALPHA" | "NEAREST">("ALPHA");
  const [mapSortAnchor, setMapSortAnchor] = useState<LatLon | undefined>(undefined);
  const [observationCounts, setObservationCounts] = useState<Record<string, number>>({});

  const SKOGSMONITOR_URL = "https://karta.skogsmonitor.se/?background=Lantm%C3%A4terietTopowebb&lat=60.55728&layers=17-26-21-14&lng=16.88599&zoom=7";
  const sortLabel = mapSortMode === "NEAREST" ? "Närmast" : mapSortMode === "ALPHA" ? "A - Ö" : "Senast";
  const nextSortMode = mapSortMode === "LATEST" ? "ALPHA" : mapSortMode === "ALPHA" ? "NEAREST" : "LATEST";
  const checkboxName = "checkbox";
  const squareOutlineName = "square-outline";

  useLayoutEffect(() => {
    navigation.setOptions({
      title: "Fältkarta",
      headerTitleAlign: "center",
      headerRight: () => (
        <Text style={styles.headerSortBtnText} onPress={() => { void onChooseSort(nextSortMode); }}>
          {sortLabel}
        </Text>
      ),
    });
  }, [navigation, nextSortMode, sortLabel]);

  function mapCenter(map: MapItem): LatLon | null {
    if (!map.bbox) return null;
    const { minLat, maxLat, minLon, maxLon } = map.bbox;
    if (![minLat, maxLat, minLon, maxLon].every(Number.isFinite)) return null;
    return { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
  }

  function sortMaps(items: MapItem[], mode: "LATEST" | "ALPHA" | "NEAREST", anchor?: LatLon): MapItem[] {
    const copy = [...items];
    if (mode === "ALPHA") {
      copy.sort((a, b) => a.title.localeCompare(b.title, "sv"));
      return copy;
    }
    if (mode === "NEAREST" && anchor) {
      copy.sort((a, b) => {
        const ac = mapCenter(a);
        const bc = mapCenter(b);
        const ad = ac ? distanceMeters(anchor, ac) : Number.POSITIVE_INFINITY;
        const bd = bc ? distanceMeters(anchor, bc) : Number.POSITIVE_INFINITY;
        return ad - bd;
      });
      return copy;
    }
    copy.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (timeB !== timeA) {
        return timeB - timeA;
      }
      const titleCompare = a.title.localeCompare(b.title, "sv");
      if (titleCompare !== 0) {
        return titleCompare;
      }
      return a.id.localeCompare(b.id);
    });
    return copy;
  }

  function clampPingInput(value: string): string {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return "2";
    const clamped = Math.min(20, Math.max(2, parsed));
    return String(clamped);
  }

  function clampMaxImageSize(value: string): string {
    const parsed = Number.parseFloat(value.replace(",", "."));
    if (!Number.isFinite(parsed)) return "2";
    const clamped = Math.min(9, Math.max(1, parsed));
    return String(clamped);
  }

  function clampMaxSideInput(value: string): string {
    const digitsOnly = value.replace(/\D/g, "");
    const parsed = Number.parseInt(digitsOnly, 10);
    if (!Number.isFinite(parsed)) return "1400";
    const clamped = Math.min(4000, Math.max(1000, parsed));
    return String(clamped);
  }

  const refresh = useCallback(async () => {
    const [allMaps, settings, savedMaxSide] = await Promise.all([
      loadMaps(),
      loadSettings(),
      getMaxSideSetting(),
    ]);
    const mode = settings.mapSortMode ?? "LATEST";
    setMapSortMode(mode);
    setMapSortAnchor(settings.mapSortAnchor);
    setMaps(sortMaps(allMaps, mode, settings.mapSortAnchor));
    setAutoFollow(settings.autoFollow ?? false);
    setGpsPingSeconds("2"); // setGpsPingSeconds(String(settings.gpsPingSeconds));
    setGpsOptions({ pingSeconds: settings.gpsPingSeconds, backgroundGPS: gpsOptions.backgroundGPS });
    setVisibleFields(settings.visibleFields ?? {
      quantity: false,
      unit: false,
      hostSpecies: false,
      activity: false,
      substrate: false,
      stage: false,
      gender: false,
    });
    setMaxImageSizeMB(String(settings.maxImageSizeMB ?? 2));
    setMaxSide(String(savedMaxSide));
    setCoordinateSystem(settings.coordinateSystem ?? "SWEREF99");
    const descriptions = await loadAreaDescriptions();
    setAreaDescriptions(descriptions);
    const byMap = await loadObservationsByMapId();
    const counts: Record<string, number> = {};
    for (const mapId in byMap) {
      counts[mapId] = byMap[mapId]?.length ?? 0;
    }
    setObservationCounts(counts);
  }, [gpsOptions.backgroundGPS, setGpsOptions]);

  useEffect(() => {
    const resetBackgroundGpsOnAppOpen = async () => {
      try {
        const settings = await loadSettings();
        const pingSeconds = settings.gpsPingSeconds ?? 2;
        setGpsOptions({ pingSeconds, backgroundGPS: false });
        if (settings.backgroundGPS) {
          await saveSettings({
            ...settings,
            backgroundGPS: false,
          });
        }
      } catch (error) {
        console.error("Kunde inte nollställa bakgrunds-GPS vid appstart:", error);
      }
    };
    void resetBackgroundGpsOnAppOpen();
  }, [setGpsOptions]);

  useFocusEffect(
    useCallback(() => {      
      refresh();
    }, [refresh])
  );

  useEffect(() => {
    if (!foregroundPermissionKnown) return;
    if (!foregroundPermissionGranted && !startDisclosureDismissed) {
      setShowStartDisclosure(true);
    }
  }, [foregroundPermissionGranted, foregroundPermissionKnown, startDisclosureDismissed]);

  useEffect(() => {
    if (!changeDateMap) return;
    const timer = setTimeout(() => {
      changeDateInputRef.current?.focus();
    }, 250);
    return () => clearTimeout(timer);
  }, [changeDateMap]);

  async function onImport() {
    try {
      const item = await pickAndImportGeoTiff(setShowMapBuildLoading);
      if (!item) return;
      const next = await upsertMap(item);
      setMaps(sortMaps(next, mapSortMode, mapSortAnchor));
      /*
    setTimeout(() => {
      setRenameMap(item);
      setRenameValue(item.title.toLowerCase().includes("skogsmonitor") ? "" : item.title);
      setRenameMode("import");
      setShowRenameHint(true);
    }, 300);
    */
    } catch (error) {
      Alert.alert("Importfel", String(error));
    }
  }

  function hideMapBuildLoading() {
    setShowMapBuildLoading(false);
  }

  async function onGenerateBlankMap() {
    try {
      setShowImportMenu(false);

      let center = gpsPos;
      try {
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        center = { lat: current.coords.latitude, lon: current.coords.longitude };
      } catch {
        // Fall back to latest known GPS from context.
      }

      if (!center) {
        Alert.alert("Ingen GPS-position", "Kunde inte hämta din aktuella position. Prova igen när GPS har hittat position.");
        return;
      }

      const item = await createBlankGeoTiffMap(center);
      const next = await upsertMap(item);
      setMaps(sortMaps(next, mapSortMode, mapSortAnchor));
      setRenameMap(item);
      setRenameValue("");
      setRenameMode("import");
      setShowRenameHint(true);
    } catch (error) {
      Alert.alert("Kunde inte skapa tom karta", String(error));
    }
  }

  async function onChooseSort(mode: "LATEST" | "ALPHA" | "NEAREST") {
    let anchor = mapSortAnchor;
    if (mode === "NEAREST") {
      let center = gpsPos;
      try {
        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        center = { lat: current.coords.latitude, lon: current.coords.longitude };
      } catch {
        // fallback to current gpsPos
      }
      if (!center) {
        Alert.alert("Ingen GPS-position", "Kunde inte hämta position för sortering på närmast.");
        return;
      }
      anchor = center;
    } else {
      anchor = undefined;
    }

    setMapSortMode(mode);
    setMapSortAnchor(anchor);
    setMaps((prev) => sortMaps(prev, mode, anchor));

    const settings = await loadSettings();
    await saveSettings({
      ...settings,
      mapSortMode: mode,
      mapSortAnchor: anchor,
    });
  }


  function onOpenMenu(item: MapItem) {
    setMenuMap(item);
  }

  function openDescriptionModal(item: MapItem) {
    setDescriptionModalMap(item);
    setDescriptionText(areaDescriptions[item.id] ?? "");
  }

  async function toggleMapStatus(mapId: string, field: "isBackedUp" | "isReportedToAP", value: boolean) {
    const existing = maps.find((m) => m.id === mapId);
    if (!existing) return;
    const updated: MapItem = {
      ...existing,
      [field]: value,
    };
    const next = await upsertMap(updated);
    setMaps(sortMaps(next, mapSortMode, mapSortAnchor));
    if (menuMap?.id === mapId) {
      setMenuMap(updated);
    }
  }

  async function saveDescription() {
    if (!descriptionModalMap) return;
    const next = await saveAreaDescription(descriptionModalMap.id, descriptionText);
    setAreaDescriptions(next);
    setDescriptionModalMap(null);
  }

  function cancelDescriptionModal() {
    setDescriptionModalMap(null);
    setDescriptionText("");
  }

  function openRename(item: MapItem) {
    setRenameMap(item);
    setRenameValue(item.title);
    setRenameMode("edit");
    setShowRenameHint(false);
  }

  function openChangeDate(mapItem: MapItem) {
    setChangeDateMap(mapItem);
    setChangeDateText(mapItem.createdAt.slice(0, 10));
  }

  function cancelChangeDate() {
    setChangeDateMap(null);
    setChangeDateText("");
  }

  async function confirmChangeDate() {
    if (!changeDateMap) return;
    const inputText = changeDateText.trim();
    if (!inputText) {
      Alert.alert("Fel", "Ange ett datum.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inputText)) {
      Alert.alert("Fel", "Ogiltigt datumformat. Använd ÅAAA-MM-DD.");
      return;
    }

    const [yearText, monthText, dayText] = inputText.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const parsedDate = new Date(year, month - 1, day);

    if (
      !Number.isFinite(year) ||
      !Number.isFinite(month) ||
      !Number.isFinite(day) ||
      parsedDate.getFullYear() !== year ||
      parsedDate.getMonth() !== month - 1 ||
      parsedDate.getDate() !== day
    ) {
      Alert.alert("Fel", "Ogiltigt datumformat. Använd ÅAAA-MM-DD.");
      return;
    }

    try {
      const updatedMap: MapItem = {
        ...changeDateMap,
        createdAt: parsedDate.toISOString(),
      };
      await upsertMap(updatedMap);
      await refresh();
      cancelChangeDate();
    } catch (err) {
      Alert.alert("Fel", "Kunde inte spara det nya datumet.");
    }
  }

  async function confirmRename() {
    if (!renameMap) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      Alert.alert("Namn saknas", "Du måste ange ett namn på kartan.");
      return;
    }
    const updated: MapItem = {
      ...renameMap,
      title: trimmed,
    };
    const next = await renameMapAndSyncPointLocalNames(updated, renameMap.title);
    setMaps(sortMaps(next, mapSortMode, mapSortAnchor));
    setRenameMap(null);
    setRenameValue("");
    setShowRenameHint(false);
    setRenameMode(null);
  }

  async function cancelRename() {
    const current = renameMap;
    const mode = renameMode;
    setRenameMap(null);
    setRenameValue("");
    setShowRenameHint(false);
    setRenameMode(null);

    if (mode === "import" && current) {
      await deleteIfExists(getSafeUri(current.fileName, "map"));
      if (current.previewFileName) {
        await deleteIfExists(getSafeUri(current.previewFileName, "preview"));
      }
      const next = await removeMap(current.id);
      setMaps(sortMaps(next, mapSortMode, mapSortAnchor));
    }
  }
  const onSaveSettings = async () => {
    try {
      //const parsedPing = Number.parseInt(gpsPingSeconds, 10);
      //const rawPing = Number.isFinite(parsedPing) ? parsedPing : 3;
      const pingValue = 2; // Math.min(20, Math.max(2, rawPing));
      const parsedMaxSize = Number.parseFloat(maxImageSizeMB.replace(",", "."));
      const maxSizeValue = Number.isFinite(parsedMaxSize) && parsedMaxSize > 0 ? parsedMaxSize : 2;
      const maxSideValue = Number.parseInt(clampMaxSideInput(maxSide), 10);

      const newSettings: AppSettings = {
        gpsPingSeconds: pingValue,
        visibleFields: visibleFields,
        maxImageSizeMB: maxSizeValue,
        backgroundGPS: gpsOptions.backgroundGPS,
        autoFollow: autoFollow,
        coordinateSystem: coordinateSystem,
        mapSortMode: mapSortMode,
        mapSortAnchor: mapSortAnchor,
      };

      
      await saveSettings(newSettings);
      await saveMaxSideSetting(maxSideValue);
      setGpsOptions({ pingSeconds: pingValue, backgroundGPS: gpsOptions.backgroundGPS });
      
      
      setGpsPingSeconds(String(pingValue));
      setMaxImageSizeMB(String(maxSizeValue));
      setMaxSide(String(maxSideValue));
      
      setShowSettings(false);
    } catch (error) {
      console.error("Kunde inte spara inställningar:", error);
      Alert.alert("Fel", "Kunde inte spara inställningarna.");
    }
  };


  const setBackgroundGpsState = async (nextState: boolean) => {
    const pingValue = Number.parseInt(clampPingInput(gpsPingSeconds), 10) || 3;

    setGpsOptions({
      pingSeconds: pingValue,
      backgroundGPS: nextState,
    });

    try {
      await saveSettings({
        gpsPingSeconds: pingValue,
        backgroundGPS: nextState,
        visibleFields: visibleFields,
        maxImageSizeMB: Number.parseFloat(maxImageSizeMB.replace(",", ".")) || 3,
        autoFollow: autoFollow,
        coordinateSystem: coordinateSystem,
        mapSortMode: mapSortMode,
        mapSortAnchor: mapSortAnchor,
      });
    } catch (error) {
      console.error("Kunde inte spara inställningar:", error);
    }
  };

  const toggleBackgroundGPS = async () => {
    if (gpsOptions.backgroundGPS) {
      await setBackgroundGpsState(false);
      return;
    }

    try {
      const bg = await Location.getBackgroundPermissionsAsync();
      if (bg.status === "granted") {
        await setBackgroundGpsState(true);
        return;
      }
      setShowBackgroundDisclosure(true);
    } catch (error) {
      console.error("Kunde inte kontrollera platsbehörighet:", error);
      setShowBackgroundDisclosure(true);
    }
  };

  const onApproveBackgroundDisclosure = async () => {
    setShowBackgroundDisclosure(false);
    try {
      const bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.status === "granted") {
        await setBackgroundGpsState(true);
      }
    } catch (error) {
      console.error("Kunde inte begära bakgrundsbehörighet:", error);
    }
  };

  const onDeclineDisclosure = async (which: "start" | "background") => {
    if (which === "start") {
      setShowStartDisclosure(false);
      setStartDisclosureDismissed(true);
    } else {
      setShowBackgroundDisclosure(false);
    }
    await setBackgroundGpsState(false);
  };

  function onOpenMap(item: MapItem) {
    navigation.navigate("Map", { mapId: item.id });
  }

  async function importPolygonAreas(map: MapItem) {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) {
        return;
      }
      const asset = result.assets[0];
      const lower = asset.name.toLowerCase();
      if (!lower.endsWith(".json") && !lower.endsWith(".geojson")) {
        Alert.alert("Fel filtyp", "Välj en .json- eller .geojson-fil.");
        return;
      }

      const hydrated = await ensureMapGeorefBounds(map);
      const bbox = hydrated.bbox;
      if (!bbox) {
        Alert.alert("Saknar kartgränser", "Kartan saknar gränser för att kunna filtrera polygoner.");
        return;
      }

      const raw = await FileSystem.readAsStringAsync(asset.uri);
      const parsed = JSON.parse(raw) as any;
      const crsName = String(parsed?.crs?.properties?.name ?? parsed?.crs?.name ?? "").toUpperCase();
      const sourceCrs =
        crsName.includes("EPSG:3857") || crsName.includes("EPSG::3857")
          ? "EPSG:3857"
          : crsName.includes("EPSG:3006") || crsName.includes("EPSG::3006") || crsName.includes("SWEREF")
            ? "EPSG:3006"
            : crsName.includes("EPSG:4326") || crsName.includes("EPSG::4326") || crsName.includes("CRS84")
            ? "EPSG:4326"
            : null;
      const features = Array.isArray(parsed?.features)
        ? parsed.features
        : parsed?.type === "Feature"
          ? [parsed]
          : parsed?.type === "Polygon"
            ? [{ type: "Feature", geometry: parsed, properties: {} }]
            : [];
      if (!features.length) {
        Alert.alert("Ingen data", "Filen innehåller inga polygoner.");
        return;
      }

      const nextPolygons: PolygonObservation[] = [];
      let autoNameCounter = 0;
      const now = new Date().toISOString();

      for (const feature of features) {
        const geomType = String(feature?.geometry?.type ?? "");
        const coords = feature?.geometry?.coordinates;
        const polygons =
          geomType === "Polygon"
            ? [coords]
            : geomType === "MultiPolygon"
              ? coords
              : [];
        if (!Array.isArray(polygons) || polygons.length === 0) continue;

        const featurePolygonName = String(feature?.properties?.polygonName ?? "").trim();
        const featureId = String(feature?.properties?.id ?? "").trim();
        const baseName = featurePolygonName || featureId || "";
        const hasMultiple = polygons.length > 1;
        let partIndex = 0;

        for (const poly of polygons) {
          if (!Array.isArray(poly) || !Array.isArray(poly[0]) || poly[0].length < 3) continue;
          const ring = poly[0];
          const points = ring
            .map((pair: any) => {
              const rawLon = Number(pair?.[0]);
              const rawLat = Number(pair?.[1]);
              if (!Number.isFinite(rawLon) || !Number.isFinite(rawLat)) return null;
              const inferredCrs =
                sourceCrs ??
                (Math.abs(rawLon) > 180 || Math.abs(rawLat) > 90
                  ? Math.abs(rawLon) <= 1_200_000 && Math.abs(rawLat) >= 5_000_000 && Math.abs(rawLat) <= 8_000_000
                    ? "EPSG:3006"
                    : "EPSG:3857"
                  : "EPSG:4326");
              if (inferredCrs === "EPSG:3006") {
                const wgs84 = sweref99tmToWgs84(rawLon, rawLat);
                if (!wgs84) return null;
                return { lon: wgs84.lon, lat: wgs84.lat };
              }
              if (inferredCrs === "EPSG:3857") {
                const wgs84 = meters3857ToWgs84(rawLon, rawLat);
                if (!wgs84) return null;
                return { lon: wgs84.lon, lat: wgs84.lat };
              }
              return { lon: rawLon, lat: rawLat };
            })
            .filter((p: any): p is { lon: number; lat: number } => !!p);
          if (points.length < 3) continue;
          const clipped = clipPolygonToBbox(points, bbox);
          if (clipped.length < 3) continue;

          partIndex += 1;
          let polygonName = baseName;
          if (!polygonName) {
            autoNameCounter += 1;
            polygonName = `Område ${autoNameCounter}`;
          } else if (hasMultiple) {
            polygonName = `${polygonName} ${partIndex}`;
          }
          const notes = String(feature?.properties?.notes ?? "").trim();

          nextPolygons.push({
            id: makeId("obs"),
            mapId: map.id,
            kind: "polygon",
            polygonName,
            count: 1,
            notes,
            photoUris: [],
            dateISO: now,
            wgs84: clipped,
          });
        }
      }

      if (!nextPolygons.length) {
        Alert.alert("Ingen data", "Inga polygoner kunde importeras.");
        return;
      }

      const byMap = await loadObservationsByMapId();
      const current = byMap[map.id] ?? [];
      byMap[map.id] = [...nextPolygons, ...current];
      await saveObservationsByMapId(byMap);

      Alert.alert("Import klar", `Tillagda polygoner: ${nextPolygons.length}`);
    } catch (error) {
      Alert.alert("Importfel", String(error));
    }
  }

  function clipPolygonToBbox(
    points: Array<{ lat: number; lon: number }>,
    bbox: { minLat: number; minLon: number; maxLat: number; maxLon: number }
  ): Array<{ lat: number; lon: number }> {
    const input = points.map((p) => ({ x: p.lon, y: p.lat }));
    const edges = [
      { inside: (p: any) => p.x >= bbox.minLon, intersect: (a: any, b: any) => intersectVertical(a, b, bbox.minLon) },
      { inside: (p: any) => p.x <= bbox.maxLon, intersect: (a: any, b: any) => intersectVertical(a, b, bbox.maxLon) },
      { inside: (p: any) => p.y >= bbox.minLat, intersect: (a: any, b: any) => intersectHorizontal(a, b, bbox.minLat) },
      { inside: (p: any) => p.y <= bbox.maxLat, intersect: (a: any, b: any) => intersectHorizontal(a, b, bbox.maxLat) },
    ];

    let output = input;
    for (const edge of edges) {
      const next: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < output.length; i++) {
        const current = output[i];
        const prev = output[(i + output.length - 1) % output.length];
        const currentInside = edge.inside(current);
        const prevInside = edge.inside(prev);
        if (currentInside) {
          if (!prevInside) {
            next.push(edge.intersect(prev, current));
          }
          next.push(current);
        } else if (prevInside) {
          next.push(edge.intersect(prev, current));
        }
      }
      output = next;
      if (output.length === 0) break;
    }

    const ring = output.map((p) => ({ lon: p.x, lat: p.y }));
    if (ring.length > 0) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first.lon !== last.lon || first.lat !== last.lat) {
        ring.push({ ...first });
      }
    }
    return ring;
  }

  function intersectVertical(a: { x: number; y: number }, b: { x: number; y: number }, x: number) {
    if (a.x === b.x) return { x, y: a.y };
    const t = (x - a.x) / (b.x - a.x);
    return { x, y: a.y + (b.y - a.y) * t };
  }

  function intersectHorizontal(a: { x: number; y: number }, b: { x: number; y: number }, y: number) {
    if (a.y === b.y) return { x: a.x, y };
    const t = (y - a.y) / (b.y - a.y);
    return { x: a.x + (b.x - a.x) * t, y };
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={maps}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.emptyText}>{"Inga kartor \u00e4nnu. Tryck + f\u00f6r import."}</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.mapRow}>
            <Pressable style={styles.mapClickableArea} onPress={() => onOpenMap(item)}>
              {item.previewFileName ? (
                <Image source={{ uri: getSafeUri(item.previewFileName, "preview") }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder]}>
                  <Text style={styles.thumbText}>TIFF</Text>
                </View>
              )}
              <View style={styles.mapMeta}>
                <Text style={styles.mapName} numberOfLines={1}>
                  {item.title}
                </Text>
                <View style={styles.mapStatusRow}>
                  {/* 📝 ANTECKNINGS-IKON - Visas endast om det finns text i beskrivningen/anteckningen */}
                  {areaDescriptions[item.id] && areaDescriptions[item.id].trim() !== "" ? (
                    <View style={[styles.listIconBox, { backgroundColor: "#838181" }]}> 
                      <Text style={styles.listEmojiInsideBox}>📝</Text>
                    </View>
                  ) : null}

                  {/* ☁️ MOLN-STATUS - Visas endast om item.isBackedUp är sant */}
                  {item.isBackedUp ? Platform.select({
                    ios: (
                      <Ionicons 
                        name="cloud-done" 
                        size={22} 
                        color="#2196f3" 
                        style={styles.mapStatusIcon} 
                      />
                    ),
                    android: (
                      <View style={[styles.listIconBox, { backgroundColor: "#2196f3" }]}>
                        <Text style={styles.listEmojiInsideBox}>☁️</Text>
                      </View>
                    )
                  }) : null}
                  {item.isReportedToAP ? <Text style={styles.listEmojiIcon}>✅</Text> : null}
                  <Text style={styles.mapDate}>{new Date(item.createdAt).toLocaleDateString()}</Text>
                </View>
              </View>
            </Pressable>

            <View style={styles.mapActionsContainer}>
              {(observationCounts[item.id] ?? 0) > 0 ? (
                <Pressable 
                  style={styles.exportBtn} 
                  onPress={() => navigation.navigate("Export", { mapId: item.id })}
                  hitSlop={{ top: 8, bottom: 0, left: 12, right: 8 }}
                >
                  <Ionicons name="share-outline" size={25} color="#005f73" />
                </Pressable>
              ) : null}
              <Pressable style={styles.menuBtn} onPress={() => onOpenMenu(item)} 
                hitSlop={{ top: 0, bottom: 8, left: 12, right: 8 }}>
                <Text style={styles.menuText}>...</Text>
              </Pressable>
            </View>
          </View>
        )}
      />

      <Pressable style={styles.fab} onPress={() => setShowImportMenu(true)}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>

     <Pressable style={styles.infoFab} onPress={() => setShowSettings(true)}>
        {Platform.select({
          ios: (
            <Text style={styles.iosGearEmoji}>
              ⚙️
            </Text>
          ),
          android: (
            <Text style={styles.androidGearEmoji}>
              ⚙️
            </Text>
          )
        })}
      </Pressable>

      <Pressable 
        style={[
          styles.exitFab, 
          gpsOptions.backgroundGPS ? { backgroundColor: "#3b9640" } : { backgroundColor: "#9b9b9b" }
        ]} 
        onPress={toggleBackgroundGPS}
      >
        <Text style={styles.exitFabText}>BakgrundsGPS</Text> 
      </Pressable>

      <Modal
        transparent
        visible={showStartDisclosure}
        onRequestClose={() => {
            setShowStartDisclosure(false);
            setStartDisclosureDismissed(true);
            void requestForegroundPermission();
          }}
        animationType="fade"
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Fältkarta vill använda din position</Text>
            <Text style={styles.disclosureText}>
              Fältkarta samlar in platsdata för att visa din position på kartan och för att du ska kunna registrera artobservationer. Denna data används även för att logga din rutt i bakgrunden om du väljer att aktivera den funktionen.
            </Text>
            <View style={styles.modalActions}>
             
              <Pressable
                style={[styles.modalBtn, styles.okBtn, styles.modalBtnLong]}
                onPress={() => {
                  setShowStartDisclosure(false);
                  setStartDisclosureDismissed(true);
                  void requestForegroundPermission();
                }}
              >
                <Text style={styles.modalBtnText}>OK</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={showBackgroundDisclosure}
        onRequestClose={() => {
          void onApproveBackgroundDisclosure();
        }}       
        animationType="fade"
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Information om platsdata</Text>
            <Text style={styles.disclosureText}>
              Fältkarta kan, om du tillåter, använda platsdata även när appen är stängd eller inte används. 
            </Text>
            <Text style={styles.disclosureText}>
              Detta görs för att funktionen BakgrundsGPS ska kunna behålla kontakten med satelliterna när din skärm är avstängd.
            </Text>
            <Text style={styles.disclosureText}>
              Om systemets dialogruta inte visas: Gå till Inställningar &gt; Appar &gt; Fältkarta &gt; Plats för att aktivera funktionen.
            </Text>
            <View style={styles.modalActions}>
              
              <Pressable
                onPress={() => {
                  void onApproveBackgroundDisclosure();
                }}
                style={[styles.modalBtn, styles.okBtn, styles.modalBtnLong]}
              >
                <Text style={styles.modalBtnText}>OK, jag förstår</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={showImportMenu} onRequestClose={() => setShowImportMenu(false)} animationType="slide">
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowImportMenu(false)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Lägg till karta</Text>

            <Text style={styles.sectionTitle}>Hämta ny karta</Text>
            <Pressable
              style={styles.menuActionBtn}
              onPress={() => {
                setShowImportMenu(false);
                void Linking.openURL(SKOGSMONITOR_URL);
              }}
            >
              <Text style={styles.menuActionText}>Öppna webbläsaren</Text>
            </Pressable>
            <Text style={styles.helpText}>Öppnar Skogsmonitor.se för att hitta och ladda ner kartor.</Text>

            <Text style={styles.sectionTitle}>Redan nedladdad</Text>
            <Pressable
              style={styles.menuActionBtn}
              onPress={async () => {
                setShowImportMenu(false);
                await new Promise((resolve) => setTimeout(resolve, 800));
                void onImport();
              }}
            >
              <Text style={styles.menuActionText}>Ladda från enhet</Text>
            </Pressable>
            <Text style={styles.helpText}>Välj en GeoTIFF-fil som redan finns på din telefon.</Text>

            <Text style={styles.sectionTitle}>Skapa en tom karta</Text>
            <Pressable
              style={styles.menuActionBtn}
              onPress={() => {
                void onGenerateBlankMap();
              }}
            >
              <Text style={styles.menuActionText}>Generera tom karta</Text>
            </Pressable>
            <Text style={styles.helpText}>Öppnar en ny tom karta, som kan användas som nödkarta.</Text>

          </View>
        </View>
      </Modal>


      <Modal transparent visible={!!renameMap} onRequestClose={() => { void cancelRename(); }} animationType="fade">
        <View style={[styles.modalBackdrop, { justifyContent: 'flex-start' }]}>
          <View style={[styles.modalCard, { marginTop: 60, maxHeight: '80%' }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>Byt kartnamn</Text>
              <Text style={styles.renameHint}>
                Kartans namn används som förslag till lokalnamn vid punktobservationer.
              </Text>
              <Text style={styles.renameHint}>
                Namnbyte ändrar ev. punkter vars lokalnamn matchar det gamla kartnamnet.
              </Text>
              <TextInput value={renameValue} onChangeText={setRenameValue} style={styles.modalInput} placeholder="Skriv nytt kartnamn..." placeholderTextColor="#999"/>
              <View style={styles.modalActions}>
                <Pressable
                  onPress={() => {
                    void cancelRename();
                  }}
                  style={[styles.modalBtn, styles.cancelBtn, styles.modalBtnShort]}
                >
                  <Text style={styles.modalBtnText}>Avbryt</Text>
                </Pressable>
                <Pressable
                  onPress={confirmRename}
                  disabled={renameValue.trim().length === 0}
                  style={[
                    styles.modalBtn,
                    styles.okBtn,
                    styles.modalBtnWide,
                    renameValue.trim().length === 0 ? { opacity: 0.6 } : undefined,
                  ]}
                >
                  <Text style={styles.modalBtnText}>Spara</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={!!menuMap} onRequestClose={() => setMenuMap(null)} animationType="slide">
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuMap(null)} />
          <View style={styles.menuModalCard}>
            <Text style={styles.modalTitle}>{menuMap?.title ?? "Karta"}</Text>

            <Pressable
              style={styles.menuActionBtn}
              onPress={() => {
                if (!menuMap) return;
                const selected = menuMap;
                setMenuMap(null);
                openDescriptionModal(selected);
              }}
            >
              <Text style={styles.menuActionText}>Anteckningar</Text>
            </Pressable>
            <Pressable
              style={styles.menuActionBtn}
              onPress={async () => {
                if (!menuMap) return;
                const selected = menuMap;
                setMenuMap(null);
                await new Promise((resolve) => setTimeout(resolve, 800));
                setImportPolygonMap(selected);
              }}
            >
              <Text style={styles.menuActionText}>Importera polygon</Text>
            </Pressable>
            <Pressable
              style={styles.menuActionBtn}
              onPress={() => {
                setMenuMap(null);
                navigation.navigate("Export", { mapId: menuMap?.id ?? "" });
              }}
            >
              <Text style={styles.menuActionText}>Exportera</Text>
            </Pressable>

            {/* ─── STATUSSEKTION ─── */}
            <View style={styles.menuDivider} />
            
            <Text style={styles.statusSectionTitle}>Status</Text>
            
            <View style={styles.iconStatusRow}>
              {/* MOLN-IKON (Säkerhetskopiering) */}
              <Pressable 
                style={styles.statusIconBtn} 
                onPress={() => {
                  if (!menuMap) return;
                  const currentStatus = menuMap.isBackedUp ?? false;
                  void toggleMapStatus(menuMap.id, 'isBackedUp', !currentStatus);
                }}
              >
                {Platform.select({
                  ios: (
                    /* iOS:  */
                    <Ionicons 
                      name={menuMap?.isBackedUp ? "cloud-done" : "cloud-offline-outline"} 
                      size={42} 
                      color={menuMap?.isBackedUp ? "#2196f3" : "#999999"} 
                    />
                  ),
                  android: (
                    /* Android: Säker, färgad bakgrundsruta med emoji som inte buggar */
                    <View 
                      style={[
                        styles.iconContainerBox, 
                        { backgroundColor: menuMap?.isBackedUp ? "#2196f3" : "#e0e0e0" },
                        { transform: [{ translateY: 3 }] } // Din Android-justering för höjden
                      ]}
                    >
                      <Text style={[styles.emojiIconBox, { opacity: menuMap?.isBackedUp ? 1 : 0.6 }]}>
                        ☁️
                      </Text>
                    </View>
                  )
                })}
              </Pressable>

              {/* CHECK-IKON (Artportalen) */}
              <Pressable 
                style={styles.statusIconBtn} 
                onPress={() => {
                  if (!menuMap) return;
                  const currentStatus = menuMap.isReportedToAP ?? false;
                  void toggleMapStatus(menuMap.id, 'isReportedToAP', !currentStatus);
                }}
              >
                <Text style={{ fontSize: 26, color: menuMap?.isReportedToAP ? "#4caf50" : "#999999" }}>
                  {menuMap?.isReportedToAP ? "✅" : "☑️"}
                </Text>
              </Pressable>
            </View>
            
            <View style={styles.menuDivider} />
            {/* ────────────────────── */}

            <Pressable
              style={styles.menuActionBtn}
              onPress={() => {
                if (!menuMap) return;
                setMenuMap(null);
                openRename(menuMap);
              }}
            >
              <Text style={styles.menuActionText}>Byt namn</Text>
            </Pressable>

            <Pressable
              style={styles.menuActionBtn}
              onPress={() => {
                if (!menuMap) return;
                setMenuMap(null); // Stänger modalen
                openChangeDate(menuMap); 
              }}
            >
              <Text style={styles.menuActionText}>Ändra datum</Text>
            </Pressable>

            <Pressable
              style={[styles.menuActionBtn, styles.menuDangerBtn]}
              onPress={() => {
                if (!menuMap) return;
                const selected = menuMap;
                setMenuMap(null);
                setDeleteMap(selected);
              }}
            >
              <Text style={styles.menuActionText}>Radera karta</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={!!descriptionModalMap}
        onRequestClose={saveDescription}
        animationType="slide"
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={saveDescription} />
          
          <KeyboardAvoidingView 
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.keyboardView}
          >
            <View style={[styles.modalCard, styles.descriptionModalCard]}>
              <Text style={styles.modalTitle}>Anteckningar</Text>
              
              {Platform.OS === "android" ? (
                <ScrollView 
                  style={styles.modalScrollView} 
                  contentContainerStyle={styles.modalScrollViewContent}
                  keyboardShouldPersistTaps="handled"
                >
                  <TextInput
                    value={descriptionText}
                    onChangeText={setDescriptionText}
                    multiline
                    textAlignVertical="top"
                    style={[styles.modalInput, styles.descriptionInput]}
                    placeholder="Valfri text..."
                    placeholderTextColor="#999"
                  />
                </ScrollView>
              ) : (
                <TextInput
                  value={descriptionText}
                  onChangeText={setDescriptionText}
                  multiline
                  textAlignVertical="top"
                  style={[styles.modalInput, styles.descriptionInput, styles.descriptionInputIOS]}
                  placeholder="Valfri text..."
                  placeholderTextColor="#999"
                />
              )}
              
              
              <View style={styles.modalActionsThree}>
                <Pressable
                  onPress={cancelDescriptionModal}
                  style={[styles.modalBtn, styles.cancelBtn, styles.modalBtnShort]}
                >
                  <Text style={styles.modalBtnText}>Avbryt</Text>
                </Pressable>
                <Pressable
                  onPress={() => setDescriptionText("")}
                  style={[styles.modalBtn, styles.clearBtn, styles.modalBtnShort]}
                >
                  <Text style={styles.modalBtnText}>Rensa</Text>
                </Pressable>
                <Pressable
                  onPress={saveDescription}
                  style={[styles.modalBtn, styles.okBtn, styles.modalBtnShort]}
                >
                  <Text style={styles.modalBtnText}>Spara</Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal transparent visible={!!changeDateMap} onRequestClose={cancelChangeDate} animationType="slide">
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={cancelChangeDate} />
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.keyboardView}
          >
            <View style={[styles.modalCard, styles.changeDateModalCard]}>
              <Text style={styles.modalTitle}>Ändra datum</Text>
              <Text style={styles.helpText}>Ange nytt datum i formatet ÅÅÅÅ-MM-DD.</Text>
              <TextInput
                ref={changeDateInputRef}
                value={changeDateText}
                onChangeText={setChangeDateText}
                placeholder="ÅÅÅÅ-MM-DD"
                placeholderTextColor="#999"
                style={styles.modalInput}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus={true}
              />
              <View style={styles.modalActionsThree}>
                <Pressable
                  onPress={cancelChangeDate}
                  style={[styles.modalBtn, styles.cancelBtn, styles.modalBtnShort]}
                >
                  <Text style={styles.modalBtnText}>Avbryt</Text>
                </Pressable>
                <Pressable
                  onPress={confirmChangeDate}
                  style={[styles.modalBtn, styles.okBtn, styles.modalBtnShort]}
                >
                  <Text style={styles.modalBtnText}>Spara</Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal transparent visible={showSettings} onRequestClose={() => setShowSettings(false)} animationType="fade">
        <KeyboardAvoidingView
          style={styles.settingsModalWrap}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={[styles.modalBackdrop, styles.settingsModalBackdrop]}>
              <TouchableWithoutFeedback onPress={() => {}}>
                <View style={[styles.modalCard, styles.settingsModalCard]}>
                  <ScrollView keyboardShouldPersistTaps="handled">
                    <Text style={[styles.modalTitle, { textAlign: 'center', alignSelf: 'center' }]}>Inställningar</Text>

                    {/* <View style={styles.settingsRow}>
  <Text style={styles.settingsTitle}>GPS pingfrekvens (2-20s)</Text>
  <TextInput
    value={gpsPingSeconds}
    onChangeText={setGpsPingSeconds}
    onBlur={() => setGpsPingSeconds(clampPingInput(gpsPingSeconds))}
    style={styles.pingInput}
    keyboardType="number-pad"
  />
</View> 
*/}
                    <View style={styles.settingsRowColumn}>
                      <Text style={styles.settingsTitle}>Koordinatsystem för export</Text>
                      
                      {/* Yttre balken (Ramen) */}
                      <View style={styles.segmentedControlBg}>
                        
                        {/* Knapp 1: WGS84 */}
                        <Pressable 
                          style={[
                            styles.segmentedControlTab, 
                            coordinateSystem === "WGS84" && styles.segmentedControlTabActive
                          ]}
                          onPress={() => setCoordinateSystem("WGS84")}
                        >
                          <Text style={[
                            styles.segmentedControlText, 
                            coordinateSystem === "WGS84" && styles.segmentedControlTextActive
                          ]}>
                            WGS84
                          </Text>
                        </Pressable>

                        {/* Knapp 2: SWEREF99 */}
                        <Pressable 
                          style={[
                            styles.segmentedControlTab, 
                            coordinateSystem === "SWEREF99" && styles.segmentedControlTabActive
                          ]}
                          onPress={() => setCoordinateSystem("SWEREF99")}
                        >
                          <Text style={[
                            styles.segmentedControlText, 
                            coordinateSystem === "SWEREF99" && styles.segmentedControlTextActive
                          ]}>
                            SWEREF99 TM
                          </Text>
                        </Pressable>

                      </View>
                    </View>

                    <Pressable
                      style={[styles.settingsRow, { marginVertical: 6, alignItems: "center" }]}
                      onPress={() => setAutoFollow((prev) => !prev)}
                    >
                      <Text style={styles.settingsTitle}>Följ min position vid centrering</Text>
                      <Ionicons
                        name={autoFollow ? checkboxName : squareOutlineName}
                        size={24}
                        color={autoFollow ? "#0a9396" : "#767577"}
                      />
                    </Pressable>

                    <View style={styles.settingsRow}>
                      <Text style={styles.settingsTitle}>Max bildstorlek vid export (MB)</Text>
                      <TextInput
                        value={maxImageSizeMB}
                        onChangeText={setMaxImageSizeMB}
                        onBlur={() => setMaxImageSizeMB(clampMaxImageSize(maxImageSizeMB))}
                        style={styles.pingInput}
                        keyboardType="decimal-pad"
                      />
                    </View>

                    <View style={styles.settingsRow}>
                      <Text style={styles.settingsTitle}>Maxstorlek på kartan</Text>
                      <Pressable
                        style={styles.infoIconBtn}
                        onPress={() =>
                          Alert.alert(
                            "Maxstorlek på kartan",
                            "1000 - 4000px \nHögre värde ger skarpare kartor vid inzoomning men kräver mer minne och batteri. Det kan också göra att appen blir seg och hackar beroende på vilken mobil som används. \nGäller endast för kartor som importeras efter att inställningen ändrats."
                          )
                        }
                      >
                        <Text style={styles.infoIconText}>i</Text>
                      </Pressable>
                      <TextInput
                        value={maxSide}
                        onChangeText={(value) => setMaxSide(value.replace(/\D/g, "").slice(0, 4))}
                        onBlur={() => setMaxSide(clampMaxSideInput(maxSide))}
                        style={styles.maxSideInput}
                        keyboardType="number-pad"
                        maxLength={4}
                      />
                    </View>

                    <View style={{ marginVertical: 10, borderTopWidth: 1, borderColor: '#ccc', paddingTop: 15 }}>
                      <Text style={[styles.settingsTitle, { fontWeight: 'bold', marginBottom: 10 }]}>Valbara fält i inmatningsfönstret</Text>
                      <Text style={[styles.settingsTitle, { fontSize: 12, fontStyle: 'italic', fontWeight: '400', marginBottom: 10 }]}>Använd med försiktighet</Text>
                      {visibleFieldOptions.map((item) => {
                        const isSelected =
                          item.key === "quantityUnit"
                            ? visibleFields.quantity && visibleFields.unit
                            : visibleFields[item.key];
                        return (
                          <Pressable
                            key={item.key}
                            style={[styles.settingsRow, styles.settingsCompactRow, { paddingVertical: 0, alignItems: 'center', paddingLeft: 12 }]}
                            onPress={() => setVisibleFields((prev) => {
                              if (item.key === "quantityUnit") {
                                const next = !(prev.quantity && prev.unit);
                                return {
                                  ...prev,
                                  quantity: next,
                                  unit: next,
                                };
                              }
                              return {
                                ...prev,
                                [item.key]: !prev[item.key],
                              };
                            })}
                          >
                            <Text style={[styles.settingsTitle, { fontSize: 13 }]}>{item.label}</Text>
                            <Ionicons
                              name={isSelected ? checkboxName : squareOutlineName}
                              size={22}
                              color={isSelected ? '#0a9396' : '#767577'}
                            />
                          </Pressable>
                        );
                      })}
                    </View>

                    <View style={styles.bottomBar}>
                      <Pressable
                        style={styles.saveBtn}
                        onPress={async () => {
                          Keyboard.dismiss();
                          await onSaveSettings();
                        }}
                      >
                        <Text style={styles.saveBtnText}>Spara</Text>
                      </Pressable>

                      <Pressable
                        style={styles.guideBtn}
                        onPress={() => {
                          if (Platform.OS === "ios") {
                            Alert.alert(
                              "Kort guide",
                              "Importera karta som GeoTIFF från Skogsmonitor. Du kan ha flera kartor.\n\nByt namn på kartan, namnet används som förslag på lokalnamn.\n\nÖppna kartan och registrera punkter eller polygoner.\n\nExportera direkt till Artportalen eller skicka med epost.\n\nObs, du behöver välja samma koordinatsystem i appen och i Artportalen.\n\nDu hittar mer information på projektets hemsida https://Fältkarta.se/."
                            );
                            return;
                          }
                          setShowGuide(true);
                        }}
                      >
                        <Text style={styles.guideBtnText}>Kort guide</Text>
                      </Pressable>

                      <Pressable
                        style={styles.copyrightBtn}
                        onPress={() => Alert.alert(
                          "Licens",
                          "Appen är öppen källkod och licensierad under MIT-licensen. Du hittar mer information på projektets hemsida https://Fältkarta.se/."
                        )}
                      >
                        <Text style={styles.copyrightText}>©</Text>
                      </Pressable>
                    </View>
                  </ScrollView>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        transparent
        visible={showMapBuildLoading}
        onRequestClose={hideMapBuildLoading}
        animationType="fade"
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.loadingCard}>
            <Text style={styles.modalTitle}>Bygger karta ...</Text>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={showGuide} onRequestClose={() => setShowGuide(false)} animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Kort guide</Text>
            <View style={styles.helpBox}>
              <Text style={styles.helpText}>
                Importera karta som GeoTIFF från{" "}
                <Text style={styles.linkText} onPress={() => void Linking.openURL(SKOGSMONITOR_URL)}>
                  Skogsmonitor
                </Text>
                . Du kan ha flera kartor.
              </Text>
              <Text style={styles.helpText}>Byt namn på kartan, namnet används som förslag på lokalnamn.</Text>
              <Text style={styles.helpText}>Öppna kartan och registrera punkter eller polygoner.</Text>
              <Text style={styles.helpText}>Exportera direkt till Artportalen, skicka med epost eller dela.</Text>
              <Text style={styles.helpText}>Obs, du behöver välja samma koordinatsystem i appen och i Artportalen.</Text>
              <Text style={styles.helpText}>Du hittar mer information på projektets hemsida https://Fältkarta.se/.</Text>
            </View>
            <View style={styles.guideActions}>
              <Pressable style={styles.okBtn} onPress={() => setShowGuide(false)}>
                <Text style={styles.modalBtnText}>Ok</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={!!importPolygonMap} onRequestClose={() => setImportPolygonMap(null)} animationType="fade">
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setImportPolygonMap(null)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Importera polygon</Text>
            <View style={styles.helpBox}>
              <Text style={styles.helpText}>
                Välj en GeoJSON/JSON-fil med Polygon eller MultiPolygon.
              </Text>
              <Text style={styles.helpText}>
                Stödda koordinatsystem:
              </Text>
              <Text style={styles.helpText}>- WGS84 (EPSG:4326) / CRS84 (lon, lat)</Text>
              <Text style={styles.helpText}>- SWEREF 99 TM (EPSG:3006)</Text>
              <Text style={styles.helpText}>- Web Mercator (EPSG:3857)</Text>
              <Text style={styles.helpText}>
                Appen klipper automatiskt polygoner som ligger utanför kartans gränser.
              </Text>
            </View>
            <View style={styles.guideActions}>
              <Pressable
                style={styles.okBtn}
                onPress={async () => {
                  const selected = importPolygonMap;
                  setImportPolygonMap(null);
                  if (selected) {
                    await new Promise((resolve) => setTimeout(resolve, 800));
                    void importPolygonAreas(selected);
                  }
                }}
              >
                <Text style={styles.modalBtnText}>Ok</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={!!deleteMap} onRequestClose={() => setDeleteMap(null)} animationType="fade">
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setDeleteMap(null)} />
          <View style={styles.menuModalCard}>
            <Text style={styles.modalTitle}>Vill du ta bort kartan?</Text>
            <Text style={styles.helpText}>
              Detta kan inte ångras. Du kan spara din data genom att först exportera kartan,
              observationer och bilder.
            </Text>
            <View style={styles.modalActions}>
              <Pressable onPress={() => setDeleteMap(null)} style={[styles.modalBtn, styles.cancelBtn, styles.modalBtnShort]}>
                <Text style={styles.modalBtnText}>Avbryt</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  if (!deleteMap) return;
                  const selected = deleteMap;
                  setDeleteMap(null);
                  await cleanupAllPendingPhotoCopies();
                  await deleteIfExists(getSafeUri(selected.fileName, "map"));
                  if (selected.previewFileName) await deleteIfExists(getSafeUri(selected.previewFileName, "preview"));
                  const next = await removeMap(selected.id);
                  setMaps(sortMaps(next, mapSortMode, mapSortAnchor));
                }}
                style={[styles.modalBtn, styles.menuDangerBtn, styles.modalBtnLong]}
              >
                <Text style={styles.modalBtnText}>Radera permanent</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f4f0e7",
  },
  settingsTitle: {
    fontWeight: "700",
    marginBottom: 8,
    flex: 1,
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
    marginBottom: 6,
  },
  linkText: {
    color: "#005f73",
    textDecorationLine: "underline",
    fontWeight: "700",
  },
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  settingsCompactRow: {
    marginBottom: 4,
  },
  settingsInfoText: {
    color: "#292c30",
    fontWeight: "400",
    flex: 1,
  },
  pingInput: {
    backgroundColor: "#fff",
    borderColor: "#b9c1c8",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 2,
    minWidth: 54,
    textAlign: "center",
  },
  maxSideInput: {
    backgroundColor: "#fff",
    borderColor: "#b9c1c8",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    width: 72,
    textAlign: "center",
  },
  infoIconBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#8b949e",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 2,
  },
  infoIconText: {
    color: "#4a5560",
    fontWeight: "700",
    fontSize: 13,
    lineHeight: 14,
  },
  saveBtn: {
    backgroundColor: "#005f73",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10, 
  },
  saveBtnText: {
    color: "#fff",
    fontWeight: "700",
  },
  guideBtn: {
    backgroundColor: "#e9d8a6",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  guideBtnText: {
    color: "#3a2d0f",
    fontWeight: "700",
  },
  guideActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 12,
  },
  headerSortBtnText: {
    color: "#3a2d0f",
    fontWeight: "700",
    fontSize: 13,
    paddingHorizontal: 6,
    paddingVertical: 0,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 90,
    gap: 8,
  },
  emptyText: {
    textAlign: "center",
    marginTop: 48,
    color: "#59636b",
  },
  mapRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    // padding moved to clickable area to allow action buttons outside main pressable
  },
  mapClickableArea: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: "#dde5eb",
    borderWidth: 1,
    borderColor: "#d6dadd",
  },
  thumbPlaceholder: {
    justifyContent: "center",
    alignItems: "center",
  },
  thumbText: {
    fontWeight: "700",
    color: "#31404a",
  },
  mapMeta: {
    flex: 1,
    marginLeft: 10,
  },
  mapName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#172121",
  },
  mapDate: {
    color: "#5c6770",
    marginTop: 2,
  },
  mapActionsContainer: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    paddingRight: 5,
    gap: 1,
  },
  mapStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 1,
    flexWrap: "wrap",
  },
  mapStatusIcon: {
    marginTop: 1,
  },
  descriptionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 0,
  },
  exportBtn: {
    paddingHorizontal: 6,
    paddingTop: 8,
    marginBottom: 1,
  },
  menuBtn: {
    paddingHorizontal: 8,
    paddingVertical: 0,
    marginTop: -2,
    marginBottom: 5,
  },
  keyboardView: {
  flex: 1,
  width: "100%",
  alignItems: "center",
  justifyContent: "center",
  paddingHorizontal: 12,
},
descriptionModalCard: {
  width: "95%",
  height: "85%", 
  maxHeight: 400, 
  padding: 15,
  alignSelf: "center",
  backgroundColor: "#fff", 
  borderRadius: 12,
  justifyContent: "space-between",
},
changeDateModalCard: {
  width: "90%",
  maxHeight: 240,
  padding: 15,
  alignSelf: "center",
  backgroundColor: "#fff",
  borderRadius: 12,
  justifyContent: "space-between",
},
modalScrollView: {
  flex: 1, 
  width: "100%",
},
modalScrollViewContent: {
  flexGrow: 1,
},
descriptionInput: {
  flex: 1, 
  width: "100%",
  padding: 12,
  minHeight: 140, 
  marginBottom: 4,
  borderWidth: 1,
  borderColor: "#b9c1c8",
  borderRadius: 8,
  backgroundColor: "#fff",
  textAlignVertical: "top",
},
descriptionInputIOS: {
  height: "100%", 
},
  menuText: {
    fontSize: 22,
    fontWeight: "700",
    color: "#172121",
  },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 34,
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "#ca6702",
    justifyContent: "center",
    alignItems: "center",
    elevation: 4,
    zIndex: 1000,
  },
  fabText: {
    color: "#fff",
    fontSize: 30,
    fontWeight: "800",
    marginTop: -1,
  },
  infoFab: {
    position: "absolute",
    left: 20,
    bottom: 44,
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: "#005f73",
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
  infoFabText: {
    color: "#005f73",
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 22,
  },
  exitFab: {
    position: "absolute",
    bottom: 44,
    alignSelf: "center",
    paddingHorizontal: 18,
    height: 42,
    borderRadius: 21,
    justifyContent: "center",
    alignItems: "center",
    elevation: 5,   
    zIndex: 1000,  
  },
  exitFabText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 12,
    letterSpacing: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    padding: 16,
  },
  settingsModalWrap: {
    flex: 1,
  },
  settingsModalBackdrop: {
    justifyContent: "flex-start",
    paddingTop: 110,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
  },
  loadingCard: {
    backgroundColor: "#e7e0d9",
    borderRadius: 20,
    paddingVertical: 32,
    paddingHorizontal: 40,
    alignSelf: "center",
    minWidth: 200,
  
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    
    elevation: 20,
  },
  settingsModalCard: {
    maxHeight: "94%",
  },
  modalTitle: {
    fontWeight: "700",
    marginBottom: 8,
    fontSize: 16,
  },
  sectionTitle: {
    fontWeight: "700",
    marginTop: 10,
    marginBottom: 0,
    fontSize: 15,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: "#b9c1c8",
    borderRadius: 8,
    padding: 10,
  },
  renameHint: {
    color: "#44515b",
    marginBottom: 8,
    lineHeight: 18,
  },
  disclosureText: {
    color: "#22323b",
    lineHeight: 20,
    marginBottom: 8,
  },
  modalActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  modalActionsThree: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    justifyContent: "space-between",
    alignItems: "center",
  },
  modalBtn: {
    paddingVertical: 11,
    borderRadius: 8,
    flex: 1,
  },
  modalBtnShort: {
    minWidth: 0,
  },
  clearBtn: {
    backgroundColor: "#7c6b8f",
  },
  modalBtnWide: {
    paddingHorizontal: 18,
  },
  modalBtnLong: {
    flex: 1,
  },
  cancelBtn: {
    backgroundColor: "#7b8791",
  },
  okBtn: {
    backgroundColor: "#0a9396",
  },
  modalBtnText: {
    color: "#fff",
    textAlign: "center",
    fontWeight: "700",
  },
  menuModalCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    width: "86%",
    alignSelf: "center",
  },
  menuActionBtn: {
    backgroundColor: "#005f73",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginTop: 8,
    width: "90%",
    alignSelf: "center",
  },
  menuDangerBtn: {
    backgroundColor: "#9b2226",
  },
  menuActionText: {
    color: "#fff",
    fontWeight: "700",
    textAlign: "center",
  },
  closeOnlyBtn: {
    marginTop: 10,
  },
  bottomBar: {
  flexDirection: 'row',          
  justifyContent: 'space-between', 
  alignItems: 'center',          
  paddingHorizontal: 20,        
  marginTop: 1,
},
copyrightBtn: {
  padding: 10,                   
},
copyrightText: {
  fontSize: 18,
  color: '#888',
},
menuDivider: {
  height: 1,
  backgroundColor: "#e0e0e0", // Tunn linje
  marginVertical: 10,
  width: "100%",
},
statusSectionTitle: {
  fontSize: 14,
  color: "#666",
  fontWeight: "600",
  textAlign: "center",
  marginBottom: 1,
},
iconStatusRow: {
  flexDirection: "row",
  justifyContent: "center",
  alignItems: "center",
  gap: 60, // Avstånd mellan molnet och checken
  width: "100%",
  paddingVertical: 0,
},
statusIconBtn: {
  padding: 5, // Gör träffytan större
  alignItems: "center",
  justifyContent: "center",
},

emojiIcon: {
  fontSize: 32,
  textAlign: "center",
},
iconContainerBox: {
  width: 40,               
  height: 40,             
  borderRadius: 8,        
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  borderWidth: 0, 
  margin: 0,
  padding: 0,
},
emojiIconBox: {
  fontSize: 20,            // Storleken på emojin inuti rutan
  textAlign: "center",
  includeFontPadding: false,
  
},
listEmojiIcon: {
  fontSize: 10,            
  marginRight: 6,          
  textAlign: "center",
  includeFontPadding: false, 
},
listIconBox: {
  width: 16,                 
  height: 16,                
  borderRadius: 4,           
  justifyContent: "center",
  alignItems: "center",
  marginRight: 2,            // Avstånd till nästa ikon eller till datumet
},
listEmojiInsideBox: {
  fontSize: 9,              
  textAlign: "center",
  includeFontPadding: false, 
},
listNoteIcon: {
  fontSize: 11,              
  marginRight: -1,            
  textAlign: "center",
  includeFontPadding: false,
  
},
androidGearEmoji: {
  fontSize: 18,         
  textAlign: "center",
  color: "#010708",           
  includeFontPadding: false,  
  transform: [{ translateY: -1 }], 
},
iosGearEmoji: {
  fontSize: 22,               
  textAlign: "center",
  color: "#010708",           
  includeFontPadding: false,  
},
// En variant av din gamla rad, men anpassad för att ha kontrollen under texten
settingsRowColumn: {
  flexDirection: 'column',
  marginBottom: 20,
  width: '100%',
},

// Själva huvudbalken (Bakgrunden)
segmentedControlBg: {
  flexDirection: 'row',
  backgroundColor: '#81c2c2', // #0a9396" '#dcdcdf'
  borderRadius: 25,
  padding: 3,               
  width: '90%',
  alignSelf: 'center',
},

// En enskild flik/knapp (Både aktiv och inaktiv delar denna)
segmentedControlTab: {
  flex: 1,                    // Gör att båda halvorna blir exakt lika breda
  paddingVertical: 3,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 20,            // Lite mindre än yttre bakgrunden 
},

// STIL NÄR EN FLIK ÄR VALD:
segmentedControlTabActive: {
  backgroundColor: '#ffffff', 
  // En mjuk skugga runt den aktiva fliken:
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.12,
  shadowRadius: 1.5,
  elevation: 2,               // Skugga för Android
},

// Texten för en inaktiv flik
segmentedControlText: {
  fontSize: 12,
  fontWeight: '500',
  color: '#222121',     
},

// Texten för en AKTIV flik
segmentedControlTextActive: {
  color: '#000000',     
  fontWeight: '600',
},
});





















