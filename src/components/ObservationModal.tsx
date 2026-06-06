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
  Keyboard,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";
import * as ImagePicker from "expo-image-picker";
import { speciesInfo } from "../data/species_info";
import { speciesGroups } from "../data/speciesGroups";
import { ARTGRUPP_OPTIONS, DEFAULT_OPTIONS } from "../data/dropdownOptionsGroups";
import {
  addUserSpecies,
  loadUserSpecies,
  loadUserSpeciesGroups,
  removeUserSpecies,
  removeUserSpeciesGroup,
  saveUserSpeciesGroup,
} from "../storage/storage";
import { VisibleFields } from "../types/models";

type ModalPayload = {
  species?: string;
  polygonName?: string;
  notes: string;
  photoUris: string[];
  photoAssetIds?: string[];
  localName?: string;
  quantity?: number;
  unit?: string;
  hostSpecies?: string;
  activity?: string;
  substrate?: string;
  stage?: string;
  gender?: string;
  accuracyMeters?: number | null;
  accuracyMetersWasModified?: boolean;
};

const defaultVisibleFields: VisibleFields = {
  quantity: false,
  unit: false,
  hostSpecies: false,
  activity: false,
  substrate: false,
  stage: false,
  gender: false,
};

const speciesGroupOptions = [
  "Kärlväxter",
  "Mossor",
  "Lavar",
  "Svampar",
  "Alger",
  "Ryggradslösa djur",
  "Däggdjur (exkl.fladdermöss)",
  "Fladdermöss",
  "Grod-&kräldjur",
  "Fiskar",
  "Fåglar",
  "Obestämd",
];

const hostSpeciesEnabledGroups = new Set([
  "Kärlväxter",
  "Mossor",
  "Lavar",
  "Alger",
  "Svampar",
  "Ryggradslösa djur",
  "Obestämd",
]);

