# Fältkarta (Expo / React Native)

Fältkarta är en mobilapp för att dokumentera artobservationer i fält på egna kartor, även utan uppkoppling.

Funktioner & Fördelar
- **Enkel registrering:** Enkelt inmatningsformulär med klickbara artförslag gör att du aldrig mer behöver skriva vågbandad barkborre eller fyrflikig jordstjärna
- **Direkt export till Artportalen:** Exportera data direkt till Artportalen  eller QGIS (observationer.GeoJSON och karta.tiff). 
- **Efterbearbetning med excel:**Du kan även gå via Excel för att redigera poster innan kopiering.
- **Enkel export:** Exportera via epost eller dela till exempelvis Google Drive. du får med observationsdata, karta , GeoJson och mapp med dina bilder
- **Obegränsade kartlager:** Importera godtyckligt många GeoTIFF-kartor (.tif/.tiff).
- **GPS-optimering:** Ställ in GPS-frekvensen efter behov – välj hög precision för noggrann inmätningskarta eller lägre frekvens för att spara batteri.
- **Smart bildhantering:** Bilder döps automatiskt om efter art och klockslag, vilket gör det enkelt att hitta rätt bild till rätt observation i Artportalen.
- **Skyddszon:** Valbar 50m-markering (cirkel) för Knärot för att underlätta inventering.

## Vad appen gör
- Importerar GeoTIFF-kartor (`.tif/.tiff`) till lokal lagring i appen.
- Visar karta med GPS-prick och stöd för att centrera kartan till din position.
- Låter dig registrera punkt- och polygonobservationer med artnamn, anteckningar och foton.
- Exporterar registrerade observationer till direkt Artportalen eller via vald kanal som excel och geojson

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
- Antal och enhet ( om arten är knärot sätts enhet automatiskt till plator/tuvor)
- Foton (filnamn + gallery asset-id för punktobservationer)

## Koordinatsystem
- Intern lagring av observationspositioner: `WGS84` (`EPSG:4326`, lat/lon).
- Kartvisning använder en projekteringspipeline via `SWEREF 99 TM` (`EPSG:3006`) för rendering:
  - `WGS84 (4326)` -> `SWEREF99TM (3006)` -> kartans CRS (från GeoTIFF) -> pixel.
  - Omvänt vid klick/pan tillbaka till WGS84.
- Export till Artportalen använder `SWEREF 99 TM` (`EPSG:3006`) som Ost/Nord.
- Excel-export innehåller både WGS84 (`Lat`,`Lon`) och SWEREF 99 TM (`Nord`,`Ost`).
- För polygoner används en representativ punkt (medelpunkt av polygonens koordinater) i exporten.

## Export
- Artportalen:
  - Appen bygger en tabbseparerad TSV-sträng och kopierar den till urklipp.
  - Därefter öppnas `https://www.artportalen.se/ImportSighting`.
- Excelfil:
  - Kan delas via systemets delningsdialog eller skickas via e-post.
- Geojson:
  - Kan direkt dras in i Qgis för vidare bearbetning
- Kartan
  - Geotiff-format som kan dras direkt in i Qgis
- Bilder
  - Komprimeras till den storlek som angetts i inställningar, standardvärde 2MB, om bilden är mindre än så komprimeas den inte
- E-postexport:
  - Bifogar både separat excel-fil och en ZIP-bilaga.
  - ZIP-bilagan innehåller CSV + GeoJSON + GeoTIFF-kartan.
- Dela via Google Drie eller annat vald kanal
- ZIP med bilder och GeoJSON:
  - Separat exportfunktion som skapar ZIP med karta + excel + GeoJSON + tillhörande bilder.


## Kör appen lokalt
1. Installera beroenden:
``` bash 
npm install```

2. Starta Expo:
```bash
npm start
```
3. Kör på enhet/emulator via Expo Go eller `a` (Android) / `i` (iOS) i terminalen. 
```bash
eas login
eas build -p android --profile preview
```

## Projektstruktur
- `src/screens/MapListScreen.tsx` - kartlista, import, meny, GPS-frekvens
- `src/screens/MapScreen.tsx` - kartvy, GPS, korshår, observationer, polygon
- `src/screens/ExportScreen.tsx` - export till Artportalen och media som epost eller Google Drive
- `src/components/MapCanvas.tsx` - kartlager, pan/zoom och overlays
- `src/components/ObservationModal.tsx` - formulär för observation
- `src/storage/storage.ts` - lokalt AsyncStorage-lager
- `src/services/coords.ts` - koordinatkonvertering (WGS84 <-> SWEREF99TM)
- `src/services/export.ts` - exportlogik (TSV/excel, urklipp, delning, webbläsare)

## Licens
Detta projekt är licensierat under MIT License. Se [LICENSE](LICENSE).
