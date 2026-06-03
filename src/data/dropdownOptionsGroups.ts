const Substrat = [
    "Liggande död trädstam, markkontakt", "Liggande död trädstam, utan markkontakt", "Stående död trädstam/högstubbe",
    "Amfibolit", "Bark på dött träd", "Bark på levande träd", "Barr/blad", "Basalt", "Basisk bergart (grönsten)",
    "Blad", "Block (> 200 mm)", "Block på botten (> 200 mm)", "Blomma på levande träd/buske", "Blomma på levande ört",
    "Branddödat träd", "Brandpåverkad levande träd", "Bro", "Brygga/pir", "Diabas", "Diorit", "Djur", "Dy", 
    "Död delar av ört/gräs", "Död gren", "Död trädstam", "Död ved vedartad växt", "Dött djur, kadaver",
    "Efterlämning av djur", "Findetritus på botten", "Finsediment på botten", "Friliggande bo", "Frukt",
    "Frö från träd/buske", "Frö från ört/gräs", "Förna", "Gabbro", "Gallbildning", "Glimmerskiffer", "Gnejs",
    "Granit", "Gren på levande träd", "Grovdetritus på botten", "Grus (2-60 mm)", "Grus på botten (2-60 mm)",
    "Grävt bo i marken", "Gyttja", "Gång I ved", "Gödselstack", "Hud, skal", "Humus", "Hustak", "Husvägg", "Hyperit",
    "Hålighet i dött träd med/utan mulm", "Hålighet i levande träd med/utan mulm", "Hår, päls, fjäll eller fjädrar",
    "Hårdbotten", "Inuti död ved", "Inuti levande ved", "Kalksten", "Kambium på levande träd", "Knopp från träd/buske",
    "Knopp från ört/gräs", "Kompost", "Kotte", "Kroppsdel hos levande djur", "Kvartsit", "Larv", "Lera (< 0,002 mm)",
    "Levande del av ört/gräs", "Levande djur", "Levande vedartad växt",  "Mark/jord på land", "Mineraljord", "Mjukbotten", "Morän", "Mull",
    "Oorganiskt bottenmaterial", "Organiskt material på botten", "Organogen jord", "Pegmatit", "Porfyr", "Puppa",
    "Rot av ört/gräs", "Sand (0,06-2 mm)", "Sand på botten (0,06-2 mm)", "Sandsten", "Savflöde", "Silt/mo/mjäla (0,002-0,06 mm)",
    "Skalgrus", "Spillning", "Sten (60 - 200 mm)", "Sten på botten (60 - 200 mm)", "Sten/berg på land", "Stenmur och -röse",
    "Stjälk/strå", "Stolpe, trägärdesgård mm", "Stubbe",  "Sur bergart",
    "Svamp, fruktkropp mm", "Sågspån", "Torv", "Trädbas", "Trädrot", "Trädstam på levande träd",
    "Tångvall eller annan driftrand", "Under bark på död ved", "Ved under vatten", "Vedartad växt", "Vedyta på död ved",
    "Vuxet djur", "Växt", "Ägg", "Ört/gräs"
  ];


const OBESTÄMD_DATA = {
  unit: [
    "Bålar", "cm2", "dm2", "Exemplar", "Fruktkroppar", "Kapslar",
    "Kolonier", "Lekgropar", "m2", "Mycel", "Plantor/tuvor",
    "Registreringar", "Stjälkar/strån/skott", "Äggklumpar"
  ],
  activity: [
    "Spel/sång", "Lockläte, övriga läten", "Äldre gnagspår", "Äldre spillning","Färsk spillning", 
    "Färska gnagspår", "Färska spår", "Äldre spår", "Stationär", "Sträckande",
    "Aktiv", "Avledningsbeteende", "Besöker bebott bo", "Bo, hörda ungar", "Bo, ägg/ungar",
    "Bobesök?", "Bobygge", "Bytes-/matrester", "Bär exkrementsäck", "Drunknad i fiskenät", "Dräktig hona",
    "Dvala", "Död av sjukdom/svält", "Död, krockat med flygplan", "Död, krockat med fyr", "Död, krockat med fönster",
    "Död, krockat med kraftledning", "Död, krockat med staket", "Död, krockat med vindkraftverk",
    "Dödad av elektricitet", "Dödad av predator", "Fragment", "Friflygande", "Frispringande/krypande", "Funnen död", "Fälla/fångst",
    "Föda åt ungar", "Födosökande", "Förbiflygande", "Gall",
    "Gammalt bo", "Grävande", "Gående/springande", "Hopp över vattenytan", "Hårrester", "I lekdräkt","I vatten/simmande",
    "Individmärkt", "Kamp mellan handjur", "Kokong", "Konstant kurs, regelbunden dykning", "Lek", 
    "Långsam rörelse, lång tid vid ytan", "Mina", "Misslyckad häckning", "Nyligen använt bo","Närmanden mot båt",
    "Obs av hona med unge/ungar", "Obs i häcktid, lämplig biotop", "Par i lämplig häckbiotop", "Parning/parningsceremonier",
    "Permanent revir", "Pulli/nyligen flygga ungar", "På övervintringsplats", "Rastande", "Revir, ej häckning", 
    "Revirhävdande", "Ringmärktes", "Ruvande", "Ruvfläckar", "Sjuk", "Skjuten/avlivad", "Spel", "Spår av vuxet djur med unge/ungar",
    "Spår från klättring", "Spår från löpande hona", "Sträckande N", "Sträckande NO",
    "Sträckande NV", "Sträckande O", "Sträckande S", "Sträckande SO", "Sträckande SV", "Sträckande V", "Sträckförsök",
    "Trafikdödad", "Upprörd, varnande", "Vandrande", "Varierande kurs, oregelbunden dykning", "Vilande",
    "Yngelplats med ungar", "Äggläggande", "Äggskal", "Ömsskinn", "Övernattning"
  ],
  substrate: Substrat,
  stage: [
    "1K", "1K+", "2K", "2K-", "2K+", "3K", "3K-", "3K+", "4K", "4K-", "4K+", "5K", "5K-", "5K+",
    "6K", "6K-", "6K+", "7K", "7K-", "7K+", "Adult", "Anamorf", "Bladfällning, vissnar",
    "Blomknopp", "Blomning", "Fjolårsunge", "Frukt-/fröspridning", "Fullt utvecklade blad",
    "Gulnande löv/blad", "I frukt", "Imago/Adult", "Juvenil", "Knoppbristning", "Larv",
    "Larv/Nymf", "Med apothecier", "Med groddkorn", "Med hanorgan", "Med honorgan",
    "Med isidier", "Med kapsel", "Med perithecier", "Med schistisidier","Med soral",
    "Pulli", "Puppa", "Teleomorf", "Utan kapsel", "Vilstadium", "Vinterståndare",
    "Årsunge", "Årsyngel", "Ägg", "Överblommad"
  ],
  gender: [
    "Hane", "Hona", "Honfärgad", "Arbetare", "I par"
  ]
};