type Props = {
  visible: boolean;
  title: string;
  onClose: () => void;
  onSave: (payload: ModalPayload) => Promise<boolean | void> | boolean | void;
  initialValues?: ModalPayload;
  onDelete?: () => Promise<void> | void;
  sessionToken?: number;
  showPointMetaFields?: boolean;
  visibleFields?: VisibleFields;
  speciesPlaceholder?: string;
  kind?: "point" | "polygon";
  initialSpeciesGroup?: string;
  autoFocusSpecies?: boolean;
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
  visibleFields = defaultVisibleFields,
  speciesPlaceholder = "Artnamn",
  kind = "point",
  initialSpeciesGroup = "",
  autoFocusSpecies = false,
}: Props) {
  const [species, setSpecies] = useState("");
  const [notes, setNotes] = useState("");
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const [photoAssetIds, setPhotoAssetIds] = useState<string[]>([]);
  const [localName, setLocalName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [hostSpecies, setHostSpecies] = useState("");
  const [activity, setActivity] = useState("");
  const [substrate, setSubstrate] = useState("");
  const [stage, setStage] = useState("");
  const [gender, setGender] = useState("");
  const [accuracyMeters, setAccuracyMeters] = useState("");
  const [accuracyMetersWasModified, setAccuracyMetersWasModified] = useState(false);
  const wasVisibleRef = useRef(false);
  const lastSessionTokenRef = useRef<number | undefined>(undefined);
  const [isShowingSuggestions, setIsShowingSuggestions] = useState(false);
  const [activeSuggestionsField, setActiveSuggestionsField] = useState<string | null>(null);
  const [userSpecies, setUserSpecies] = useState<string[]>([]);
  const [ownSpeciesGroups, setOwnSpeciesGroups] = useState<Record<string, string>>({});
  const [currentSelectedGroup, setCurrentSelectedGroup] = useState<string>("Obestämd");
  const scrollViewRef = useRef<ScrollView | null>(null);
  const speciesInputRef = useRef<TextInput | null>(null);
  const [fieldLayouts, setFieldLayouts] = useState<Record<string, number>>({});
  const isSubmittingRef = useRef(false);
  const [pendingSpeciesGroupSpecies, setPendingSpeciesGroupSpecies] = useState<string | null>(null);
  const [pendingSpeciesGroupValue, setPendingSpeciesGroupValue] = useState("Obestämd");
  const [pendingSpeciesKnownGroup, setPendingSpeciesKnownGroup] = useState<string | null>(null);
  const [showSpeciesGroupOptions, setShowSpeciesGroupOptions] = useState(false);
  const [declinedSpeciesGroupPromptFor, setDeclinedSpeciesGroupPromptFor] = useState<string | null>(null);
  const isPolygon = kind === "polygon";
  const [showSpeciesInfo, setShowSpeciesInfo] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  type DropdownField = keyof typeof DEFAULT_OPTIONS;

  function closeSuggestionPopovers() {
    setIsShowingSuggestions(false);
    setActiveSuggestionsField(null);
  }

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
        setHostSpecies(initialValues?.hostSpecies ?? "");
        setActivity(initialValues?.activity ?? "");
        setSubstrate(initialValues?.substrate ?? "");
        setStage(initialValues?.stage ?? "");
        setGender(initialValues?.gender ?? "");
        setAccuracyMeters(
          initialValues?.accuracyMeters === null || initialValues?.accuracyMeters === undefined
            ? ""
            : String(initialValues.accuracyMeters)
        );
        setAccuracyMetersWasModified(false);
        setShowSpeciesInfo(false);
        setCurrentSelectedGroup(initialSpeciesGroup || "Obestämd");
        setPendingSpeciesGroupSpecies(null);
        setPendingSpeciesGroupValue("Obestämd");
        setPendingSpeciesKnownGroup(null);
        setShowSpeciesGroupOptions(false);
        setDeclinedSpeciesGroupPromptFor(null);
        closeSuggestionPopovers();
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
      setHostSpecies(initialValues?.hostSpecies ?? "");
      setActivity(initialValues?.activity ?? "");
      setSubstrate(initialValues?.substrate ?? "");
      setStage(initialValues?.stage ?? "");
      setGender(initialValues?.gender ?? "");
      setAccuracyMeters(
        initialValues?.accuracyMeters === null || initialValues?.accuracyMeters === undefined
          ? ""
          : String(initialValues.accuracyMeters)
        );
      setAccuracyMetersWasModified(false);
      setShowSpeciesInfo(false);
      setCurrentSelectedGroup(initialSpeciesGroup || "Obestämd");
      setPendingSpeciesGroupSpecies(null);
      setPendingSpeciesGroupValue("Obestämd");
      setPendingSpeciesKnownGroup(null);
      setShowSpeciesGroupOptions(false);
      setDeclinedSpeciesGroupPromptFor(null);
      closeSuggestionPopovers();
    }
    wasVisibleRef.current = visible;
  }, [initialValues, initialSpeciesGroup, isPolygon, sessionToken, visible]);

  useEffect(() => {
    if (!visible) return;
    Promise.all([loadUserSpecies(), loadUserSpeciesGroups()])
      .then(([list, groups]) => {
        setUserSpecies(list);
        setOwnSpeciesGroups(groups);
      })
      .catch(() => {
        setUserSpecies([]);
        setOwnSpeciesGroups({});
      });
  }, [visible, sessionToken]);

  useEffect(() => {
    if (!visible || !autoFocusSpecies) return;
    const timer = setTimeout(() => {
      speciesInputRef.current?.focus();
    }, 150);
    return () => clearTimeout(timer);
  }, [autoFocusSpecies, visible, sessionToken]);

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

  const speciesGroupsByLower = useMemo(() => {
    const map = new Map<string, string>();
    Object.entries(speciesGroups).forEach(([name, group]) => {
      const normalized = String(group ?? "").trim();
      if (normalized) {
        map.set(name.toLowerCase(), normalized);
      }
    });
    Object.entries(ownSpeciesGroups).forEach(([name, group]) => {
      const normalized = String(group ?? "").trim();
      if (normalized) {
        map.set(name.toLowerCase(), normalized);
      }
    });
    return map;
  }, [ownSpeciesGroups]);

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

  function rememberFieldLayout(fieldName: string, y: number) {
    setFieldLayouts((prev) => (prev[fieldName] === y ? prev : { ...prev, [fieldName]: y }));
  }

  const scrollToField = (fieldName: string) => {
    const scrollView = scrollViewRef.current;
    const y = fieldLayouts[fieldName];
    if (!scrollView || y === undefined) return;
    const extraOffset =
      fieldName === "unit" || fieldName === "stage" || fieldName === "gender" ? 140 : 10;
    scrollView.scrollTo({ y: Math.max(0, y - extraOffset), animated: true });
  };

  const activeGroupOptions =
    currentSelectedGroup && ARTGRUPP_OPTIONS[currentSelectedGroup]
      ? ARTGRUPP_OPTIONS[currentSelectedGroup]
      : DEFAULT_OPTIONS;
  const isHostSpeciesEnabled = hostSpeciesEnabledGroups.has(currentSelectedGroup);

  const getFieldOptions = (field: DropdownField) => activeGroupOptions[field] ?? [];
  const hasFieldOptions = (field: DropdownField) => getFieldOptions(field).length > 0;

  function renderDropdownField(
    field: DropdownField,
    value: string,
    setValue: (v: string) => void,
    label: string
  ) {
    if (!visibleFields[field]) return null;

    const options = getFieldOptions(field);
    const disabled = options.length === 0;
    const isActive = activeSuggestionsField === field;
    const fieldStyle =
      field === "unit" || field === "stage" || field === "gender"
        ? [styles.input, styles.dropdownSelect, styles.dropdownMetaSelect, disabled ? styles.disabledDropdownInput : null]
        : [styles.input, styles.dropdownSelect, disabled ? styles.disabledDropdownInput : null];

    const body = (
      <>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Pressable
          onPress={() => {
            if (disabled) return;
            const opening = activeSuggestionsField !== field;
            setActiveSuggestionsField(opening ? field : null);
            if (opening) {
              setTimeout(() => {
                scrollToField(field);
              }, 50);
            }
          }}
          style={fieldStyle}
        >
          <Text style={{ color: disabled ? "#7a7a7a" : "#172121", fontSize: 16 }}>
            {value.trim()}
          </Text>
        </Pressable>
        {isActive && !disabled && options.length > 0 && (
          <ScrollView
            style={styles.suggestions}
            nestedScrollEnabled={true}
            keyboardShouldPersistTaps="handled"
          >
            <Pressable
              onPress={() => {
                setValue("");
                setActiveSuggestionsField(null);
              }}
              style={styles.suggestionItem}
            >
              <Text style={styles.clearSuggestionText}>Rensa</Text>
            </Pressable>
            {options.map((item) => (
              <Pressable
                key={item}
                onPress={() => {
                  setValue(item);
                  setActiveSuggestionsField(null);
                }}
                style={styles.suggestionItem}
              >
                <Text>{item}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </>
    );

    if (field === "unit") {
      return (
        <View style={[styles.formColumn, visibleFields.quantity ? styles.wideColumn : null]}>
          {body}
        </View>
      );
    }

    if (field === "stage") {
      return (
        <View style={[styles.formColumn, visibleFields.gender ? styles.wideColumn : null]}>
          {body}
        </View>
      );
    }

    if (field === "gender") {
      return (
        <View style={[styles.formColumn, visibleFields.stage ? styles.narrowColumn : null]}>
          {body}
        </View>
      );
    }

    return body;
  }

  async function addPhoto() {
    const remaining = Math.max(0, 3 - photoUris.length);
    if (remaining <= 0) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      allowsEditing: false,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
    });
    if (!result.canceled && result.assets.length > 0) {
      const selected = result.assets.filter((asset) => !!asset?.uri).slice(0, remaining);
      if (selected.length === 0) return;
      setPhotoUris((prev) => [...prev, ...selected.map((asset) => asset.uri)]);
      setPhotoAssetIds((prev) => [...prev, ...selected.map((asset) => String(asset.assetId ?? ""))]);
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
    setQuantity("");
    setUnit("");
    setHostSpecies("");
    setActivity("");
    setSubstrate("");
    setStage("");
    setGender("");
    setAccuracyMeters("");
    setAccuracyMetersWasModified(false);
    setShowSpeciesInfo(false);
    setShowDeleteConfirm(false);
    setCurrentSelectedGroup("Obestämd");
    setPendingSpeciesGroupSpecies(null);
    setPendingSpeciesGroupValue("Obestämd");
    setPendingSpeciesKnownGroup(null);
    setShowSpeciesGroupOptions(false);
    setDeclinedSpeciesGroupPromptFor(null);
    closeSuggestionPopovers();
    onClose();
  }

  function isUserSpeciesOnly(): boolean {
    if (!species.trim()) return false;
    const trimmed = species.trim();
    const inUserSpecies = userSpecies.some(
      (s) => s.toLowerCase() === trimmed.toLowerCase()
    );
    const inStandardSpecies = speciesInfo[trimmed] !== undefined;
    return inUserSpecies && !inStandardSpecies;
  }

  async function removeFromUserSpecies() {
    const trimmed = species.trim();
    const [updatedSpecies, updatedGroups] = await Promise.all([
      removeUserSpecies(trimmed),
      removeUserSpeciesGroup(trimmed),
    ]);
    setUserSpecies(updatedSpecies);
    setOwnSpeciesGroups(updatedGroups);
    setCurrentSelectedGroup("Obestämd");
    setDeclinedSpeciesGroupPromptFor(null);
    clearSpeciesGroupPrompt();
    setSpecies("");
  }

  function findKnownSpeciesName(value: string): string | null {
    const lower = value.trim().toLowerCase();
    if (!lower) return null;
    const standard = Object.keys(speciesInfo).find((name) => name.toLowerCase() === lower);
    if (standard) return standard;
    return userSpecies.find((name) => name.toLowerCase() === lower) ?? null;
  }

  function findSpeciesGroup(value: string): string | null {
    const group = speciesGroupsByLower.get(value.trim().toLowerCase());
    return group?.trim() || null;
  }

  function clearSpeciesGroupPrompt() {
    setPendingSpeciesGroupSpecies(null);
    setPendingSpeciesGroupValue("Obestämd");
    setPendingSpeciesKnownGroup(null);
    setShowSpeciesGroupOptions(false);
  }

  function resetSpeciesPromptDecision() {
    setDeclinedSpeciesGroupPromptFor(null);
    setCurrentSelectedGroup("Obestämd");
    clearSpeciesGroupPrompt();
  }

  function resetExtraInfoFields() {
    setQuantity("");
    setUnit("");
    setHostSpecies("");
    setActivity("");
    setSubstrate("");
    setStage("");
    setGender("");
  }

  function validateSpeciesGroup(): boolean {
    if (isPolygon) return true;
    const trimmed = species.trim();
    if (!trimmed) {
      setCurrentSelectedGroup("Obestämd");
      return true;
    }

    const group = findSpeciesGroup(trimmed);
    const knownName = findKnownSpeciesName(trimmed);
    if (group && knownName) {
      setCurrentSelectedGroup(group);
      clearSpeciesGroupPrompt();
      return true;
    }

    if (declinedSpeciesGroupPromptFor === trimmed.toLowerCase()) {
      clearSpeciesGroupPrompt();
      return true;
    }

    setCurrentSelectedGroup("");
    setPendingSpeciesGroupSpecies(knownName ?? trimmed);
    setPendingSpeciesKnownGroup(group);
    setPendingSpeciesGroupValue("Obestämd");
    Keyboard.dismiss();
    scrollToField("species");
    return false;
  }

  async function confirmSpeciesGroup() {
    const name = pendingSpeciesGroupSpecies?.trim();
    const group = pendingSpeciesKnownGroup ?? (pendingSpeciesGroupValue.trim() || "Obestämd");
    if (!name) return;
    if (!pendingSpeciesKnownGroup) {
      const nextGroups = await saveUserSpeciesGroup(name, group);
      setOwnSpeciesGroups(nextGroups);
    }
    setCurrentSelectedGroup(group);
    setDeclinedSpeciesGroupPromptFor(null);
    if (!findKnownSpeciesName(name)) {
      const nextSpecies = await addUserSpecies(name);
      setUserSpecies(nextSpecies);
    }
    setSpecies(name);
    resetExtraInfoFields();
    clearSpeciesGroupPrompt();
  }

  function declineSpeciesGroup() {
    const name = pendingSpeciesGroupSpecies?.trim() || species.trim();
    setDeclinedSpeciesGroupPromptFor(name.toLowerCase());
    setCurrentSelectedGroup(pendingSpeciesKnownGroup ?? "Obestämd");
    clearSpeciesGroupPrompt();
  }

  function confirmDelete() {
    closeSuggestionPopovers();
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
    closeSuggestionPopovers();
    if (!species || species.trim().length === 0) {
      // Alert.alert("Fel", "Du måste ange ett artnamn.");
      return;
    }
    if (!validateSpeciesGroup()) {
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
      const quantityAsNumber = rawVal === "" ? 0 : Number(rawVal);
      const trimmedSpecies = species.trim();
      if (!isPolygon && addToSuggestions) {
        const next = await addUserSpecies(trimmedSpecies);
        setUserSpecies(next);
      }
      const fallbackToEmptyString = (val: string) => val ? val.trim() : "";
      const shouldClose = await onSave({
        species: isPolygon ? "" : trimmedSpecies,
        polygonName: isPolygon ? trimmedSpecies : "",
        notes: fallbackToEmptyString(notes),
        photoUris,
        photoAssetIds,
        localName: fallbackToEmptyString(localName),
        quantity: quantityAsNumber, // Hanteras separat som nummer/null
        unit: fallbackToEmptyString(unit),
        hostSpecies: fallbackToEmptyString(hostSpecies),
        activity: fallbackToEmptyString(activity),
        substrate: fallbackToEmptyString(fallbackToEmptyString(substrate)),
        stage: fallbackToEmptyString(stage),
        gender: fallbackToEmptyString(gender),
        accuracyMeters:
          Number.isFinite(parsedAccuracy) && parsedAccuracy >= 0 ? Math.round(parsedAccuracy) : null,
        accuracyMetersWasModified,
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
                ref={scrollViewRef}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
              >
            <View
              onLayout={(event) => rememberFieldLayout("species", event.nativeEvent.layout.y)}
              style={styles.speciesRow}
            >
              <TextInput
                ref={speciesInputRef}
                value={species}
                autoCorrect={false}
                spellCheck={false}
                onChangeText={(text) => {
                  setSpecies(text);
                  resetSpeciesPromptDecision();
                  setIsShowingSuggestions(true);
                  setActiveSuggestionsField(null);
                  if (showSpeciesInfo) {
                    setShowSpeciesInfo(false);
                  }
                }}
                onFocus={() => {
                  setIsShowingSuggestions(true);
                  setShowSpeciesInfo(false);
                }}
                onBlur={() => {
                  setTimeout(() => setIsShowingSuggestions(false), 120);
                  validateSpeciesGroup();
                }}
                onSubmitEditing={() => validateSpeciesGroup()}
                placeholder={speciesPlaceholder}
                placeholderTextColor="#626568"
                style={[styles.input, styles.speciesInput]}
              />
              {isUserSpeciesOnly() && (
                <Pressable
                  style={styles.removeSpeciesBtn}
                  onPress={() => void removeFromUserSpecies()}
                >
                  <Svg width={28} height={28} viewBox="0 0 24 24">
                    <Circle
                      cx={12}
                      cy={12}
                      r={8}
                      stroke="#c1121f"
                      strokeWidth={2.2}
                      fill="none"
                    />
                    <Path
                      d="M8 12h8"
                      stroke="#c1121f"
                      strokeWidth={2.6}
                      strokeLinecap="round"
                      fill="none"
                    />
                  </Svg>
                </Pressable>
              )}
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
                      resetExtraInfoFields();
                      setShowSpeciesInfo(false);
                      setIsShowingSuggestions(false);
                      setDeclinedSpeciesGroupPromptFor(null);
                      const group = findSpeciesGroup(item);
                      
                      // console.log("Aktuell artgrupp:", group);
                      
                      setCurrentSelectedGroup(group ?? "Obestämd");
                      if (group) {
                        clearSpeciesGroupPrompt();
                      }
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
              placeholderTextColor="#626568"
              multiline
            />
            <View style={styles.dividerContainer}>
              <View style={styles.line} />
              <Text style={styles.dividerText}>Extra info nedan</Text>
              <View style={styles.line} />
            </View>
            {!isPolygon && (
              <>
                {(visibleFields.quantity || visibleFields.unit) && (
                  <View
                    style={styles.metaRow}
                    onLayout={(e) => {
                      const y = e.nativeEvent.layout.y;
                      if (visibleFields.quantity) {
                        rememberFieldLayout("quantity", y);
                      }
                      rememberFieldLayout("unit", y);
                    }}
                  >
                      {visibleFields.quantity && (
                        <View style={[styles.formColumn, visibleFields.unit ? styles.narrowColumn : null]}>
                          <Text style={styles.fieldLabel}>Antal</Text>
                          <TextInput
                            value={quantity}
                            onChangeText={setQuantity}
                            style={[styles.input, styles.dropdownSelect, styles.dropdownMetaSelect]}
                            placeholder=""
                            keyboardType="numeric"
                          />
                        </View>
                      )}
                      {renderDropdownField("unit", unit, setUnit, "Enhet")}
                  </View>
                )}
                {visibleFields.hostSpecies && (
                  <>
                    <Text style={styles.fieldLabel}>Art som substrat</Text>
                    <TextInput
                      value={hostSpecies}
                      onChangeText={setHostSpecies}
                      editable={isHostSpeciesEnabled}
                      style={[
                        styles.input,
                        !isHostSpeciesEnabled ? styles.disabledDropdownInput : null,
                      ]}
                      placeholder=""
                      placeholderTextColor="#626568"
                    />
                  </>
                )}
                {renderDropdownField("activity", activity, setActivity, "Aktivitet")}
                {renderDropdownField("substrate", substrate, setSubstrate, "Substrat")}
                {(visibleFields.stage || visibleFields.gender) && (
                  <View
                    style={styles.metaRow}
                    onLayout={(e) => {
                      const y = e.nativeEvent.layout.y;
                      rememberFieldLayout("stage", y);
                      rememberFieldLayout("gender", y);
                    }}
                  >
                    {renderDropdownField("stage", stage, setStage, "Ålder-Stadium")}
                    {renderDropdownField("gender", gender, setGender, "Kön")}
                  </View>
                )}
              </>
            )}
            {showPointMetaFields && (
              <View style={styles.metaRow}>
                <View style={[styles.formColumn, styles.wideColumn]}>
                  <Text style={styles.fieldLabel}>Lokalnamn</Text>
                  <TextInput
                    value={localName}
                    onChangeText={setLocalName}
                    style={[styles.input, styles.metaInput]}
                    placeholder="Lokalnamn"
                    placeholderTextColor="#626568"
                  />
                </View>
                <View style={[styles.formColumn, styles.narrowColumn]}>
                  <Text style={styles.fieldLabel}>Noggrannhet</Text>
                  <TextInput
                    value={accuracyMeters}
                    onChangeText={(value) => {
                      setAccuracyMeters(value);
                      setAccuracyMetersWasModified(true);
                    }}
                    style={[styles.input, styles.metaInput]}
                    placeholder="Ange meter"
                    placeholderTextColor="#626568"
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
            )}
            {photoUris.length < 3 ? (
              <Pressable style={styles.photoBtn} onPress={addPhoto}>
                <Text style={styles.photoBtnText}>Lägg till foto ({photoUris.length}/3)</Text>
              </Pressable>
            ) : (
              <View style={[styles.photoBtn, { backgroundColor: '#ccc' }]}>
                <Text style={styles.photoBtnText}>Max 3 bilder (3/3)</Text>
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
            {!isPolygon && pendingSpeciesGroupSpecies ? (
              <View style={styles.speciesPromptOverlay} pointerEvents="auto">
                <View style={styles.speciesPromptCard}>
                  <Text style={styles.speciesPromptTitle}>
                    Vill du lägga till {pendingSpeciesGroupSpecies} som en ny art?
                  </Text>
                  {pendingSpeciesKnownGroup ? (
                    <Text style={styles.speciesPromptText}>Artgrupp: {pendingSpeciesKnownGroup}</Text>
                  ) : (
                    <>
                      <Pressable
                        style={styles.speciesGroupSelect}
                        onPress={() => setShowSpeciesGroupOptions((value) => !value)}
                      >
                        <Text style={styles.speciesGroupSelectText}>{pendingSpeciesGroupValue}</Text>
                        <Text style={styles.speciesGroupSelectChevron}>{showSpeciesGroupOptions ? "▲" : "▼"}</Text>
                      </Pressable>
                      {showSpeciesGroupOptions ? (
                        <ScrollView
                          style={styles.speciesGroupOptions}
                          nestedScrollEnabled
                          keyboardShouldPersistTaps="handled"
                        >
                          {speciesGroupOptions.map((group) => (
                            <Pressable
                              key={group}
                              style={[
                                styles.speciesGroupOption,
                                pendingSpeciesGroupValue === group ? styles.speciesGroupOptionSelected : undefined,
                              ]}
                              onPress={() => {
                                setPendingSpeciesGroupValue(group);
                                setShowSpeciesGroupOptions(false);
                              }}
                            >
                              <Text
                                style={[
                                  styles.speciesGroupOptionText,
                                  pendingSpeciesGroupValue === group ? styles.speciesGroupOptionTextSelected : undefined,
                                ]}
                              >
                                {group}
                              </Text>
                            </Pressable>
                          ))}
                        </ScrollView>
                      ) : null}
                    </>
                  )}
                  <View style={styles.speciesPromptActions}>
                    <Pressable
                      style={[styles.speciesPromptBtn, styles.speciesPromptCancel]}
                      onPress={declineSpeciesGroup}
                    >
                      <Text style={styles.speciesPromptBtnText}>Nej/Avbryt</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.speciesPromptBtn, styles.speciesPromptOk]}
                      onPress={() => void confirmSpeciesGroup()}
                    >
                      <Text style={styles.speciesPromptBtnText}>Ja/Spara</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ) : null}
        </View>

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
    position: "relative",
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
  removeSpeciesBtn: {
    width: 28,
    height: 46,
    borderRadius: 8,
    backgroundColor: "transparent",
    justifyContent: "center",
    alignItems: "center",
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
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 8,
  },
  formColumn: {
    flex: 1,
    minWidth: 0,
  },
  narrowColumn: {
    flex: 1,
  },
  wideColumn: {
    flex: 1.35,
  },
  metaInput: {
    flex: 1,
    marginBottom: 0,
  },
  dropdownSelect: {
    minHeight: 46,
    justifyContent: "center",
  },
  dropdownMetaSelect: {
    marginBottom: 0,
  },
  disabledDropdownInput: {
    backgroundColor: "#e0e0e0",
    color: "#7a7a7a",
    opacity: 0.85,
  },
  suggestions: {
    borderWidth: 1,
    borderColor: "#d8d8d8",
    borderRadius: 8,
    marginBottom: 8,
    maxHeight: 135,
  },
  suggestionItem: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ececec",
  },
  clearSuggestionText: {
    fontStyle: "italic",
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
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475157',
    marginBottom: 4,
    textAlign: 'left',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  speciesPromptOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
    elevation: 999,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 18,
  },
  speciesPromptCard: {
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#005f73",
    padding: 16,
    width: "100%",
    maxWidth: 430,
  },
  speciesPromptTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#172121",
    marginBottom: 10,
  },
  speciesPromptText: {
    color: "#23313a",
    marginBottom: 12,
  },
  speciesPromptActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
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
  speciesGroupSelect: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#b8c2c7",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#f8fafb",
  },
  speciesGroupSelectText: {
    flex: 1,
    color: "#172121",
    fontWeight: "700",
  },
  speciesGroupSelectChevron: {
    color: "#475157",
    fontSize: 12,
    marginLeft: 8,
  },
  speciesGroupOptions: {
    borderWidth: 1,
    borderColor: "#d3dde2",
    borderRadius: 8,
    marginTop: 6,
    overflow: "hidden",
    maxHeight: 280,
  },
  speciesGroupOption: {
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e4eaee",
    backgroundColor: "#fff",
  },
  speciesGroupOptionSelected: {
    backgroundColor: "#e5f3f5",
  },
  speciesGroupOptionText: {
    color: "#172121",
  },
  speciesGroupOptionTextSelected: {
    fontWeight: "800",
    color: "#005f73",
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






