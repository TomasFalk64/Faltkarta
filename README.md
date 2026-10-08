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

## Uppgradering till Expo SDK 57

Arbetet görs på `upgrade-expo-sdk57`, från SDK 54 via 55 och 56 till 57.
SDK 56 är bara ett migrationssteg: dess kända Hermes-minnesfel gör att den
versionen inte ska distribueras. Ingen app har publicerats i samband med arbetet.

### Ändringar

- `package.json` och `package-lock.json`: Expo och tillhörande native-bibliotek
  anpassas med `expo install --fix` för varje SDK. Slutmål är Expo 57.0.27,
  React Native 0.86.3, React 19.2.3 och TypeScript 6.0.3. Låsfilen anger alla
  exakta paketversioner.
- React Navigation och native-stack uppgraderas från 6 till 7 för stöd med
  react-native-screens 4. Appens tre skärmar, parametrar och navigationsstruktur
  behålls. Temat ärver redan hela `DefaultTheme`, inklusive de nya typsnitten.
- `babel.config.js`: den manuella Reanimated-pluginen tas bort;
  `babel-preset-expo` konfigurerar den för SDK:ns Worklets-version.
- `app.json`: pluginer för e-post och delning läggs till efter Expos
  installationskontroll. Mottagning av delat innehåll aktiveras inte.
  Det gamla `splash`-fältet ersätts av `expo-splash-screen` med befintlig bild,
  vit bakgrund, `contain` och kompatibilitetsläget för helskärmsbild på iOS.
  Kontrollera startbildens faktiska storlek i ett releasebygge.
- `withAndroidAllowBackupFix.js` och `withAndroidStorageLimit.js` importerar
  konfigurations-API:t från `expo/config-plugins`.
- `src/services/files.ts` och `src/services/storageHealth.ts` importerar
  `requireOptionalNativeModule` från `expo`, enligt Expo Doctor.
- GeoTIFF-modulens podspec får lägsta iOS-version 16.4. Swift-koden och dess
  språkversion 5.9 behålls; kompilering mot den nya native-verktygskedjan återstår.
- `tsconfig.json`: äldre `baseUrl` och `ignoreDeprecations` tas bort;
  aliaset använder en explicit relativ sökväg, `./src/*`.
- `BiotopePicker.tsx` och `ObservationModal.tsx`: tre borttagna
  `StyleSheet.absoluteFillObject` ersätts med `StyleSheet.absoluteFill`.
- `metro.config.js`: Papa Parse styrs till paketets vanliga källfil eftersom
  SDK 57:s transformering av `papaparse.min.js` gav stackoverflow. Endast dess
  oanvända Node-beroende `stream` ersätts med Metros tomma modul. Appen använder
  `unparse`, inte Node-streaming. Releasepaketet minifieras fortfarande av Metro.
- `scripts/test-csv-runtime.cjs`: verifierar att källfilen ger exakt samma CSV
  som den tidigare browser-filen för svenska tecken, citattecken, semikolon,
  radbrytningar, tomma värden och nollor.

### Verifieringsprotokoll

| Steg | Installerad Expo | Expo Doctor efter rättningar | TypeScript | Befintliga tester |
| --- | --- | --- | --- | --- |
| Utgångsläge 54 | 54.0.37 | 18/18 | Godkänd | 9/9 |
| 55 | 55.0.31 | 20/20 | Godkänd | 9/9 |
| 56 | 56.0.23 | 21/22; endast känd Hermes-regression | Godkänd | 9/9 |
| 57 | 57.0.27 | 21/21 | Godkänd | 9/9 |

SDK 55:s första installation behövde kompletteras med config-pluginerna innan
`expo install --fix` kunde slutföras. SDK 56:s första kontroller hittade det
borttagna splash-fältet och tre gamla StyleSheet-anrop; dessa rättades före 57.
Expo Doctors rekommendation att importera native-modul-API:t från `expo`
följdes; ett tillfälligt direktberoende på `expo-modules-core` togs bort.

