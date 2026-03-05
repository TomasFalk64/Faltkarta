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
      Alert.alert("Delning", "Share sheet stöds inte på denna enhet.");
      return;
    }
    await Sharing.shareAsync(item.fileUri, {
      dialogTitle: "Exportera GeoTIFF",
      mimeType: "image/tiff",
      UTI: "public.tiff",
    });
  }

  function onOpenMenu(item: MapItem) {
    Alert.alert(item.name, "Välj åtgärd", [
      { text: "Byt namn", onPress: () => openRename(item) },
      { text: "Exportera", onPress: () => onShareMap(item) },
      {
        text: "Ta bort",
        style: "destructive",
        onPress: async () => {
          await deleteIfExists(item.fileUri);
          if (item.thumbnailUri) await deleteIfExists(item.thumbnailUri);
          const next = await removeMap(item.id);
          setMaps(next);
        },
      },
      { text: "Avbryt", style: "cancel" },
    ]);
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
      <View style={styles.settingsCard}>
        <Text style={styles.settingsTitle}>GPS ping-frekvens (sekunder)</Text>
        <View style={styles.settingsRow}>
          <TextInput
            value={gpsPingSeconds}
            onChangeText={setGpsPingSeconds}
            style={styles.pingInput}
            keyboardType="number-pad"
          />
          <Pressable style={styles.saveBtn} onPress={onSavePing}>
            <Text style={styles.saveBtnText}>Spara</Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        data={maps}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.emptyText}>Inga kartor ännu. Tryck + för import.</Text>}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f4f0e7",
  },
  settingsCard: {
    margin: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#fff",
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
});
