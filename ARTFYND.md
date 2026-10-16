# Tillfälliga artfynd från Artportalen

Artfyndsknappen (bladet) i kartans verktygsfält öppnar sökningen. Hämta läser det
synliga kartområdet vid knapptrycket. Fynd från flera områden ackumuleras utan
dubbletter. Markeringar tillämpas först med Visa urval. Återställ visar alla fynd;
Rensa tömmer sessionen. När kartskärmen lämnas avbryts hämtningen och fynden rensas.
Egna sparade observationer, databas, säkerhetskopiering och export påverkas inte.

## Privat konfiguration

Fyll i följande variabel i den Git-ignorerade `.env` i projektroten:

```dotenv
EXPO_PUBLIC_SLU_SUBSCRIPTION_KEY=din_slu_sos_prenumerationsnyckel
```

`.env.example` innehåller en tom mall. Starta om Expo efter ändringen och ladda om
appen. För en fristående app behöver en ny build innehålla konfigurationen.
Nyckeln byggs in i klienten; detta upplägg är avsett för privat användning.
Ingen nyckel läses från backendprojektet. Ingen Fältkarta-backend anropas.

## Sökning och kontrakt

Klienten använder SOS `POST /observations/search` med geografiskt polygonfilter,
`dataProvider.ids: [1]` (endast Artportalen), 25 år och högst 100 m osäkerhet.
`skip` och `take` skickas som queryparametrar. Extended-fältuppsättningen innehåller
bland annat `taxon.attributes.redlistCategory` och `organismGroup`.

Två sökningar körs parallellt: referensimplementationens taxa/signalarter och
rödlistade taxa. Varje del hämtar högst 500 poster, i sidor om 100; sammanslagningen
behåller högst 500 unika fynd per knapptryck och varvar delsökningarna. Ackumulerad
sessionsdata kan överstiga 500. En varning bevaras om någon sökning nått gränsen.
Misslyckas en sida eller delsökning tillämpas inget av det nya resultatet.

Sökområdet omvandlas till EPSG:3006 för kontroll av gränsen 1 500 m i vardera led.
Hela kartvyn används, utan klippning mot rasterbildens kant. Saknade värden bevaras
som null; fynd utan användbar position räknas i listan men ritas inte på kartan.

Referenser:
- https://github.com/biodiversitydata-se/SOS/blob/master/Docs/SearchFilter.md
- https://github.com/biodiversitydata-se/SOS/blob/master/Docs/FieldSets.md
- https://github.com/biodiversitydata-se/SOS/blob/master/Src/SOS.Observations.Api/Controllers/ObservationsController.cs

## Verifiering

```sh
npm run typecheck
node --test scripts/test-artfynd.cjs
```

Testerna använder simulerade API-svar och Reacts test-renderare, utan riktig nyckel.
Manuell kontroll på Android/iOS med en riktig SOS-nyckel:

- Hämta, stäng modalen, panorera/zooma och hämta ett överlappande område.
- Markera arter, verifiera oförändrad karta, tillämpa urval och återställ.
- Kontrollera punkttryck, popup, länk och samspel med kartans panorering.
- Prova stora sökområden, offline, tomt resultat och flera hundra punkter.
- Rensa under hämtning; lämna och öppna kartan igen under hämtning.
- Kontrollera små skärmar, liggande läge och större textstorlek.
