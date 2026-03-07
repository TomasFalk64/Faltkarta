import React, { useEffect, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/types";
import { loadMaps, loadObservationsForMap } from "../storage/storage";
import { Observation } from "../types/models";
import {
  buildArtportalenTsv,
  buildCsv,
  copyTsvAndOpenArtportalen,
  saveCsvGeoJsonAndMapAndComposeEmail,
  saveCsvAndShare,
  saveZipBundleAndShare,
} from "../services/export";

type Props = NativeStackScreenProps<RootStackParamList, "Export">;

export function ExportScreen({ route }: Props) {
  const { mapId, mode } = route.params;
  const [mapName, setMapName] = useState("export");
  const [mapFileUri, setMapFileUri] = useState<string | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [preview, setPreview] = useState("");
  const [showExcelModal, setShowExcelModal] = useState(false);

  useEffect(() => {
    (async () => {
      const [maps, obs] = await Promise.all([loadMaps(), loadObservationsForMap(mapId)]);
      const m = maps.find((item) => item.id === mapId);
      if (m) {
        setMapName(m.name);
        setMapFileUri(m.fileUri);
      }
      setObservations(obs);
      setPreview(buildArtportalenTsv(obs).slice(0, 600));
    })().catch((e) => Alert.alert("Fel", String(e)));
  }, [mapId]);

  useEffect(() => {
    if (!mode || !observations.length) return;
    if (mode === "artportalen") {
      void onCopyArtportalen();
      return;
    }
    if (mode === "mail") {
      void onEmailCsv();
      return;
    }
    if (mode === "zip") {
      void onExportZip();
    }
  }, [mode, observations.length]);

  async function onCopyArtportalen() {
    if (!observations.length) {
      Alert.alert("Export", "Inga observationer att exportera.");
      return;
    }
    const tsv = buildArtportalenTsv(observations);
    await copyTsvAndOpenArtportalen(tsv);
    Alert.alert("Klart", "TSV kopierad till urklipp. Artportalen oppnad.");
  }

  async function onSaveCsv() {
    if (!observations.length) {
      Alert.alert("Export", "Inga observationer att exportera.");
      return;
    }
    const csv = buildCsv(observations);
    const path = await saveCsvAndShare(mapName, csv);
    Alert.alert("Sparad", path);
  }

  async function onEmailCsv() {
    if (!observations.length) {
      Alert.alert("Export", "Inga observationer att exportera.");
      return;
    }
    const csv = buildCsv(observations);
    const result = await saveCsvGeoJsonAndMapAndComposeEmail(mapName, observations, csv, mapFileUri);
    if (!result.opened) {
      Alert.alert("E-post", `E-post ar inte tillgangligt pa enheten.\nFiler sparades:\n${result.paths.join("\n")}`);
      return;
    }
  }

  function onExportCsv() {
    setShowExcelModal(true);
  }

  async function onExportZip() {
    if (!observations.length) {
      Alert.alert("Export", "Inga observationer att exportera.");
      return;
    }
    const path = await saveZipBundleAndShare(mapName, observations);
    Alert.alert("Sparad", `ZIP skapad:\n${path}`);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Exportera observationer</Text>
      <Text style={styles.subtitle}>
        {observations.length} observationer pa kartan {mapName}
      </Text>

      <Pressable style={styles.primaryBtn} onPress={onCopyArtportalen}>
        <Text style={styles.primaryText}>Kopiera till Artportalen</Text>
      </Pressable>
      <Pressable style={[styles.primaryBtn, styles.altBtn]} onPress={onExportCsv}>
        <Text style={styles.primaryText}>Exportera Excelfil</Text>
      </Pressable>
      <Pressable style={[styles.primaryBtn, styles.zipBtn]} onPress={onExportZip}>
        <Text style={styles.primaryText}>Exportera ZIP med bilder och GeoJSON</Text>
      </Pressable>

      <Text style={styles.previewTitle}>Forhandsvisning TSV</Text>
      <ScrollView style={styles.previewBox}>
        <Text style={styles.previewText}>{preview || "Tomt"}</Text>
      </ScrollView>

      <Modal transparent visible={showExcelModal} animationType="fade" onRequestClose={() => setShowExcelModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Exportera Excelfil</Text>
            <Pressable
              style={[styles.modalActionBtn, styles.modalShareBtn]}
              onPress={() => {
                setShowExcelModal(false);
                void onSaveCsv();
              }}
            >
              <Text style={styles.modalActionText}>Dela fil</Text>
            </Pressable>
            <Pressable
              style={[styles.modalActionBtn, styles.modalMailBtn]}
              onPress={() => {
                setShowExcelModal(false);
                void onEmailCsv();
              }}
            >
              <Text style={styles.modalActionText}>E-post</Text>
            </Pressable>
            <Pressable style={[styles.modalActionBtn, styles.modalCancelBtn]} onPress={() => setShowExcelModal(false)}>
              <Text style={styles.modalActionText}>Avbryt</Text>
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
    padding: 14,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: "#172121",
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 16,
    color: "#44515b",
  },
  primaryBtn: {
    backgroundColor: "#005f73",
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  altBtn: {
    backgroundColor: "#ca6702",
  },
  zipBtn: {
    backgroundColor: "#6a4c93",
  },
  primaryText: {
    color: "#fff",
    fontWeight: "800",
    textAlign: "center",
    fontSize: 16,
  },
  previewTitle: {
    marginTop: 10,
    marginBottom: 8,
    fontWeight: "700",
    color: "#172121",
  },
  previewBox: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 10,
  },
  previewText: {
    fontFamily: "monospace",
    color: "#1e2428",
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
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 10,
  },
  modalActionBtn: {
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  modalShareBtn: {
    backgroundColor: "#ca6702",
  },
  modalMailBtn: {
    backgroundColor: "#2a9d8f",
  },
  modalCancelBtn: {
    backgroundColor: "#7b8791",
  },
  modalActionText: {
    color: "#fff",
    fontWeight: "700",
    textAlign: "center",
  },
});
