import React, { useCallback, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  Platform,
  ScrollView, 
  StyleSheet,
  Text,
  TextInput,
  View,
  Linking,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { RootStackParamList } from "../navigation/types";
import { MapItem } from "../types/models";
import { AppSettings } from "../types/models";
import {
  loadMaps,
  loadObservationsByMapId,
  loadSettings,
  removeMap,
  renameMapAndSyncPointLocalNames,
  saveObservationsByMapId,
  saveSettings,
  upsertMap,
} from "../storage/storage";
import { useGpsContext } from "../contexts/GpsContext";
import { deleteIfExists, ensureMapGeorefBounds, pickAndImportGeoTiff } from "../services/files";
import { meters3857ToWgs84, sweref99tmToWgs84 } from "../services/coords";
import { cleanupAllPendingPhotoCopies } from "../services/photos";
import { Ionicons } from '@expo/vector-icons';
import * as Location from "expo-location";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { makeId } from "../utils/id";
import { PolygonObservation } from "../types/models";

type Props = NativeStackScreenProps<RootStackParamList, "MapList">;

export function MapListScreen({ navigation }: Props) {
  const [maps, setMaps] = useState<MapItem[]>([]);
  const [gpsPingSeconds, setGpsPingSeconds] = useState("3");
  const { gpsOptions, setGpsOptions } = useGpsContext();
  const [showQuantityField, setShowQuantityField] = useState(false);
  const [maxImageSizeMB, setMaxImageSizeMB] = useState("3");
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
  const [importPolygonMap, setImportPolygonMap] = useState<MapItem | null>(null);

  const SKOGSMONITOR_URL = "https://karta.skogsmonitor.se/?background=Lantm%C3%A4terietTopowebb&lat=60.55728&layers=17-26-21-14&lng=16.88599&zoom=7";

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

  const refresh = useCallback(async () => {
    const [allMaps, settings] = await Promise.all([loadMaps(), loadSettings()]);
    setMaps(allMaps);
    setGpsPingSeconds(String(settings.gpsPingSeconds));
    setGpsOptions({ pingSeconds: settings.gpsPingSeconds, backgroundGPS: settings.backgroundGPS ?? false });
    setShowQuantityField(settings.showQuantityField ?? false);
    setMaxImageSizeMB(String(settings.maxImageSizeMB ?? 2));
    setCoordinateSystem(settings.coordinateSystem ?? "SWEREF99");
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  async function onImport() {
    try {
      const item = await pickAndImportGeoTiff();
      if (!item) return;
      const next = await upsertMap(item);
      setMaps(next);
      setRenameMap(item);
      setRenameValue(item.name.toLowerCase().includes("skogsmonitor") ? "" : item.name);
      setRenameMode("import");
      setShowRenameHint(true);
    } catch (error) {
      Alert.alert("Importfel", String(error));
    }
  }



  function onOpenMenu(item: MapItem) {
    setMenuMap(item);
  }

  function openRename(item: MapItem) {
    setRenameMap(item);
    setRenameValue(item.name);
    setRenameMode("edit");
    setShowRenameHint(false);
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
      name: trimmed,
    };
    const next = await renameMapAndSyncPointLocalNames(updated, renameMap.name);
    setMaps(next);
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
      await deleteIfExists(current.fileUri);
      if (current.thumbnailUri) {
        await deleteIfExists(current.thumbnailUri);
      }
      const next = await removeMap(current.id);
      setMaps(next);
    }
  }
  const onSaveSettings = async () => {
    try {
      const parsedPing = Number.parseInt(gpsPingSeconds, 10);
      const rawPing = Number.isFinite(parsedPing) ? parsedPing : 3;
      const pingValue = Math.min(20, Math.max(2, rawPing));
      const parsedMaxSize = Number.parseFloat(maxImageSizeMB.replace(",", "."));
      const maxSizeValue = Number.isFinite(parsedMaxSize) && parsedMaxSize > 0 ? parsedMaxSize : 2;

      // Skapa det fullständiga objektet som ska sparas
      const newSettings: AppSettings = {
        gpsPingSeconds: pingValue,
        showQuantityField: showQuantityField,
        maxImageSizeMB: maxSizeValue,
        backgroundGPS: gpsOptions.backgroundGPS,
        coordinateSystem: coordinateSystem,
      };

      // Spara allt på en gång
      await saveSettings(newSettings);
      setGpsOptions({ pingSeconds: pingValue, backgroundGPS: gpsOptions.backgroundGPS });
      
      // Uppdatera UI
      setGpsPingSeconds(String(pingValue));
      setMaxImageSizeMB(String(maxSizeValue));
      //Alert.alert("Sparat", "Inställningar uppdaterade.");
      setShowSettings(false);
    } catch (error) {
      console.error("Kunde inte spara inställningar:", error);
      Alert.alert("Fel", "Kunde inte spara inställningarna.");
    }
  };


const toggleBackgroundGPS = async () => {
  const nextState = !gpsOptions.backgroundGPS;

  // Gör om pingen till ett nummer och klampa till 3–20
  const pingValue = Number.parseInt(clampPingInput(gpsPingSeconds), 10) || 3;

  // HÄR ÄR FIXEN: Skicka objektet direkt istället för att använda prev
  setGpsOptions({
    pingSeconds: pingValue,
    backgroundGPS: nextState
  });

  // Spara även till AsyncStorage
  try {
    await saveSettings({
      gpsPingSeconds: pingValue,
      backgroundGPS: nextState,
      showQuantityField: showQuantityField,
      maxImageSizeMB: Number.parseFloat(maxImageSizeMB.replace(",", ".")) || 3,
      coordinateSystem: coordinateSystem,
    });
  } catch (error) {
    console.error("Kunde inte spara inställningar:", error);
  }
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
          <Pressable style={styles.mapRow} onPress={() => onOpenMap(item)}>
            {item.thumbnailUri ? (
              <Image source={{ uri: item.thumbnailUri }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]}>
                <Text style={styles.thumbText}>TIFF</Text>
              </View>
            )}
            <View style={styles.mapMeta}>
              <Text style={styles.mapName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.mapDate}>{new Date(item.createdAt).toLocaleDateString()}</Text>
            </View>
            <Pressable style={styles.menuBtn} onPress={() => onOpenMenu(item)}>
              <Text style={styles.menuText}>...</Text>
            </Pressable>
          </Pressable>
        )}
      />

      <Pressable style={styles.fab} onPress={() => setShowImportMenu(true)}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      <Pressable style={styles.infoFab} onPress={() => setShowSettings(true)}>
        <Text style={styles.infoFabText}>i</Text>
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

      <Modal transparent visible={showImportMenu} onRequestClose={() => setShowImportMenu(false)} animationType="fade">
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
              onPress={() => {
                setShowImportMenu(false);
                void onImport();
              }}
            >
              <Text style={styles.menuActionText}>Ladda från enhet</Text>
            </Pressable>
            <Text style={styles.helpText}>Välj en GeoTIFF-fil som redan finns på din telefon.</Text>

            <Pressable
              style={{ display: "none" }}
              onPress={() => setShowImportMenu(false)}
            >
              <Text style={styles.menuActionText}>Stäng</Text>
            </Pressable>
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

      <Modal transparent visible={!!menuMap} onRequestClose={() => setMenuMap(null)} animationType="fade">
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuMap(null)} />
          <View style={styles.menuModalCard}>
            <Text style={styles.modalTitle}>{menuMap?.name ?? "Karta"}</Text>
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
                const selected = menuMap;
                setMenuMap(null);
                navigation.navigate("Export", { mapId: selected.id });
              }}
            >
              <Text style={styles.menuActionText}>Export</Text>
            </Pressable>
            <Pressable
              style={styles.menuActionBtn}
              onPress={() => {
                if (!menuMap) return;
                const selected = menuMap;
                setMenuMap(null);
                setImportPolygonMap(selected);
              }}
            >
              <Text style={styles.menuActionText}>Importera område (Polygon)</Text>
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

      <Modal transparent visible={showSettings} onRequestClose={() => setShowSettings(false)} animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Inställningar</Text>

            {/* GPS-inställning */}
            <View style={styles.settingsRow}>
              <Text style={styles.settingsTitle}>GPS pingfrekvens (2-20s)</Text>
              <TextInput
                value={gpsPingSeconds}
                onChangeText={setGpsPingSeconds}
                onBlur={() => setGpsPingSeconds(clampPingInput(gpsPingSeconds))}
                style={styles.pingInput}
                keyboardType="number-pad"
              />
            </View>

            <Pressable
              style={[styles.settingsRow, { marginVertical: 6, alignItems: "center" }]}
              onPress={() =>
                setGpsOptions({
                  pingSeconds: gpsOptions.pingSeconds,
                  backgroundGPS: !gpsOptions.backgroundGPS,
                })
              }
            >
              <Text style={styles.settingsTitle}>Begär GPS i bakgrund</Text>
              <Ionicons
                name={gpsOptions.backgroundGPS ? "checkbox" : "square-outline"}
                size={24}
                color={gpsOptions.backgroundGPS ? "#0a9396" : "#767577"}
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

            {/* Ny rad: Visa antal och enhet */}
            <Pressable 
              style={[styles.settingsRow, { marginVertical: 15, alignItems: 'center' }]}
              onPress={() => setShowQuantityField(!showQuantityField)}
            >
              <Text style={styles.settingsTitle}>Visa antal och enhet vid inmatning</Text>
              <Ionicons 
                name={showQuantityField ? "checkbox" : "square-outline"} 
                size={24} 
                color={showQuantityField ? "#0a9396" : "#767577"} 
              />
            </Pressable>

            <View style={styles.settingsRow}>
              <Text style={styles.settingsInfoText}>
                SWEREF99 TM används vid export till Excel och Artportalen
              </Text>
            </View>

            <View style={styles.bottomBar}>
              {/* Spara-knapp till vänster */}
              <Pressable 
                style={styles.saveBtn}
                onPress={async () => {
                  await onSaveSettings();
                  setShowSettings(false);
                }}
              >
                <Text style={styles.saveBtnText}>Spara</Text>
              </Pressable>

              <Pressable
                style={styles.guideBtn}
                onPress={() => setShowGuide(true)}
              >
                <Text style={styles.guideBtnText}>Kort guide</Text>
              </Pressable>

              {/* Licens-knapp till höger */}
              <Pressable 
                style={styles.copyrightBtn} 
                onPress={() => Alert.alert(
                  "Licens", 
                  "Appen är öppen källkod och licensierad under MIT-licensen. Du hittar mer information på projektets hemsida."
                )}
              >
                <Text style={styles.copyrightText}>©</Text>
              </Pressable>
            </View>

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
              <Text style={styles.helpText}>Exportera direkt till Artportalen eller skicka med epost.</Text>
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
                onPress={() => {
                  const selected = importPolygonMap;
                  setImportPolygonMap(null);
                  if (selected) {
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
                  await deleteIfExists(selected.fileUri);
                  if (selected.thumbnailUri) await deleteIfExists(selected.thumbnailUri);
                  const next = await removeMap(selected.id);
                  setMaps(next);
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
    marginBottom: 4,
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
    paddingHorizontal: 8,
    paddingVertical: 6,
    minWidth: 54,
    textAlign: "center",
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
    padding: 10,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: "#dde5eb",
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
  menuBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
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
    // backgroundColor sätts direkt i Pressable ovan
    justifyContent: "center",
    alignItems: "center",
    elevation: 5,   // Gör att den syns på Android
    zIndex: 1000,   // Gör att den syns över kartan
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
  sectionTitle: {
    fontWeight: "700",
    marginTop: 6,
    marginBottom: 6,
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
  modalActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  modalBtn: {
    paddingVertical: 11,
    borderRadius: 8,
  },
  modalBtnShort: {
    minWidth: 110,
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
  flexDirection: 'row',          // Lägger elementen på rad
  justifyContent: 'space-between', // Trycker isär elementen (vänster/höger)
  alignItems: 'center',          // Centrerar vertikalt
  paddingHorizontal: 20,         // Avstånd från skärmkanterna
  marginTop: 20,
},
copyrightBtn: {
  padding: 10,                   // Gör den lättare att träffa
},
copyrightText: {
  fontSize: 18,
  color: '#888',
},
});
