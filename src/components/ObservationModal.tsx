import React, { useMemo, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Image,
  ScrollView,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { speciesList } from "../data/species";

type Props = {
  visible: boolean;
  title: string;
  onClose: () => void;
  onSave: (payload: {
    species: string;
    count: number;
    notes: string;
    photoUris: string[];
  }) => void;
};

export function ObservationModal({ visible, title, onClose, onSave }: Props) {
  const [species, setSpecies] = useState("");
  const [count, setCount] = useState("1");
  const [notes, setNotes] = useState("");
  const [photoUris, setPhotoUris] = useState<string[]>([]);

  const suggestions = useMemo(() => {
    const q = species.trim().toLowerCase();
    if (!q) return [];
    return speciesList.filter((s) => s.toLowerCase().includes(q)).slice(0, 6);
  }, [species]);

  async function addPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: false,
      selectionLimit: 1,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setPhotoUris((prev) => [...prev, result.assets[0].uri]);
    }
  }

  function resetAndClose() {
    setSpecies("");
    setCount("1");
    setNotes("");
    setPhotoUris([]);
    onClose();
  }

  function submit() {
    const parsedCount = Number.parseInt(count, 10);
    onSave({
      species: species.trim(),
      count: Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : 1,
      notes: notes.trim(),
      photoUris,
    });
    resetAndClose();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={resetAndClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <ScrollView>
            <TextInput
              value={species}
              onChangeText={setSpecies}
              style={styles.input}
              placeholder="Artnamn"
            />
            {suggestions.length > 0 && (
              <View style={styles.suggestions}>
                {suggestions.map((item) => (
                  <Pressable key={item} onPress={() => setSpecies(item)} style={styles.suggestionItem}>
                    <Text>{item}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <TextInput
              value={count}
              onChangeText={setCount}
              style={styles.input}
              keyboardType="number-pad"
              placeholder="Antal"
            />
            <TextInput
              value={notes}
              onChangeText={setNotes}
              style={[styles.input, styles.notes]}
              placeholder="Beskrivning"
              multiline
            />
            <Pressable style={styles.photoBtn} onPress={addPhoto}>
              <Text style={styles.photoBtnText}>Lägg till foto</Text>
            </Pressable>
            <View style={styles.photoRow}>
              {photoUris.map((uri) => (
                <Image key={uri} source={{ uri }} style={styles.photo} />
              ))}
            </View>
          </ScrollView>
          <View style={styles.actions}>
            <Pressable style={[styles.actionBtn, styles.cancelBtn]} onPress={resetAndClose}>
              <Text style={styles.actionText}>Avbryt</Text>
            </Pressable>
            <Pressable
              style={[styles.actionBtn, styles.saveBtn]}
              onPress={submit}
              disabled={!species.trim()}
            >
              <Text style={styles.actionText}>Spara</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    padding: 16,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    maxHeight: "85%",
    padding: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: "#bfc6cc",
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    backgroundColor: "#fff",
  },
  notes: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  suggestions: {
    borderWidth: 1,
    borderColor: "#d8d8d8",
    borderRadius: 8,
    marginBottom: 8,
    maxHeight: 120,
  },
  suggestionItem: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ececec",
  },
  photoBtn: {
    backgroundColor: "#005f73",
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  photoBtnText: {
    color: "#fff",
    fontWeight: "700",
    textAlign: "center",
  },
  photoRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  photo: {
    width: 62,
    height: 62,
    borderRadius: 6,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 12,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
  },
  cancelBtn: {
    backgroundColor: "#8a939b",
  },
  saveBtn: {
    backgroundColor: "#0a9396",
  },
  actionText: {
    color: "#fff",
    textAlign: "center",
    fontWeight: "700",
  },
});