SDK 55:s JavaScript/Hermes-export klarade Android och iOS. SDK 56 fick
Doctor, TypeScript och de befintliga testerna; ingen native-build eller
JavaScript-export kördes för det tillfälliga SDK 56-steget.
SDK 57:s slutliga JavaScript/Hermes-export klarar både Android och iOS efter
Papa Parse-rättningen, med cirka 7 MB per plattform i `dist/sdk57`.
Expo Doctor kördes även efter Metro-rättningen och klarade 21/21 kontroller.
Det nya CSV-testet klarar sin kontroll. `npm ls --depth=0` och `git diff --check`
klarar kontrollerna. Autolänkningen hittar `FaltkartaStorageModule` på Android
och `FaltkartaGeoTiffPreviewModule` på iOS.

`expo config --type introspect` har verifierat båda produktions-ID:na,
Androids `allowBackup=false`, lagringsgränsen 30 MB, release-minifiering och
resurskrympning samt iOS filåtkomst och bakgrundsläge för position.
SDK-pluginerna genererar även iOS bakgrundsläget `fetch`.
Jämförelse mot `main` bekräftar att lagringskod, datamodeller, fotokod,
kartreferenser, Androids lagringsmodul, `app.config.js` och `eas.json` är oförändrade.

### Kvarstående verifiering och beroendeproblem

- Native-kompilering har inte körts. Miljön är Windows utan tillgängliga
  Java/Android SDK-verktyg, och Xcode saknas. Swift/Kotlin-kompatibilitet och
  telefonernas beteende måste verifieras med byggena nedan.
- Ingen fysisk telefon har testats. Bevarade data vid uppdatering, GPS i
  bakgrunden, stora kartor, behörigheter, startbild och release-minifiering
  behöver godkännas på både Android och iPhone.
- `npm audit` rapporterar 34 anmärkningar: 1 låg, 10 måttliga, 22 höga och
  1 kritisk. Det kritiska fyndet gäller transitiva `shell-quote`; en fix anges
  som tillgänglig. Bland direkta paket finns även `@babel/core` (låg) och
  befintliga `xlsx@0.18.5` (hög, ingen fix via npm audit).
  Flera automatiska förslag innebär nedgradering av Expo/React Native och är
  inte en giltig SDK 57-lösning. Ingen `npm audit fix --force` har körts.
  Säkerhetsanmärkningarna behöver hanteras separat före release; godkänd
  Expo Doctor betyder inte att npm audit är ren.
- Verktygen visar även en Node-varning om Worklets paketfält `main` samt
  `NO_COLOR`/`FORCE_COLOR`. Dessa varningar är skilda från byggfelen ovan.

### Bevarad datakompatibilitet

AsyncStorage behålls på **2.2.0**. Dess Android-databas heter fortfarande
`RKStorage`, har databasversion 1 och stöder inställningen
`AsyncStorage_db_size_in_MB=30`. Den egna lagringsmodulens databasavläsning
och gränser på 25/28 MB är oförändrade.

Lagringsnycklar, observationsformat, befintlig datamigrering, kartornas relativa
filreferenser och katalogerna för kartor, förhandsbilder, foton och export
ändras inte. `expo-file-system/legacy` behålls. Ingen ny datamigrering införs.
Produktions-ID:t är fortfarande `com.tf64.faltkarta` på båda plattformarna.
`app.config.js`, EAS-profiler, versionsnummer och signeringsuppgifter ändras inte.

Detta bevarar kodens lagringskontrakt, men bevisar inte ensamt att en uppdatering
på telefon bevarar data. Uppdateringstestet nedan måste godkännas före distribution.

### Bygg och kontrollera

Använd Node 22.13 eller senare i 22-serien (kontrollerna kördes med 22.14.0).
iPhone kräver iOS 16.4 eller senare. Native iOS-byggen kräver Mac med Xcode
26.4+ eller EAS Build. Använd EAS standardbyggmiljö för SDK 57; välj inte
Xcode 27 utan att först följa Expos särskilda anvisningar om scene support.

```powershell
npm ci
npx expo-doctor@latest
npm run typecheck
node scripts/test-biotope.cjs
node scripts/test-csv-runtime.cjs
npx expo export --platform all --output-dir dist/sdk57
```

Exporten kontrollerar JavaScript/Hermes för Android och iOS; den kompilerar
inte Kotlin, Swift eller själva installationspaketen.

Bygg nya utvecklingsappar (de gamla SDK 54-klienterna kan inte återanvändas):

