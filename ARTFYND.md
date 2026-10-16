# Tillfälliga artfynd från Artportalen

Artfyndsknappen (bladet) i kartans verktygsfält öppnar sökningen. Hämta läser det
synliga kartområdet vid knapptrycket. Fynd från flera områden ackumuleras utan
dubbletter. Markeringar tillämpas först med Visa urval. Återställ visar alla fynd;
Rensa tömmer sessionen. När kartskärmen lämnas avbryts hämtningen och fynden rensas.
Egna sparade observationer, databas, säkerhetskopiering och export påverkas inte.

## Konfiguration via Cloudflare

Fyll i följande variabel i den Git-ignorerade `.env` i projektroten:

```dotenv
EXPO_PUBLIC_ARTFYND_PROXY_URL=https://faltkarta-artfynd-proxy.klafsamot.workers.dev
```

`.env.example` innehåller en tom mall. Starta om Expo efter ändringen och ladda om
appen. För en fristående app behöver en ny build innehålla konfigurationen.
Endast den publika proxyadressen byggs in i klienten. Lägg SLU:s prenumerationsnyckel
som en hemlig variabel med namnet `ARTPORTALEN_API_KEY` i Cloudflare Workern.
Publicera `workers/artfynd-proxy/index.js` som Workerns kod. Nyckeln ska inte finnas i appens
`.env`, byggmiljö eller källkod. Ta även bort eventuell tidigare klientnyckel i
EAS/CI och rotera den om den har distribuerats i gamla appbyggen.

Workern gör ett SLU-anrop per appanrop och vidarebefordrar JSON-body oförändrad,
`skip`, `take`, `translationCultureCode`, `X-Api-Version` och `X-Requesting-System`.
Endast Workerns hemliga nyckel används mot den fasta SLU-adressen. SLU:s svarsbody,
HTTP-status, Content-Type och Retry-After bevaras, även vid API-fel.
CORS tillåter POST/OPTIONS samt appens headers och exponerar Retry-After.

Ogiltig JSON eller sidindelning ger 400, saknad serverkonfiguration 500,
anslutningsfel 502 och timeout efter 25 sekunder 504. `take` tillåts mellan 1 och
500. Workern ändrar inga sökfilter; polygonens storlekskontroll finns i appen.
Proxyn är publik och CORS är inte autentisering. Anropsbegränsning för publik
drift konfigureras separat i Cloudflare.

## Sökning och kontrakt

Klienten anropar Cloudflare-proxyn som använder SOS `POST /observations/search` med geografiskt polygonfilter,
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
node --test scripts/test-artfynd.cjs scripts/test-artfynd-proxy.cjs
```

Testerna använder simulerade API-svar och Reacts test-renderare, utan riktig nyckel.
Manuell kontroll på Android/iOS med publicerad Worker och servernyckel i Cloudflare:

- Hämta, stäng modalen, panorera/zooma och hämta ett överlappande område.
- Markera arter, verifiera oförändrad karta, tillämpa urval och återställ.
- Kontrollera punkttryck, popup, länk och samspel med kartans panorering.
- Prova stora sökområden, offline, tomt resultat och flera hundra punkter.
- Rensa under hämtning; lämna och öppna kartan igen under hämtning.
- Kontrollera små skärmar, liggande läge och större textstorlek.
