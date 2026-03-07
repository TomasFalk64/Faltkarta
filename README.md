# Fältkarta (Expo / React Native)

Fältkarta är en mobilapp för att dokumentera artobservationer i fält på egna kartor, även utan uppkoppling.

## Vad appen gör
- Importerar GeoTIFF-kartor (`.tif/.tiff`) till lokal lagring i appen.
- Visar karta med GPS-prick och stöd för att centrera kartan till din position.
- Låter dig registrera punkt- och polygonobservationer med artnamn, anteckningar och foton.
- Exporterar registrerade observationer till Artportalen (TSV) eller till Excel via CSV.

## Kartunderlag
- Kartor kan laddas ner från till exempel `Skogsmonitor.se` och importeras i appen som GeoTIFF.
- Appen läser georeferens och koordinatsystem från GeoTIFF-metadata.
- Rendering bygger på pixeltransform (GeoTIFF geotransform), inte enbart bbox-approximation.
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
- Foton (filnamn + gallery asset-id för punktobservationer)

## Koordinatsystem
- Intern lagring av observationspositioner: `WGS84` (`EPSG:4326`, lat/lon).
- Kartvisning använder en projekteringspipeline via `SWEREF 99 TM` (`EPSG:3006`) för rendering:
  - `WGS84 (4326)` -> `SWEREF99TM (3006)` -> kartans CRS (från GeoTIFF) -> pixel.
  - Omvänt vid klick/pan tillbaka till WGS84.
- Export till Artportalen använder `SWEREF 99 TM` (`EPSG:3006`) som Ost/Nord.
- CSV-export innehåller både WGS84 (`Lat`,`Lon`) och SWEREF 99 TM (`NordY`,`OstX`).
- För polygoner används en representativ punkt (medelpunkt av polygonens koordinater) i exporten.

## Export
- Artportalen:
  - Appen bygger en TSV-sträng och kopierar den till urklipp.
  - Därefter öppnas `https://www.artportalen.se/ImportSighting`.
- Excelfil (CSV):
  - Exporteras som semikolonseparerad CSV med `UTF-8 BOM` och `sep=;` för bättre Excel-kompatibilitet.
  - Kan delas via systemets delningsdialog eller skickas via e-post.
- E-postexport:
  - Bifogar både separat CSV-fil och en ZIP-bilaga.
  - ZIP-bilagan innehåller CSV + GeoJSON + GeoTIFF-kartan.
- ZIP med bilder och GeoJSON:
  - Separat exportfunktion som skapar ZIP med CSV + GeoJSON + tillhörande bilder.

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
