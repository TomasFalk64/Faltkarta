import React from "react";
import { Alert, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { Artfynd } from "../types/artfynd";
import { speciesName } from "../services/artdataProcessor";

export function ArtfyndPopup({ observation: o, onClose }: { observation: Artfynd | null; onClose: () => void }) {
  return <Modal visible={o !== null} transparent animationType="fade" onRequestClose={onClose}>
    <SafeAreaView style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Stäng fyndinformation" />
      {o && <View style={styles.card} accessibilityViewIsModal>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{speciesName(o)}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Stäng fyndinformation" onPress={onClose} style={styles.closeButton}>
            <Svg width={28} height={28} viewBox="0 0 24 24">
              <Path d="M6 6l12 12M18 6L6 18" fill="none" stroke="#c62828" strokeWidth={2.5} strokeLinecap="round" />
            </Svg>
          </Pressable>
        </View>
        {o.scientificName && <Text style={styles.scientific}>{o.scientificName}</Text>}
        <Text>Grupp: {o.organismGroup ?? "Uppgift saknas"}</Text>
        <Text>Rödlistning: {o.redlistStatus ?? "Uppgift saknas"}</Text>
        <Text>Datum: {o.date ?? "Uppgift saknas"}</Text>
        <Text>Osäkerhet: {o.uncertaintyMeters === null ? "Uppgift saknas" : `${o.uncertaintyMeters} m`}</Text>
        {o.url && <Pressable accessibilityRole="link" style={styles.button} onPress={() => {
          void Linking.openURL(o.url!).catch(() => Alert.alert("Länken kunde inte öppnas", "Försök igen senare."));
        }}><Text style={styles.link}>Öppna i Artportalen ↗</Text></Pressable>}
      </View>}
    </SafeAreaView>
  </Modal>;
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.3)" },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 18, gap: 6 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  closeButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", transform: [{ translateX: 12 }, { translateY: -12 }] },
  title: { flex: 1, fontSize: 19, fontWeight: "700" }, scientific: { fontStyle: "italic", marginBottom: 5 },
  button: { minHeight: 44, justifyContent: "center" }, link: { color: "#005f73", fontWeight: "700" },
});
