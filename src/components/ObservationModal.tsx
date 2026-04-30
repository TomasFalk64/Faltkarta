import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Image,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import * as ImagePicker from "expo-image-picker";
import { speciesInfo } from "../data/species_info";
import { addUserSpecies, loadUserSpecies } from "../storage/storage";

type ModalPayload = {
  species?: string;
  polygonName?: string;
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
  showQuantityField?: boolean;
  speciesPlaceholder?: string;
  kind?: "point" | "polygon";
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
  showQuantityField = false,
  speciesPlaceholder = "Artnamn",
  kind = "point",
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
  const [userSpecies, setUserSpecies] = useState<string[]>([]);
  const isSubmittingRef = useRef(false);
  const [pendingNewSpecies, setPendingNewSpecies] = useState<string | null>(null);
  const isPolygon = kind === "polygon";
  const [showSpeciesInfo, setShowSpeciesInfo] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (sessionToken !== undefined) {
      if (lastSessionTokenRef.current !== sessionToken) {
        setSpecies(
          isPolygon ? initialValues?.polygonName ?? "" : initialValues?.species ?? ""
        );
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
        setShowSpeciesInfo(false);
        lastSessionTokenRef.current = sessionToken;
      }
      wasVisibleRef.current = visible;
      return;
    }
    
    const openedNow = visible && !wasVisibleRef.current;
    if (openedNow) {
      setSpecies(
        isPolygon ? initialValues?.polygonName ?? "" : initialValues?.species ?? ""
      );
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
      setShowSpeciesInfo(false);
    }
    wasVisibleRef.current = visible;
  }, [initialValues, isPolygon, sessionToken, visible]);

  useEffect(() => {
    if (!visible) return;
    loadUserSpecies()
      .then((list) => setUserSpecies(list))
      .catch(() => setUserSpecies([]));
  }, [visible, sessionToken]);

  useEffect(() => {
    // 1. Arten måste vara knärot
    // 2. Användaren måste ha skrivit in ett antal (quantity är inte tomt)
    // 3. Enheten måste vara tom (så vi inte skriver över om användaren redan valt en annan)
    if (species.toLowerCase().includes("kn\u00e4rot") && quantity !== "" && unit === "") {
      setUnit("plantor/tuvor");
    }
  }, [species, quantity, unit]);

  const combinedSpecies = useMemo(() => {
    const byLower = new Map<string, string>();
    Object.keys(speciesInfo).forEach((s) => {
      const key = s.toLowerCase();
      if (!byLower.has(key)) byLower.set(key, s);
    });
    userSpecies.forEach((s) => {
      const key = s.toLowerCase();
      if (!byLower.has(key)) byLower.set(key, s);
    });
    return Array.from(byLower.values());
  }, [userSpecies]);

  const speciesInfoByLower = useMemo(() => {
    const map = new Map<string, { redList: string; speciesInfo: string }>();
    Object.entries(speciesInfo).forEach(([name, info]) => {
      map.set(name.toLowerCase(), info);
    });
    return map;
  }, []);

  const selectedInfo = useMemo(() => {
    if (!species) return null;
    const direct = speciesInfo[species];
    if (direct) return direct;
    return speciesInfoByLower.get(species.toLowerCase()) ?? null;
  }, [species, speciesInfoByLower]);

  const selectedRedList = (selectedInfo?.redList ?? "")
    .toUpperCase()
    .replace(/[\s\u00A0]+/g, "");
  const redListColors: Record<string, string> = {
    CR: "#8b0000",
    EN: "#c1121f",
    VU: "#d24d25",
    NT: "#e76f00",
    DD: "#6b7280",
    LC: "#172121",
  };
  const selectedSpeciesInfo = selectedInfo?.speciesInfo ?? "";

  const suggestions = useMemo(() => {
    const q = species.trim().toLowerCase();
    if (!q) return [];
    return combinedSpecies.filter((s) => s.toLowerCase().startsWith(q)).slice(0, 3);
  }, [combinedSpecies, species]);

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
    setSpecies("");
    setNotes("");
    setPhotoUris([]);
    setPhotoAssetIds([]);
    setLocalName("");
    setAccuracyMeters("");
    setShowSpeciesInfo(false);
    setShowDeleteConfirm(false);
    onClose();
  }

  function confirmDelete() {
    if (!onDelete) {
      void resetAndClose();
      return;
    }
    setShowDeleteConfirm(true);
  }

  async function handleConfirmedDelete() {
    if (!onDelete) return;
    setShowDeleteConfirm(false);
    await onDelete();
    await resetAndClose();
  }

  async function submit() {
    if (!species || species.trim().length === 0) {
      // Alert.alert("Fel", "Du måste ange ett artnamn.");
      return;
    }
    const trimmedSpecies = species.trim();
    const isKnown = combinedSpecies.some((s) => s.toLowerCase() === trimmedSpecies.toLowerCase());
    if (!isPolygon && showPointMetaFields && !isKnown) {
      setPendingNewSpecies(trimmedSpecies);
      return;
    }
    await doSave(false);
  }

  async function doSave(addToSuggestions: boolean) {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    try {
      const parsedAccuracy = Number.parseFloat(accuracyMeters.replace(",", "."));
      const rawVal = quantity.trim();
      const quantityAsNumber = rawVal === "" ? undefined : Number(rawVal);
      const trimmedSpecies = species.trim();
      if (!isPolygon && addToSuggestions) {
        const next = await addUserSpecies(trimmedSpecies);
        setUserSpecies(next);
      }
      const shouldClose = await onSave({
        species: isPolygon ? undefined : trimmedSpecies,
        polygonName: isPolygon ? trimmedSpecies : undefined,
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
    } finally {
      isSubmittingRef.current = false;
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => void resetAndClose()}>
      <View style={[styles.backdrop, Platform.OS === "android" ? styles.backdropAndroid : undefined]}>
        <SafeAreaView style={[styles.safeArea, Platform.OS === "android" ? styles.safeAreaAndroid : undefined]} edges={["top", "bottom"]}>
          <View style={styles.card}>
            <View style={styles.header}>
            <Pressable 
              style={styles.iconBtn}
              onPress={confirmDelete}
            >
              <Svg width={36} height={36} viewBox="0 0 24 24">
                <Path
                  d="M9 4.5h6M10 4.5l.5-1h3L14 4.5M5.5 7.5h13M8.5 7.5v10a1 1 0 001 1h5a1 1 0 001-1v-10M10.5 10.5v5M13.5 10.5v5"
                  stroke="#aa191e"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </Svg>
                          </Pressable>

            <Text style={styles.title}>{title}</Text>

            <Pressable style={styles.iconBtn} onPress={() => void submit()}>
              <Svg width={36} height={36} viewBox="0 0 24 24">
                <Path
                  d="M5 12l4 4 10-10"
                  stroke="#1da328"
                  strokeWidth={3.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </Svg>
            </Pressable>
            </View>
            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : undefined}
              keyboardVerticalOffset={Platform.OS === "ios" ? 40 : 0}
              style={styles.keyboardAvoid}
            >
              <ScrollView
                keyboardShouldPersistTaps="always"
                keyboardDismissMode="on-drag"
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
              >
            <View style={styles.speciesRow}>
              <TextInput
                value={species}
                onChangeText={(text) => {
                  setSpecies(text);
                  setIsShowingSuggestions(true);
                  if (showSpeciesInfo) {
                    setShowSpeciesInfo(false);
                  }
                }}
                onFocus={() => {
                  setIsShowingSuggestions(true);
                  setShowSpeciesInfo(false);
                }}
                onBlur={() => setTimeout(() => setIsShowingSuggestions(false), 120)}
                placeholder={speciesPlaceholder}
                placeholderTextColor="#77838c"
                style={[styles.input, styles.speciesInput]}
              />
              <Pressable
                onPress={() => setShowSpeciesInfo((v) => !v)}
                style={[
                  styles.redListBadge,
                  {
                    backgroundColor: selectedRedList
                      ? selectedRedList === "LC"
                        ? "#1b5e3a"
                        : selectedRedList === "NT"
                          ? "#d97706"
                          : selectedRedList === "VU"
                            ? "#c2410c"
                            : "#b91c1c"
                      : "#e3e6ea",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.redListBadgeText,
                    { color: "#ffffff" },
                  ]}
                >
                  {selectedRedList}
                </Text>
              </Pressable>
            </View>
            {isShowingSuggestions && suggestions.length > 0 && (
              <View style={styles.suggestions}>
                {suggestions.map((item) => (
                  <Pressable 
                    key={item} 
                    onPress={() => {
                      setSpecies(item);
                      setShowSpeciesInfo(false);
                      setIsShowingSuggestions(false);
                    }} 
                    style={styles.suggestionItem}
                  >
                    <Text>{item}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {!isPolygon && showSpeciesInfo ? (
              <View style={styles.infoCard}>
                <Text style={styles.infoText}>
                  {selectedSpeciesInfo || "Information om arten saknas"}
                </Text>
              </View>
            ) : null}
            <TextInput
              value={notes}
              onChangeText={setNotes}
              onFocus={() => setIsShowingSuggestions(false)}
              style={[styles.input, styles.notes]}
              placeholder="Beskrivning"
              placeholderTextColor="#77838c"
              multiline
            />
            <View style={styles.dividerContainer}>
              <View style={styles.line} />
              <Text style={styles.dividerText}>Extra info nedan</Text>
              <View style={styles.line} />
            </View>
            {showQuantityField && (
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
            )}
            {showPointMetaFields && (
              <>
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Lokalnamn</Text>
                  <TextInput
                    value={localName}
                    onChangeText={setLocalName}
                    style={[styles.input, styles.metaInput]}
                    placeholder="Lokalnamn"
                    placeholderTextColor="#77838c"
                  />
                </View>
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Noggrannhet (m)</Text>
                  <TextInput
                    value={accuracyMeters}
                    onChangeText={setAccuracyMeters}
                    style={[styles.input, styles.metaInput]}
                    placeholder="Ange meter"
                    placeholderTextColor="#77838c"
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
                <Text style={styles.photoBtnText}>Max 3 bilder nÃ¥dd</Text>
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
            </KeyboardAvoidingView>
        </View>

        <Modal
          transparent
          visible={!!pendingNewSpecies}
          animationType="fade"
          onRequestClose={() => setPendingNewSpecies(null)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.speciesPromptCard}>
              <Text style={styles.speciesPromptTitle}>Ny art</Text>
              <Text style={styles.speciesPromptText}>
                {pendingNewSpecies
                  ? `Arten "${pendingNewSpecies}" finns inte i f\u00f6rslagslistan, vill du l\u00e4gga till den?`
                  : ""}
              </Text>
              <View style={styles.speciesPromptActions}>
                <Pressable
                  style={[styles.speciesPromptBtn, styles.speciesPromptCancel]}
                  onPress={() => {
                    setPendingNewSpecies(null);
                    void doSave(false);
                  }}
                >
                  <Text style={styles.speciesPromptBtnText}>Nej</Text>
                </Pressable>
                <Pressable
                  style={[styles.speciesPromptBtn, styles.speciesPromptOk]}
                  onPress={() => {
                    const next = pendingNewSpecies;
                    setPendingNewSpecies(null);
                    if (next) {
                      setSpecies(next);
                    }
                    void doSave(true);
                  }}
                >
                  <Text style={styles.speciesPromptBtnText}>Ja</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
        <Modal
          transparent
          visible={showDeleteConfirm}
          animationType="fade"
          onRequestClose={() => setShowDeleteConfirm(false)}
        >
          <View style={[styles.modalBackdrop, { justifyContent: "flex-start" }]}>
            <View style={[styles.modalCard, { marginTop: 60, maxHeight: "80%" }]}>
              <Text style={styles.modalTitle}>
                {isPolygon ? "Radera polygon permanent?" : "Radera punkt permanent?"}
              </Text>
              <View style={styles.modalActions}>
                <Pressable
                  onPress={() => setShowDeleteConfirm(false)}
                  style={[styles.modalBtn, styles.cancelBtn, styles.modalBtnShort]}
                >
                  <Text style={styles.modalBtnText}>Avbryt</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handleConfirmedDelete()}
                  style={[styles.modalBtn, styles.deleteConfirmBtn, styles.modalBtnWide]}
                >
                  <Text style={styles.modalBtnText}>Radera</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
    alignItems: "stretch",
    padding: 16,
    paddingBottom: 0,
  },
  safeArea: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdropAndroid: {
    justifyContent: "flex-start",
  },
  safeAreaAndroid: {
    justifyContent: "flex-start",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    flex: 1,
    maxHeight: "85%",
    alignSelf: "stretch",
    overflow: "hidden",
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
    fontSize: 16,
    color: "#172121",
  },
  speciesRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
  },
  speciesInput: {
    flex: 1,
    height: 46,
  },
  redListBadge: {
    minWidth: 44,
    height: 46,
    borderRadius: 8,
    backgroundColor: "#e3e6ea",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  redListBadgeText: {
    fontWeight: "800",
    fontSize: 14,
  },
  infoCard: {
    backgroundColor: "#f5f7f9",
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  infoText: {
    color: "#23313a",
    lineHeight: 18,
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
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    paddingBottom: 180,
  },
  keyboardAvoid: {
    flex: 1,
    minHeight: 0,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#172121",
    flex: 1,    
    textAlign: "center", 
  },
  iconBtn: {
    padding: 4,
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  speciesPromptCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#005f73",
    padding: 14,
    width: "90%",
    maxWidth: 360,
  },
  speciesPromptTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#172121",
    marginBottom: 6,
  },
  speciesPromptText: {
    color: "#23313a",
    marginBottom: 12,
  },
  speciesPromptActions: {
    flexDirection: "row",
    gap: 8,
  },
  speciesPromptBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  speciesPromptCancel: {
    backgroundColor: "#8a939b",
  },
  speciesPromptOk: {
    backgroundColor: "#005f73",
  },
  speciesPromptBtnText: {
    color: "#fff",
    fontWeight: "700",
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
  modalActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  modalBtn: {
    paddingVertical: 11,
    borderRadius: 8,
  },
  modalBtnShort: {
    minWidth: 110,
  },
  modalBtnWide: {
    paddingHorizontal: 18,
  },
  modalBtnText: {
    color: "#fff",
    textAlign: "center",
    fontWeight: "700",
  },
  deleteConfirmBtn: {
    backgroundColor: "#9b2226",
  },
});






