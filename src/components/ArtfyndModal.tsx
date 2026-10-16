import React from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { useArtfynd } from "../hooks/useArtfynd";
import { redlistColor } from "../services/artdataProcessor";

type Props = { visible: boolean; onClose: () => void; onFetch: () => void; artfynd: ReturnType<typeof useArtfynd> };

export function ArtfyndModal({ visible, onClose, onFetch, artfynd: a }: Props) {
  const arrow = (field: "name" | "redlist" | "count") => a.sort.field === field ? (a.sort.direction === "asc" ? " ↑" : " ↓") : "";
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.backdrop} edges={["top", "bottom"]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Stäng artfynd" />
        <View style={styles.card} accessibilityViewIsModal>
          <View style={styles.header}>
            <Text style={styles.title}>Artfynd</Text>
            <Button label={a.loading ? "Hämtar…" : "Hämta"} onPress={onFetch} disabled={a.loading} />
            <Button label="Rensa" onPress={a.clear} secondary disabled={a.observationsById.size === 0 && !a.loading} />
            <Pressable accessibilityRole="button" accessibilityLabel="Stäng artfynd" onPress={onClose} style={styles.closeButton}>
              <Svg width={28} height={28} viewBox="0 0 24 24">
                <Path d="M6 6l12 12M18 6L6 18" fill="none" stroke="#c62828" strokeWidth={2.5} strokeLinecap="round" />
              </Svg>
            </Pressable>
          </View>
          {a.loading && <ActivityIndicator color="#005f73" accessibilityLabel="Hämtar artfynd" />}
          <FlatList
            style={styles.list} contentContainerStyle={styles.listContent} data={a.groups} keyExtractor={item => item.key} extraData={a.selectedSpeciesKeys}
            ListHeaderComponent={<View style={styles.listHeader}>
          <Text style={styles.summary}>{a.groups.filter(g => g.key !== "unknown").length} arter · {a.observationsById.size} fynd</Text>
          <Text style={styles.help}>Kartans synliga område · senaste 25 åren · högst 100 m osäkerhet · inkluderar rödlistade arter och Skogsstyrelsens signalarter</Text>
          {a.missingCoordinates > 0 && <Text style={styles.help}>{a.missingCoordinates} fynd saknar användbar position och visas endast i listan.</Text>}
          {a.resultLimited && <Text style={styles.warning}>Minst en sökning nådde gränsen 500 fynd. Resultatet kan vara ofullständigt. Zooma in och hämta fler områden.</Text>}
          {a.error && <Text style={styles.error} accessibilityLiveRegion="polite">{a.error}</Text>}

          <View style={styles.headers}>
            <Pressable accessibilityRole="button" style={styles.nameHeader} onPress={() => a.changeSort("name")}><Text style={styles.bold}>Namn{arrow("name")}</Text></Pressable>
            <Pressable accessibilityRole="button" style={styles.statusHeader} onPress={() => a.changeSort("redlist")}><Text style={styles.bold}>Rödlista{arrow("redlist")}</Text></Pressable>
            <Pressable accessibilityRole="button" style={styles.countHeader} onPress={() => a.changeSort("count")}><Text style={styles.bold}>#{arrow("count")}</Text></Pressable>
          </View>
            </View>}
            ListEmptyComponent={<Text style={styles.empty}>Tryck på Hämta för att söka i kartans aktuella område.</Text>}
            renderItem={({ item }) => {
              const checked = a.selectedSpeciesKeys.has(item.key);
              return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }}
                accessibilityLabel={`${item.name}, ${item.redlistStatus ?? "rödlistestatus saknas"}, ${item.count} fynd`}
                onPress={() => a.toggleSpecies(item.key)} style={[styles.speciesRow, checked && styles.checked]}>
                <Text style={styles.checkbox}>{checked ? "☑" : "☐"}</Text>
                <View style={styles.name}>
                  <Text style={styles.bold}>{item.name}</Text>
                  {item.scientificName && item.scientificName !== item.name && <Text style={styles.scientific}>{item.scientificName}</Text>}
                </View>
                <View style={styles.badge}><View style={[styles.dot, { backgroundColor: redlistColor(item.redlistStatus) }]} /><Text>{item.redlistStatus ?? "Saknas"}</Text></View>
                <Text style={styles.count}>{item.count}</Text>
              </Pressable>;
            }}
          />
          <View style={styles.row}>
            <Button label="Visa urval" disabled={a.selectedSpeciesKeys.size === 0} onPress={() => { if (a.applySelection()) onClose(); }} />
            <Button label="Återställ" onPress={a.reset} secondary disabled={a.selectedSpeciesKeys.size === 0 && a.activeSpeciesFilter === null} />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function Button({ label, onPress, disabled = false, secondary = false }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} hitSlop={4}
    style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", padding: 12, justifyContent: "center" },
  card: { flex: 1, maxHeight: "96%", borderRadius: 14, overflow: "hidden", backgroundColor: "#e9e3d5" },
  header: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 14, paddingRight: 6, paddingVertical: 10, backgroundColor: "#e9e3d5" },
  closeButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", transform: [{ translateY: -6 }] },
  row: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap", paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#e9e3d5" },
  title: { flex: 1, fontSize: 19, fontWeight: "700", color: "#172121" },
  button: { minHeight: 36, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 8, backgroundColor: "#005f73", justifyContent: "center" },
  secondary: { backgroundColor: "#ca6702" }, disabled: { backgroundColor: "#59666b" }, buttonText: { color: "white", fontWeight: "700" },
  summary: { fontSize: 17, fontWeight: "700" }, help: { color: "#425158", fontSize: 12 },
  warning: { backgroundColor: "#fff0c2", padding: 8, borderRadius: 6, color: "#624400" },
  error: { color: "#9b2226", fontWeight: "600" },
  headers: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderColor: "#c8b79f" },
  nameHeader: { flex: 1, paddingVertical: 12 }, statusHeader: { width: 86, paddingVertical: 12 }, countHeader: { width: 40, paddingVertical: 12, alignItems: "flex-end" },
  bold: { fontWeight: "600", color: "#172121" }, list: { flex: 1, backgroundColor: "#f4f0e7" }, listContent: { paddingHorizontal: 14, paddingVertical: 10 }, listHeader: { gap: 10 },
  speciesRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#c8b79f", minHeight: 54 },
  checked: { backgroundColor: "#dbecec" }, checkbox: { fontSize: 23, color: "#005f73" },
  name: { flex: 1 }, scientific: { fontStyle: "italic", color: "#59666b", fontSize: 12, marginTop: 2 },
  badge: { width: 80, flexDirection: "row", alignItems: "center", gap: 4 }, dot: { width: 9, height: 9, borderRadius: 5 },
  count: { width: 40, textAlign: "right" }, empty: { paddingVertical: 20, color: "#59666b" },
});