interface GroupOptions {
  unit: string[];
  stage?: string[];
  activity?: string[];
  substrate?: string[];
  gender?: string[];
}

// Uppdelning per artgrupp
export const ARTGRUPP_OPTIONS: Record<string, GroupOptions> = {
  Kärlväxter: {
    unit: ["Plantor/tuvor", "Stjälkar/strån/skott", "m2", "dm2", "cm2"],
    stage: ["Bladfällning, vissnar", "Blomknopp", "Blomning", "Frukt-/fröspridning", "Fullt utvecklade blad", "Gulnande löv/blad", "I frukt", "Knoppbristning", "Vilstadium","Vinterståndare", "Överblommad"],
    activity: [],
    gender: ["Hane", "Hona"],
    substrate: Substrat,
  },
  Mossor: {
    unit: ["Plantor/tuvor", "Stjälkar/strån/skott", "Bålar", "Kapslar", "m2", "dm2", "cm2"],
    stage: ["Med kapsel", "Utan kapsel", "Med groddkorn", "Med hanorgan", "Med honorgan"],
    activity: [],
    gender: ["Hane", "Hona"],
    substrate: Substrat,
  },
  Lavar: {
    unit: ["Plantor/tuvor", "Stjälkar/strån/skott", "Bålar", "m2", "dm2", "cm2"],
    stage: ["Med apothecier", "Med perithecier", "Med soral", "Med isidier", "Med schistisidier", "Anamorph", "Teleomorph"],
    activity: [],
    gender: [],
    substrate: Substrat,
  },
  Svampar: {
    unit: ["Bålar", "Mycel", "Fruktkroppar", "m2", "dm2", "cm2"],
    stage: ["Anamorf","Teleomorf"],
    activity: [],
    gender: [],
    substrate: Substrat,
  },
  Alger: {
    unit: ["Plantor/tuvor", "Stjälkar/strån/skott", "Bålar", "Kolonier", "m2", "dm2", "cm2"],
    stage:["Med hanorgan", "Med honorgan", "Fullt utvecklade blad"],
    activity: [],
    gender: ["Hane", "Hona"],
    substrate: Substrat,
  },
  "Ryggradslösa djur": {
    unit: ["Exemplar", "Bålar", "Kolonier", "Äggklumpar", "m2", "dm2", "cm2"],
    stage: ["Ägg", "Larv/Nymf", "Puppa", "Juvenil", "Imago/Adult"],
    gender: ["Hane", "Hona", "I par", "Arbetare"],
    activity: ["Färska gnagspår", "Äldre gnagspår", "Bobygge", "Besöker bebott bo", "Dvala", "Friflygande", "Frispringande/krypande", "Funnen död", "Färsk spillning", "Födosökande", "Fragment", "Gall", "Grävande", "I vatten/simmande", "Kokong", "Mina", "Parning/parningsceremonier", "På övervintringsplats", "Revirhävdande", "Spel", "Sträckande", "Vilande",  "Äldre spillning", "Äggläggande"],
    substrate: Substrat,
  },
  "Däggdjur": {
    unit: [],
    stage: ["Årsunge", "Fjolårsunge", "Adult"],
    gender: ["Hane", "Hona", "I par"],
    activity: ["Besöker bebott bo", "Bobygge", "Bytes-/matrester", "Dräktig hona", "Drunknad i fiskenät", "Dvala", "Död av sjukdom/svält", "Dödad av predator", "Fragment", "Funnen död", "Färska gnagspår", "Färska spår", "Färsk spillning", "Födosökande", "Gammalt bo", "Gående/springande", "Hopp över vattenytan", "Hårrester", "Individmärkt", "Kamp mellan handjur", "Konstant kurs, regelbunden dykning", "Lockläte, övriga läten", "Långsam rörelse, lång tid vid ytan", "Nyligen använt bo", "Närmanden mot båt", "Obs av hona med unge/ungar", "Parning/parningsceremonier", "På övervintringsplats", "Sjuk", "Skjuten/avlivad", "Spel/sång", "Spår av vuxet djur med unge/ungar", "Spår från klättring", "Spår från löpande hona", "Trafikdödad", "Varierande kurs, oregelbunden dykning", "Vilande", "Äldre gnagspår", "Äldre spår", "Äldre spillning"],
    substrate: [],
  },
  "Fladdermöss": {
    unit: ["Exemplar", "Registreringar"],
    stage: ["Årsunge", "Fjolårsunge", "Adult"],
    gender: ["Hane", "Hona"],
    activity: ["Aktiv", "Bytes-/matrester", "Dräktig hona", "Dvala", "Död av sjukdom/svält", "Död, krockat med fyr", "Död, krockat med vindkraftverk", "Dödad av predator", "Funnen död", "Färsk spillning", "Födosökande", "Individmärkt", "Obs av hona med unge/ungar", "Parning/parningsceremonier", "På övervintringsplats", "Sjuk", "Spel/sång", "Vilande", "Yngelplats med ungar", "Äldre spillning"],
    substrate: [],
  },
  "Grod-&kräldjur": {
    unit: ["Exemplar", "Äggklumpar"],
    stage: ["Ägg", "Larv", "Årsunge", "Adult"],
    gender: ["Hane", "Hona", "I par"],
    activity: ["Dvala", "Dräktig hona", "Död av sjukdom/svält", "Dödad av predator", "Fragment", "Funnen död", "Födosökande", "I lekdräkt", "I vatten/simmande", "Individmärkt", "Lockläte, övriga läten", "Nyligen använt bo", "Parning/parningsceremonier", "På övervintringsplats", "Sjuk", "Skjuten/avlivad", "Spel/sång", "Trafikdödad", "Vilande", "Äggläggande", "Ömsskinn"],
    substrate: [],
  },
  Fiskar: {
    unit: ["Exemplar", "Lekgropar", "Äggklumpar"],
    stage: ["Ägg", "Larv", "Årsyngel", "Adult"],
    gender: ["Hane", "Hona"],
    activity: ["Död av sjukdom/svält", "Dödad av predator", "Fragment", "Funnen död", "Födosökande", "Individmärkt", "Lek", "Sjuk", "Vandrande", "Äggläggande"],
    substrate: [],
  },
  "Fåglar": {
    unit: [],
    stage: ["Ägg", "Pulli", "Adult", "1K", "1K+", "2K", "2K-", "2K+", "3K", "3K-", "3K+", "4K", "4K-", "4K+", "5K", "5K-", "5K+", "6K", "6K-", "6K+", "7K", "7K-", "7K+"],
    gender: ["Hane", "Hona", "Honfärgad", "I par"],
    activity: ["Spel/sång", "Lockläte, övriga läten", "Avledningsbeteende", "Besöker bebott bo", "Bo, hörda ungar", "Bo, ägg/ungar", "Bobesök?", "Bobygge", "Bär exkrementsäck", "Drunknad i fiskenät", "Död av sjukdom/svält", "Död, krockat med flygplan", "Död, krockat med fyr", "Död, krockat med fönster", "Död, krockat med kraftledning", "Död, krockat med staket", "Död, krockat med vindkraftverk", "Dödad av elektricitet", "Dödad av predator", "Funnen död", "Fälla/fångst", "Färska spår", "Färsk spillning", "Föda åt ungar", "Födosökande", "Förbiflygande", "Gammalt bo", "Individmärkt", "Misslyckad häckning", "Nyligen använt bo", "Obs i häcktid, lämplig biotop", "Par i lämplig häckbiotop", "Parning/parningsceremonier", "Permanent revir", "Pulli/nyligen flygga ungar", "Rastande", "Revir, ej häckning", "Ringmärktes", "Ruvande", "Ruvfläckar", "Stationär", "Sträckande", "Sträckande N", "Sträckande NV", "Sträckande NO", "Sträckande O", "Sträckande S", "Sträckande SO", "Sträckande SV", "Sträckande V", "Sträckförsök", "Trafikdödad", "Upprörd, varnande", "Vilande", "Äldre spår", "Äldre spillning", "Äggskal", "Övernattning"],
    substrate: [],
  },
  
    "Obestämd": OBESTÄMD_DATA
};

// Globala fallback 
export const DEFAULT_OPTIONS: GroupOptions = OBESTÄMD_DATA;