import React, { useMemo, useRef, useState } from "react";
import { FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Biotope } from "../types/models";
import { biotopeAncestors, BiotopeNode, BiotopeRow, biotopeRows } from "./biotopeTree";

type Props = {
  nodes: BiotopeNode[];
  selected?: Biotope | null;
  onSelect: (value: Biotope) => void;
  onClear: () => void;
  onClose: () => void;
};

export function BiotopePicker({ nodes, selected, onSelect, onClear, onClose }: Props) {
  const listRef = useRef<FlatList<BiotopeRow>>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(() => new Set(biotopeAncestors(nodes, selected?.id)));
  const [searchExpanded, setSearchExpanded] = useState(new Set<string>());
  const searching = query.trim().length > 0;
  const activeExpanded = searching ? searchExpanded : expanded;
  const rows = useMemo(() => biotopeRows(nodes, query, activeExpanded), [nodes, query, activeExpanded]);

  function clearSelection() {
    onClear();
    setQuery("");
    setExpanded(new Set());
    setSearchExpanded(new Set());
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    Keyboard.dismiss();
  }

  function toggle(key: string) {
    const update = searching ? setSearchExpanded : setExpanded;
    update(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined} accessibilityViewIsModal>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">Biotop</Text>
        <Pressable onPress={onClose} accessibilityRole="button" style={styles.close}>
          <Text style={styles.action}>Stäng</Text>
        </Pressable>
      </View>
      <TextInput
        accessibilityLabel="Sök biotop"
        placeholder="Sök biotop..."
        placeholderTextColor="#626568"
        value={query}
        onChangeText={value => { setQuery(value); setSearchExpanded(new Set()); }}
        autoCorrect={false}
        style={styles.search}
      />
      {selected && (
        <View style={styles.selection}>
          <Text style={styles.selectedLabel}>Vald: {selected.label}</Text>
          <Pressable onPress={clearSelection} accessibilityRole="button" style={styles.close}>
            <Text style={styles.action}>Rensa val</Text>
          </Pressable>
        </View>
      )}
      <FlatList
        ref={listRef}
        style={styles.list}
        data={rows}
        keyExtractor={row => row.key}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={<Text style={styles.empty}>Inga biotoper hittades.</Text>}
        renderItem={({ item: { node, key, depth, path } }) => (
          <View style={[styles.row, { paddingLeft: Math.min(depth, 8) * 14 }, selected?.id === node.id && styles.selected]}>
            {node.children.length > 0 ? (
              <Pressable
                onPress={() => toggle(key)}
                style={styles.toggle}
                accessibilityRole="button"
                accessibilityLabel={`${activeExpanded.has(key) ? "Fäll ihop" : "Visa underkategorier för"} ${node.label}`}
                accessibilityState={{ expanded: activeExpanded.has(key) }}
              >
                <View style={styles.chevronButton}>
                  <Svg width={16} height={16} viewBox="0 0 16 16">
                    <Path
                      d={activeExpanded.has(key) ? "M4 6 L8 10 L12 6" : "M6 4 L10 8 L6 12"}
                      fill="none"
                      stroke="#426f79"
                      strokeWidth={1.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Svg>
                </View>
              </Pressable>
            ) : <View style={styles.toggle} />}
            <Pressable
              style={styles.name}
              onPress={() => onSelect({ id: node.id, label: node.label })}
              accessibilityRole="button"
              accessibilityState={{ selected: selected?.id === node.id }}
            >
              <Text style={styles.label}>{node.label}</Text>
              {searching && path.length > 0 && <Text style={styles.path}>{path.join(" › ")}</Text>}
            </Pressable>
          </View>
        )}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "#fff", borderRadius: 12, padding: 14, zIndex: 30 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  title: { fontSize: 20, fontWeight: "700", color: "#172121" },
  close: { padding: 10 },
  action: { color: "#005f73", fontWeight: "600" },
  search: { borderWidth: 1, borderColor: "#b7c5c5", borderRadius: 8, padding: 10, fontSize: 16, color: "#172121", marginBottom: 8 },
  selection: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  selectedLabel: { flex: 1, color: "#173b63" },
  list: { flex: 1 },
  row: { flexDirection: "row", alignItems: "stretch", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#ddd" },
  selected: { backgroundColor: "#e0eff2" },
  toggle: { width: 40, minHeight: 44, alignItems: "center", justifyContent: "center" },
  chevronButton: { width: 24, height: 24, borderRadius: 6, backgroundColor: "#eff5f6", borderWidth: 1, borderColor: "#c8dbdf", alignItems: "center", justifyContent: "center" },
  name: { flex: 1, minHeight: 44, paddingVertical: 11, paddingRight: 8, justifyContent: "center" },
  label: { fontSize: 16, color: "#173b63" },
  path: { fontSize: 11, color: "#626568", marginTop: 3 },
  empty: { padding: 16, color: "#626568" },
});
