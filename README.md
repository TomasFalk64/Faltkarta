# Fältkarta (Expo / React Native)

Fältkarta är en mobilapp för att dokumentera artobservationer i fält på egna kartor, även utan uppkoppling.

## Vad appen gör
- Importerar GeoTIFF-kartor (`.tif/.tiff`) till lokal lagring i appen.
- Visar karta med GPS-prick och stöd för att centrera kartan till din position.
- Låter dig registrera punkt- och polygonobservationer med artnamn, anteckningar och foton.
- Exporterar registrerade observationer till Artportalen (TSV) eller till Excel via CSV.

## Kartunderlag
- Kartor kan laddas ner från till exempel `Skogsmonitor.se` och importeras i appen som GeoTIFF.
- Appen försöker läsa georeferens (bbox/koordinatsystem) från GeoTIFF-metadata.
- Om en karta saknar korrekt georeferens blir GPS-placering och koordinatkoppling osäker.

## Vilka data som samlas i appen
För varje observation sparas lokalt i appen:
- Artnamn
- Typ av observation (`point` eller `polygon`)
- Antal
- Datum/tid (`dateISO`)
- Position i WGS84 (lat/lon)
  - Punkt: exakt punkt
  - Polygon: flera hörnpunkter
- Lokalnamn (punktobservation)
- Noggrannhet i meter (punktobservation)
- Beskrivning/anteckning
- Foton (URI till lokala filer)

## Koordinatsystem
- Intern lagring av observationspositioner: `WGS84` (`EPSG:4326`, lat/lon).
- Export till Artportalen använder `SWEREF 99 TM` (`EPSG:3006`) som Ost/Nord.
- CSV-export innehåller både WGS84 och SWEREF 99 TM.
- För polygoner används en representativ punkt (medelpunkt av polygonens koordinater) i exporten.

## Export
- Artportalen:
  - Appen bygger en TSV-sträng och kopierar den till urklipp.
  - Därefter öppnas `https://www.artportalen.se/ importera fynd` , `https://www.artportalen.se/ImportSighting` så data kan klistras in där.
- Excel/CSV:
  - Appen skapar en CSV-fil och öppnar operativsystemets delningsdialog.

## Kör appen lokalt
1. Installera beroenden:
```bash
npm install
```
2. Starta Expo:
```bash
npm start
```
3. Kör på enhet/emulator via Expo Go eller `a` (Android) / `i` (iOS) i terminalen.

## Projektstruktur
- `src/screens/MapListScreen.tsx` - kartlista, import, meny, GPS-frekvens
- `src/screens/MapScreen.tsx` - kartvy, GPS, korshår, observationer, polygon
- `src/screens/ExportScreen.tsx` - export till Artportalen/CSV
- `src/components/MapCanvas.tsx` - kartlager, pan/zoom och overlays
- `src/components/ObservationModal.tsx` - formulär för observation
- `src/storage/storage.ts` - lokalt AsyncStorage-lager
- `src/services/coords.ts` - koordinatkonvertering (WGS84 <-> SWEREF99TM)
- `src/services/export.ts` - exportlogik (TSV/CSV, urklipp, delning, webbläsare)

## Licens
Detta projekt är licensierat under MIT License. Se [LICENSE](LICENSE).
