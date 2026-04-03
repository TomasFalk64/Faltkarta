# Fältkarta (Expo / React Native)

Fältkarta är en mobilapp för att dokumentera artobservationer i fält på egna kartor, även utan uppkoppling. Samt att exportera resultatet direkt till aRportalen eller till egna datorn

Funktioner & Fördelar
- **Enkel registrering:** Enkelt inmatningsformulär med klickbara artförslag gör att du aldrig mer behöver skriva hela namnet vågbandad barkborre eller fyrflikig jordstjärna
- **Export till Artportalen:** Appen skapar en TSV, kopierar till urklipp och öppnar Artportalens import-sida.
- **Efterbearbetning med Excel:** Du kan exportera Excel för att redigera poster innan import eller analys.
- **Enkel export:** Exportera via e-post eller dela till exempelvis Google Drive. Du får med observationsdata, karta, GeoJSON och bilder (beroende på exportval).
- **Obegränsade kartlager:** Importera godtyckligt många GeoTIFF-kartor (.tif/.tiff).
- **GPS-optimering:** Ställ in GPS-frekvensen efter behov – välj hög precision för noggrann inmätningskarta eller lägre frekvens för att spara batteri. Välj bakgrundsGPS för att mobilen ska komma ihåg satelliter även när skärmen är släckt.
- **Bildhantering:** Bilder döps automatiskt om efter art och klockslag, vilket gör det enkelt att hitta rätt bild till rätt observation i Artportalen.

## Vad appen gör
- Importerar GeoTIFF-kartor (`.tif/.tiff`) till lokal lagring i appen.
- Visar karta med GPS-prick och stöd för att centrera kartan till din position.
- Låter dig registrera punkt- och polygonobservationer med artnamn, anteckningar och foton.
- Exporterar registrerade observationer via Artportalen (TSV till urklipp) eller som Excel/GeoJSON/ZIP.


## Kartunderlag
- Kartor kan laddas ner från till exempel `Skogsmonitor.se` och importeras i appen som GeoTIFF.
- Appen läser georeferens och koordinatsystem från GeoTIFF-metadata.


## Vilka data som samlas i appen
För varje observation sparas lokalt i appen:
- Artnamn
- Rödlistekategori (om finns i artlistan)
- Typ av observation (`point` eller `polygon`)
- Antal
- Datum/tid (`dateISO`)
- Position i WGS84 (lat/lon) för punkt: exakt punkt
- Position i WGS84 (lat/lon) för polygon: flera hörnpunkter
- Lokalnamn (punktobservation)
- Noggrannhet i meter (punktobservation)
- Beskrivning/anteckning
- Antal och enhet (om arten är knärot sätts enhet automatiskt till plantor/tuvor)
- Foton (filnamn + gallery asset-id för punktobservationer)

Appen lagrar även användarens nya arter i den lokala förslagslistan så att de dyker upp i artförslagen.
Artlistan som används för förslag och rödlistekategori finns i `src/data/species_info.ts`.

## Koordinatsystem
- Intern lagring av observationspositioner: `WGS84` (`EPSG:4326`, lat/lon).
- Kartvisning använder en projekteringspipeline via `Web Mercator` (`EPSG:3857`) för rendering.
- Pipeline: `WGS84 (4326)` -> `EPSG:3857` -> kartans CRS (från GeoTIFF) -> pixel.
- Omvänt vid klick/pan tillbaka till WGS84.
- Kartkrav: GeoTIFF måste innehålla georeferens/CRS i metadata för korrekt GPS-placering.
- Rekommenderade GeoTIFF-CRS: `EPSG:3006` (SWEREF 99 TM) eller `EPSG:3857` (Web Mercator). `EPSG:4326` fungerar också.
- Export till Artportalen använder `SWEREF 99 TM` (`EPSG:3006`) som Ost/Nord.
- Excel-export innehåller både WGS84 (`Lat`,`Lon`) och SWEREF 99 TM (`Nord`,`Ost`).
- För polygoner används en representativ punkt (medelpunkt av polygonens koordinater) i exporten.

## Import
Kartor kan hämtas från webben (t.ex. Skogsmonitor) eller laddas in från tidigare nedladdade filer.
GeoTIFF läses med georeferens från metadata och behöver korrekt CRS för att GPS ska matcha kartan.
Rekommenderade GeoTIFF-CRS: `EPSG:3006`, `EPSG:3857` (även `EPSG:4326` fungerar).
Polygoner importeras från GeoJSON/JSON med `Polygon` eller `MultiPolygon`.
Stödda koordinatsystem för polygonimport: `EPSG:4326` (WGS84), `CRS84` (tolkas som WGS84), `EPSG:3857`, `EPSG:3006` (SWEREF 99 TM).
Namn på polygon: `polygonName` om det finns, annars `id`, annars automatisk numrering (`Område 1`, `Område 2`, ...).
Minimalt GeoJSON-exempel (Polygon):
```json
{ "type": "Feature", "properties": { "polygonName": "Område A" }, "geometry": { "type": "Polygon", "coordinates": [[[17.66,59.86],[17.67,59.86],[17.67,59.87],[17.66,59.86]]] } }
```
Kända begränsningar:
- GeoJSON måste använda `Polygon` eller `MultiPolygon`.
- Koordinater måste vara lon/lat (`EPSG:4326`/`CRS84`), `EPSG:3857` eller `EPSG:3006`.
- GeoJSON-koordinater anges alltid som `[lon, lat]` i WGS84/CRS84.


## Export
- Artportalen: TSV kopieras till urklipp och `https://www.artportalen.se/ImportSighting` öppnas. Endast punktobservationer exporteras till Artportalen.
- Excelfil (XLSX): kan delas via systemets delningsdialog eller skickas via e-post.
- GeoJSON: kan dras in i QGIS för vidare bearbetning.
- Kartan: GeoTIFF-format som kan dras direkt in i QGIS.
- Bilder: komprimeras till storlek som angetts i inställningar (standard 2MB). Mindre bilder komprimeras inte.
- E-postexport: bifogar Excel + en ZIP med Excel, GeoJSON och GeoTIFF.
- Dela via Google Drive eller annan vald kanal.
- ZIP med bilder och GeoJSON: skapar ZIP med karta + Excel + GeoJSON + tillhörande bilder.


## Projektstruktur
- `src/screens/MapListScreen.tsx` - kartlista, import, meny, GPS-frekvens
- `src/screens/MapScreen.tsx` - kartvy, GPS, korshår, observationer, polygon
- `src/screens/ExportScreen.tsx` - export till Artportalen och media som epost eller Google Drive
- `src/components/MapCanvas.tsx` - kartlager, pan/zoom och overlays
- `src/components/ObservationModal.tsx` - formulär för observation
- `src/storage/storage.ts` - lokalt AsyncStorage-lager
- `src/data/species_info.ts` - artlista med rödlistekategori och artinfo (förslag)
- `src/services/coords.ts` - koordinatkonvertering (WGS84 <-> SWEREF99TM, EPSG:3857 <-> WGS84)
- `src/services/export.ts` - exportlogik (TSV/Excel, urklipp, delning, webbläsare)

## Licens
Detta projekt är licensierat under MIT License. Se [LICENSE](LICENSE).
