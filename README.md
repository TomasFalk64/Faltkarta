# Fältkarta (Expo / React Native)

MVP-app för offline fältkarta:
- Import av GeoTIFF (`.tif/.tiff`) till lokal lagring
- Kartvisning via kopplad lokal bakgrundsbild (PNG/JPG) i appen
- GPS-prick, korshår, centrera, följ mig
- Punkt- och polygonobservationer med artförslag och foto
- Export till Artportalen (TSV i urklipp) och CSV för Excel via Share Sheet

## MVP-anteckning om GeoTIFF-rendering
Expo-renderar inte GeoTIFF direkt i denna MVP. Flödet är:
1. Importera GeoTIFF (lagras lokalt)
2. Koppla en separat PNG/JPG som visningsbild för kartan

Det ger en stabil och körbar grund i Expo.

## RUN
1. Installera beroenden:
```bash
npm install
```
2. Starta Expo:
```bash
npm start
```
3. Kör på enhet/emulator via Expo Go eller `a` (Android) / `i` (iOS) i terminalen.

## Struktur
- `src/screens/MapListScreen.tsx` - kartlista, import, meny, GPS-frekvens
- `src/screens/MapScreen.tsx` - kartvy, GPS, korshår, observationer, polygon
- `src/screens/ExportScreen.tsx` - TSV/CSV-export
- `src/components/MapCanvas.tsx` - pan/zoom/rotate + overlays
- `src/components/ObservationModal.tsx` - formulär för observation
- `src/storage/storage.ts` - AsyncStorage-lager
- `src/services/coords.ts` - proj4 SWEREF 99 TM
- `src/services/export.ts` - TSV/CSV + clipboard/share/browser
