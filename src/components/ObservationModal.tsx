import React, { useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from '@expo/vector-icons';
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

type ModalPayload = {
  species: string;
  notes: string;
  photoUris: string[];
  photoAssetIds?: string[];
  localName?: string;
  quantity?: number;
  unit?: string;
  accuracyMeters?: number | null;
};

type Props = {
  visible: boolean;
  title: string;
  onClose: () => void;
  onSave: (payload: ModalPayload) => Promise<boolean | void> | boolean | void;
  initialValues?: ModalPayload;
  onDelete?: () => Promise<void> | void;
  sessionToken?: number;
  showPointMetaFields?: boolean;
  speciesPlaceholder?: string;
};

export function ObservationModal({
  visible,
  title,
  onClose,
  onSave,
  initialValues,
  onDelete,
  sessionToken,
  showPointMetaFields = false,
  speciesPlaceholder = "Artnamn",
}: Props) {
  const [species, setSpecies] = useState("");
  const [notes, setNotes] = useState("");
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const [photoAssetIds, setPhotoAssetIds] = useState<string[]>([]);
  const [localName, setLocalName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [accuracyMeters, setAccuracyMeters] = useState("");
  const wasVisibleRef = useRef(false);
  const lastSessionTokenRef = useRef<number | undefined>(undefined);
  const [isShowingSuggestions, setIsShowingSuggestions] = useState(false);

  useEffect(() => {
    if (sessionToken !== undefined) {
      if (lastSessionTokenRef.current !== sessionToken) {
        setSpecies(initialValues?.species ?? "");
        setNotes(initialValues?.notes ?? "");
        setPhotoUris(initialValues?.photoUris ?? []);
        setPhotoAssetIds(initialValues?.photoAssetIds ?? []);
        setLocalName(initialValues?.localName ?? "");
        setQuantity(initialValues?.quantity !== undefined ? String(initialValues.quantity) : "");
        setUnit(initialValues?.unit ?? "");
        setAccuracyMeters(
          initialValues?.accuracyMeters === null || initialValues?.accuracyMeters === undefined
            ? ""
            : String(initialValues.accuracyMeters)
        );
        lastSessionTokenRef.current = sessionToken;
      }
      wasVisibleRef.current = visible;
      return;
    }
    
    const openedNow = visible && !wasVisibleRef.current;
    if (openedNow) {
      setSpecies(initialValues?.species ?? "");
      setNotes(initialValues?.notes ?? "");
      setPhotoUris(initialValues?.photoUris ?? []);
      setPhotoAssetIds(initialValues?.photoAssetIds ?? []);
      setLocalName(initialValues?.localName ?? "");
      setQuantity(initialValues?.quantity ?? "");
      setUnit(initialValues?.unit ?? "");
      setAccuracyMeters(
        initialValues?.accuracyMeters === null || initialValues?.accuracyMeters === undefined
          ? ""
          : String(initialValues.accuracyMeters)
      );
    }
    wasVisibleRef.current = visible;
  }, [initialValues, sessionToken, visible]);

  useEffect(() => {
  // 1. Arten måste vara knärot
  // 2. Användaren måste ha skrivit in ett antal (quantity är inte tomt)
  // 3. Enheten måste vara tom (så vi inte skriver över om användaren redan valt en annan)
  if (species.toLowerCase().includes('knärot') && quantity !== "" && unit === "") {
    setUnit('plantor/tuvor');
  }
});

  const suggestions = useMemo(() => {
    const q = species.trim().toLowerCase();
    if (!q) return [];
    return speciesList.filter((s) => s.toLowerCase().startsWith(q)).slice(0, 3);
  }, [species]);

  async function addPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      allowsEditing: false,
      selectionLimit: 1,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setPhotoUris((prev) => [...prev, result.assets[0].uri]);
      setPhotoAssetIds((prev) => [...prev, String(result.assets[0].assetId ?? "")]);
    }
  }

  async function removePhotoAt(index: number) {
    setPhotoUris((prev) => prev.filter((_, i) => i !== index));
    setPhotoAssetIds((prev) => prev.filter((_, i) => i !== index));
  }

  async function resetAndClose() {
    //  if (onDelete) {await onDelete();}
    setSpecies("");
    setNotes("");
    setPhotoUris([]);
    setPhotoAssetIds([]);
    setLocalName("");
    setAccuracyMeters("");
    onClose();
  }

  async function submit() {
    if (!species || species.trim().length === 0) {
    // Alert.alert("Fel", "Du måste ange ett artnamn.");
    return; 
  }
    const parsedAccuracy = Number.parseFloat(accuracyMeters.replace(",", "."));
    const rawVal = quantity.trim();
    const quantityAsNumber = rawVal === "" ? undefined : Number(rawVal);
    const shouldClose = await onSave({
      species: species.trim(),
      notes: notes.trim(),
      photoUris,
      photoAssetIds,
      localName: localName.trim(),
      quantity: quantityAsNumber, 
      unit: unit.trim(),
      accuracyMeters:
        Number.isFinite(parsedAccuracy) && parsedAccuracy >= 0 ? Math.round(parsedAccuracy) : null,
    });
    if (shouldClose !== false) {
      await resetAndClose();
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => void resetAndClose()}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Pressable 
              style={styles.xIcon} 
              onPress={async () => {
                // 1. Radera om vi är i redigeringsläge
                if (onDelete) {
                  await onDelete();
                }
                // 2. Städa och stäng
                await resetAndClose();
              }}
            >
              <Ionicons name="close" size={30} color="#9b2226" />
            </Pressable>

            <Text style={styles.title}>{title}</Text>

            <Pressable style={styles.checkIcon} onPress={() => void submit()}>
              <Ionicons name="checkmark" size={30} color="#0a9396" />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
            <TextInput
              value={species}
              onChangeText={(text) => {
                setSpecies(text); // Uppdatera texten
                setIsShowingSuggestions(true);
              }}
              style={styles.input}
            />
            {isShowingSuggestions && suggestions.length > 0 && (
              <View style={styles.suggestions}>
                {suggestions.map((item) => (
                  <Pressable 
                    key={item} 
                    onPress={() => {
                      setSpecies(item);
                      setIsShowingSuggestions(false); // Stäng menyn vid val
                    }} 
                    style={styles.suggestionItem}
                  >
                    <Text>{item}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <TextInput
              value={notes}
              onChangeText={setNotes}
              style={[styles.input, styles.notes]}
              placeholder="Beskrivning"
              multiline
            />
            <View style={styles.dividerContainer}>
              <View style={styles.line} />
              <Text style={styles.dividerText}>Extra info nedan</Text>
              <View style={styles.line} />
            </View>
            <View style={styles.metaRow}>
              <TextInput
                value={quantity}
                onChangeText={setQuantity}
                style={[styles.input, styles.metaInput, { flex: 1 }]}
                placeholder="Antal"
                keyboardType="numeric"
              />
              <TextInput
                value={unit}
                onChangeText={setUnit}
                style={[styles.input, styles.metaInput, { flex: 2, marginLeft: 10 }]}
                placeholder="Enhet"
              />
            </View>
            {showPointMetaFields && (
              <>
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Lokalnamn</Text>
                  <TextInput
                    value={localName}
                    onChangeText={setLocalName}
                    style={[styles.input, styles.metaInput]}
                    placeholder="Ange lokalnamn"
                  />
                </View>
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Noggrannhet (m)</Text>
                  <TextInput
                    value={accuracyMeters}
                    onChangeText={setAccuracyMeters}
                    style={[styles.input, styles.metaInput]}
                    placeholder="Ange meter"
                    keyboardType="decimal-pad"
                  />
                </View>
              </>
            )}
            {photoUris.length < 3 ? (
              <Pressable style={styles.photoBtn} onPress={addPhoto}>
                <Text style={styles.photoBtnText}>Lägg till foto ({photoUris.length}/3)</Text>
              </Pressable>
            ) : (
              <View style={[styles.photoBtn, { backgroundColor: '#ccc' }]}>
                <Text style={styles.photoBtnText}>Max 3 bilder nådd</Text>
              </View>
            )}
            <View style={styles.photoRow}>
              {photoUris.map((uri, index) => (
                <Pressable
                  key={`${uri}-${index}`}
                  onPress={() => void removePhotoAt(index)}
                  style={styles.photoWrap}
                >
                  <Image source={{ uri }} style={styles.photo} />
                  <View style={styles.removeBadge}>
                    <Text style={styles.removeBadgeText}>x</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </ScrollView>
  
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-start",
    padding:16,
    paddingTop: 30,
    paddingBottom: 0,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    flex: 1,
    //minHeight: "100%",
    //maxHeight: "80%",
    
    //height: "80%",
    height: 500,
    marginBottom: 5,
    padding: 14,
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
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  metaLabel: {
    width: 150,
    fontWeight: "600",
    color: "#23313a",
  },
  metaInput: {
    flex: 1,
    marginBottom: 0,
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
  photoWrap: {
    position: "relative",
  },
  photo: {
    width: 62,
    height: 62,
    borderRadius: 6,
  },
  removeBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#9b2226",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#fff",
  },
  removeBadgeText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 12,
    lineHeight: 12,
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
  deleteBtn: {
    backgroundColor: "#9b2226",
  },
  actionText: {
    color: "#fff",
    textAlign: "center",
    fontWeight: "700",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 5,
    marginBottom: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    flex: 1,           // Gör att titeln tar ledigt utrymme i mitten
    textAlign: "center", // Centrerar texten mellan ikonerna
  },
  xIcon: {
    color: "#9b2226", // Röd
    fontSize: 28,     // Lite större för tydlighet
    fontWeight: "900",
  },
  checkIcon: {
    color: "#0a9396", // Grön
    fontSize: 28,
    fontWeight: "900",
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
  },
  line: {
    flex: 1,
    height: 1.5,
    backgroundColor: '#0a9396',
  },
  dividerText: {
    marginHorizontal: 10,
    color: '#888',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
});
