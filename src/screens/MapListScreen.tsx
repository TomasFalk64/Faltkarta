import React, { useCallback, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import * as Sharing from "expo-sharing";
import { RootStackParamList } from "../navigation/types";
import { MapItem } from "../types/models";
import { loadMaps, loadSettings, removeMap, saveSettings, upsertMap } from "../storage/storage";
import { deleteIfExists, pickAndImportGeoTiff } from "../services/files";

type Props = NativeStackScreenProps<RootStackParamList, "MapList">;

export function MapListScreen({ navigation }: Props) {
  const [maps, setMaps] = useState<MapItem[]>([]);
  const [gpsPingSeconds, setGpsPingSeconds] = useState("3");
  const [renameMap, setRenameMap] = useState<MapItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [menuMap, setMenuMap] = useState<MapItem | null>(null);

  const refresh = useCallback(async () => {
    const [allMaps, settings] = await Promise.all([loadMaps(), loadSettings()]);
    setMaps(allMaps);
    setGpsPingSeconds(String(settings.gpsPingSeconds));
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
    } catch (error) {
      Alert.alert("Importfel", String(error));
    }
  }

  async function onShareMap(item: MapItem) {
    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert("Delning", "Share sheet stods inte pa denna enhet.");
      return;
    }
    await Sharing.shareAsync(item.fileUri, {
      dialogTitle: "Exportera GeoTIFF",
      mimeType: "image/tiff",
      UTI: "public.tiff",
    });
  }

  function onOpenMenu(item: MapItem) {
    setMenuMap(item);
  }

  function openRename(item: MapItem) {
    setRenameMap(item);
    setRenameValue(item.name);
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
  }

  async function onSavePing() {
    const parsed = Number.parseInt(gpsPingSeconds, 10);
    const value = Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
    await saveSettings({ gpsPingSeconds: value });
    setGpsPingSeconds(String(value));
    Alert.alert("Sparat", "GPS ping-frekvens uppdaterad.");
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={maps}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.emptyText}>Inga kartor an nu. Tryck + for import.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.mapRow} onPress={() => navigation.navigate("Map", { mapId: item.id })}>
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
              <Text style={styles.mapDate}>{new Date(item.createdAt).toLocaleString()}</Text>
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
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Byt kartnamn</Text>
            <TextInput value={renameValue} onChangeText={setRenameValue} style={styles.modalInput} />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setRenameMap(null)} style={[styles.modalBtn, styles.cancelBtn]}>
                <Text style={styles.modalBtnText}>Avbryt</Text>
              </Pressable>
              <Pressable onPress={confirmRename} style={[styles.modalBtn, styles.okBtn]}>
                <Text style={styles.modalBtnText}>Spara</Text>
              </Pressable>
            </View>
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
              onPress={async () => {
                if (!menuMap) return;
                const selected = menuMap;
                setMenuMap(null);
                await onShareMap(selected);
              }}
            >
              <Text style={styles.menuActionText}>Exportera</Text>
            </Pressable>
            <Pressable
              style={[styles.menuActionBtn, styles.menuDangerBtn]}
              onPress={async () => {
                if (!menuMap) return;
                const selected = menuMap;
                setMenuMap(null);
                await deleteIfExists(selected.fileUri);
                if (selected.thumbnailUri) await deleteIfExists(selected.thumbnailUri);
                const next = await removeMap(selected.id);
                setMaps(next);
              }}
            >
              <Text style={styles.menuActionText}>Ta bort</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={showSettings} onRequestClose={() => setShowSettings(false)} animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Installningar</Text>
            <Text style={styles.settingsTitle}>GPS ping-frekvens (sekunder)</Text>
            <View style={styles.settingsRow}>
              <TextInput
                value={gpsPingSeconds}
                onChangeText={setGpsPingSeconds}
                style={styles.pingInput}
                keyboardType="number-pad"
              />
              <Pressable
                style={styles.saveBtn}
                onPress={async () => {
                  await onSavePing();
                  setShowSettings(false);
                }}
              >
                <Text style={styles.saveBtnText}>Spara</Text>
              </Pressable>
            </View>
            <Pressable
              onPress={() => setShowSettings(false)}
              style={[styles.modalBtn, styles.cancelBtn, styles.closeOnlyBtn]}
            >
              <Text style={styles.modalBtnText}>Stang</Text>
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
    bottom: 20,
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
    bottom: 20,
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