```powershell
npx eas-cli@latest build --platform android --profile development
npx eas-cli@latest device:create
npx eas-cli@latest build --platform ios --profile development
$env:APP_VARIANT = "development"
npx expo start --dev-client
```

Registrera iPhone om den inte redan finns i provisioningprofilen. Installera
respektive bygge via EAS-länken och anslut till Metro på samma nätverk.
Utvecklingsappen använder `com.tf64.faltkarta.dev` och testar därför inte
uppdatering av produktionsappens befintliga data.

För fristående release-liknande tester används den befintliga preview-profilen:

```powershell
Remove-Item Env:APP_VARIANT -ErrorAction SilentlyContinue
npx eas-cli@latest build --platform android --profile preview
npx eas-cli@latest build --platform ios --profile preview
```

Dessa kommandon skapar interna APK/ad hoc-byggen, inte butikspubliceringar.
Preview använder produktions-ID:t: kontrollera därför signeringen och vilken
installation som kommer att ersättas innan paketet installeras.

### Testa uppdatering över SDK 54 utan att radera data

1. Börja på en testtelefon med en SDK 54-installation och representativa data:
   flera kartor, punkt- och polygonobservationer, foton, egna arter och ändrade
   inställningar. Använd vid behov ett SDK 54-previewbygge från `main`, byggt i
   en separat ren checkout med samma app-ID och signering som SDK 57-testbygget.
2. Dokumentera antal och innehåll och exportera värdefulla data före testet.
   Appens exporter är inte en verifierad fullständig återställningskopia av alla
   inställningar. Testa inte först på den enda kopian av viktiga fältdata.
3. Android: installera den nya APK:n som uppdatering, exempelvis
   `adb install -r ./faltkarta-sdk57.apk`. Paketnamn och signeringscertifikat
   måste matcha, och versionskoden får inte vara lägre. Kontrollera EAS fjärrstyrda
   versionskod; preview-profilen har ingen egen automatisk uppräkning.
   En Google Play-installation kan vara signerad med en annan app signing key
   än EAS/upload-nyckeln. Vid signeringsfel: avbryt och ordna rätt testdistribution;
   avinstallera inte appen för att komma förbi felet.
4. iPhone: installera det nya ad hoc-bygget över det gamla på en registrerad
   testtelefon. Båda byggena måste ha samma bundle-ID, kompatibel Apple Team/
   application-identifier och provisioning. Verifiera byggnumret före installation.
   Ett ad hoc-till-ad hoc-test ersätter inte ett senare test av butikens faktiska
   uppdateringsväg. Inga TestFlight- eller butiksuppladdningar ingår i detta arbete.
5. Starta utan nätverk. Kontrollera alla gamla kartor, koordinater, observationer,
   foton, egna arter och inställningar. Skapa och ändra en observation, starta om
   appen och verifiera att ändringen finns kvar. Ingen avinstallation eller
   rensning av appdata får ske mellan versionerna.
6. Testa stor GeoTIFF-import och förhandsbild på båda plattformarna, pan/zoom,
   GPS-position, bakgrunds-GPS med släckt skärm, återgång från bakgrunden,
   behörigheter, formulär/tangentbord och tillbaka-navigering.
7. Testa fotoimport och export till ZIP, Excel, GeoJSON, e-post och Artportalen.
   Kontrollera Androids lagringsvarningar med ett separat testdataset nära
   gränserna. Kör även fristående preview utan Metro för release-minifiering
   och korrekt startbild.

Godkänn inte en release förrän native-byggen och uppdateringstester är klara.
Vid fel: stoppa distributionen och spara loggar och data. En återgång till äldre
APK/IPA över en ny installation är inte en verifierad återställningsmetod.

### Källor

- [Expos uppgraderingsguide](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/)
- [SDK 55](https://expo.dev/changelog/sdk-55), [SDK 56](https://expo.dev/changelog/sdk-56), [SDK 57](https://expo.dev/changelog/sdk-57)
- [Expos expo-upgrade-skill](https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-upgrade/SKILL.md)
- [React Navigation 6 till 7](https://reactnavigation.org/docs/upgrading-from-6.x/)
- [Intern distribution med EAS](https://docs.expo.dev/build/internal-distribution/)
