import React, { useCallback, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView, 
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { RootStackParamList } from "../navigation/types";
import { MapItem } from "../types/models";
import { AppSettings } from "../types/models";
import { loadMaps, loadSettings, removeMap, saveSettings, upsertMap } from "../storage/storage";
import { deleteIfExists, pickAndImportGeoTiff } from "../services/files";
import { cleanupAllPendingPhotoCopies } from "../services/photos";
import { Ionicons } from '@expo/vector-icons';

type Props = NativeStackScreenProps<RootStackParamList, "MapList">;

export function MapListScreen({ navigation }: Props) {
  const [maps, setMaps] = useState<MapItem[]>([]);
  const [gpsPingSeconds, setGpsPingSeconds] = useState("3");
  const [showQuantityField, setShowQuantityField] = useState(true);
  const [renameMap, setRenameMap] = useState<MapItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showRenameHint, setShowRenameHint] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [menuMap, setMenuMap] = useState<MapItem | null>(null);

  const refresh = useCallback(async () => {
    const [allMaps, settings] = await Promise.all([loadMaps(), loadSettings()]);
    setMaps(allMaps);
    setGpsPingSeconds(String(settings.gpsPingSeconds));
    setShowQuantityField(settings.showQuantityField ?? true);
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
      setRenameValue(item.name);
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
    setShowRenameHint(false);
  }

  async function confirmRename() {
    if (!renameMap) return;
    const updated: MapItem = {
      ...renameMap,
      name: renameValue.trim() || renameMap.name,
    };
    const next = await upsertMap(updated);
    setMaps(next);
    setRenameMap(null);
    setRenameValue("");
    setShowRenameHint(false);
  }
  const onSaveSettings = async () => {
    try {
      const parsedPing = Number.parseInt(gpsPingSeconds, 10);
      const pingValue = Number.isFinite(parsedPing) && parsedPing > 0 ? parsedPing : 3;

      // Skapa det fullständiga objektet som ska sparas
      const newSettings: AppSettings = {
        gpsPingSeconds: pingValue,
        showQuantityField: showQuantityField,
      };

      // Spara allt på en gång
      await saveSettings(newSettings);
      
      // Uppdatera UI
      setGpsPingSeconds(String(pingValue));
      Alert.alert("Sparat", "Inställningar uppdaterade.");
      setShowSettings(false);
    } catch (error) {
      console.error("Kunde inte spara inställningar:", error);
      Alert.alert("Fel", "Kunde inte spara inställningarna.");
    }
  };

  function onOpenMap(item: MapItem) {
    navigation.navigate("Map", { mapId: item.id });
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

      <Pressable style={styles.fab} onPress={onImport}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      <Pressable style={styles.infoFab} onPress={() => setShowSettings(true)}>
        <Text style={styles.infoFabText}>i</Text>
      </Pressable>

      <Modal transparent visible={!!renameMap} onRequestClose={() => setRenameMap(null)} animationType="fade">
        <View style={[styles.modalBackdrop, { justifyContent: 'flex-start' }]}>
          <View style={[styles.modalCard, { marginTop: 60, maxHeight: '80%' }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>Byt kartnamn</Text>
              {showRenameHint && (
                <Text style={styles.renameHint}>
                  Kartans namn används som förslag till lokalnamn vid punktobservationer.
                </Text>
              )}
              <TextInput value={renameValue} onChangeText={setRenameValue} style={styles.modalInput} />
              <View style={styles.modalActions}>
                <Pressable
                  onPress={() => {
                    setRenameMap(null);
                    setShowRenameHint(false);
                  }}
                  style={[styles.modalBtn, styles.cancelBtn]}
                >
                  <Text style={styles.modalBtnText}>Avbryt</Text>
                </Pressable>
                <Pressable onPress={confirmRename} style={[styles.modalBtn, styles.okBtn]}>
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
              style={[styles.menuActionBtn, styles.menuDangerBtn]}
              onPress={() => {
                if (!menuMap) return;

                Alert.alert(
                  "Vill du ta bort kartan?",
                  "Detta kan inte ångras. Du kan spara din data genom att först exportera kartan, observationer och bilder.",
                  [
                    { text: "Avbryt", style: "cancel" },
                    {
                      text: "Radera permanent",
                      style: "destructive",
                      onPress: async () => {
                        const selected = menuMap;
                        setMenuMap(null);
                        await cleanupAllPendingPhotoCopies();
                        await deleteIfExists(selected.fileUri);
                        if (selected.thumbnailUri) await deleteIfExists(selected.thumbnailUri);
                        const next = await removeMap(selected.id);
                        setMaps(next);
                      },
                    },
                  ]
                );
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
            <Text style={styles.modalTitle}>Kort guide</Text>
            <View style={styles.helpBox}>
              <Text style={styles.helpText}>Importera en GeoTIFF som karta. Du kan ha flera kartor.</Text>
              <Text style={styles.helpText}>Byt namn på kartan, namnet används som förslag på lokalnamn.</Text>
              <Text style={styles.helpText}>Öppna kartan och registrera punkter eller polygoner.</Text>
              <Text style={styles.helpText}>Exportera direkt till Artportalen eller skicka med epost.</Text>
            </View>

            <Text style={styles.modalTitle}>Inställningar</Text>

            {/* GPS-inställning */}
            <Text style={styles.settingsTitle}>GPS ping-frekvens (sekunder)</Text>
            <View style={styles.settingsRow}>
              <TextInput
                value={gpsPingSeconds}
                onChangeText={setGpsPingSeconds}
                style={styles.pingInput}
                keyboardType="number-pad"
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

            {/* Gemensam Spara-knapp */}
            <Pressable
              style={styles.saveBtn}
              onPress={async () => {
                await onSaveSettings(); // Spara både ping och visnings-inställning här
                setShowSettings(false);
              }}
            >
              <Text style={styles.saveBtnText}>Spara</Text>
            </Pressable>

            <Pressable
              onPress={() => setShowSettings(false)}
              style={[styles.modalBtn, styles.cancelBtn, styles.closeOnlyBtn]}
            >
              <Text style={styles.modalBtnText}>Stäng</Text>
            </Pressable>
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
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pingInput: {
    backgroundColor: "#fff",
    borderColor: "#b9c1c8",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 80,
  },
  saveBtn: {
    backgroundColor: "#005f73",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10, 
    alignSelf: 'flex-start',
    marginTop: 10, 
  },
  saveBtnText: {
    color: "#fff",
    fontWeight: "700",
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
    bottom: 34,
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
    flex: 1,
    paddingVertical: 11,
    borderRadius: 8,
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
});
