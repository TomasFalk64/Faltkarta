import React, { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/types";
import { loadMaps, loadObservationsForMap } from "../storage/storage";
import { Observation } from "../types/models";
import {
  buildArtportalenTsv,
  buildCsv,
  copyTsvAndOpenArtportalen,
  saveCsvAndComposeEmail,
  saveCsvAndShare,
} from "../services/export";

type Props = NativeStackScreenProps<RootStackParamList, "Export">;

export function ExportScreen({ route }: Props) {
  const { mapId } = route.params;
  const [mapName, setMapName] = useState("export");
  const [observations, setObservations] = useState<Observation[]>([]);
  const [preview, setPreview] = useState("");

  useEffect(() => {
    (async () => {
      const [maps, obs] = await Promise.all([loadMaps(), loadObservationsForMap(mapId)]);
      const m = maps.find((item) => item.id === mapId);
      if (m) setMapName(m.name);
      setObservations(obs);
      setPreview(buildArtportalenTsv(obs).slice(0, 600));
    })().catch((e) => Alert.alert("Fel", String(e)));
  }, [mapId]);

  async function onCopyArtportalen() {
    if (!observations.length) {
      Alert.alert("Export", "Inga observationer att exportera.");
      return;
    }
    const tsv = buildArtportalenTsv(observations);
    await copyTsvAndOpenArtportalen(tsv);
    Alert.alert("Klart", "TSV kopierad till urklipp. Artportalen öppnad.");
  }

  async function onSaveCsv() {
    if (!observations.length) {
      Alert.alert("Export", "Inga observationer att exportera.");
      return;
    }
    const csv = buildCsv(observations);
    const path = await saveCsvAndShare(mapName, csv);
    Alert.alert("Sparad", `Fil skapad:\n${path}`);
  }

  async function onEmailCsv() {
    if (!observations.length) {
      Alert.alert("Export", "Inga observationer att exportera.");
      return;
    }
    const csv = buildCsv(observations);
    const result = await saveCsvAndComposeEmail(mapName, csv);
    if (!result.opened) {
      Alert.alert("E-post", `E-post ar inte tillgangligt pa enheten.\nFilen sparades:\n${result.path}`);
      return;
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Exportera observationer</Text>
      <Text style={styles.subtitle}>
        {observations.length} observationer på kartan {mapName}
      </Text>

      <Pressable style={styles.primaryBtn} onPress={onCopyArtportalen}>
        <Text style={styles.primaryText}>Kopiera till Artportalen</Text>
      </Pressable>
      <Pressable style={[styles.primaryBtn, styles.altBtn]} onPress={onSaveCsv}>
        <Text style={styles.primaryText}>Spara till Excel (CSV)</Text>
      </Pressable>
      <Pressable style={[styles.primaryBtn, styles.mailBtn]} onPress={onEmailCsv}>
        <Text style={styles.primaryText}>Skicka CSV via e-post</Text>
      </Pressable>

      <Text style={styles.previewTitle}>Förhandsvisning TSV</Text>
      <ScrollView style={styles.previewBox}>
        <Text style={styles.previewText}>{preview || "Tomt"}</Text>
      </ScrollView>
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
  mailBtn: {
    backgroundColor: "#2a9d8f",
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
});
