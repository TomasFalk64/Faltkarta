import { Artfynd, ArtfyndSearchResult, SearchPolygon, SosSearchFilter, SosSearchResponse } from "../types/artfynd";
import { normalizeObservation } from "./artdataProcessor";

const ENDPOINT = process.env.EXPO_PUBLIC_ARTFYND_PROXY_URL?.trim();
export const SEARCH_LIMIT = 500;
const PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 30000;
const SEARCH_TIMEOUT_MS = 120000;

export class ArtdataError extends Error {
  constructor(message: string, public readonly retryAfterSeconds?: number) { super(message); }
}
export function retryAfterSeconds(value: string | null, now = Date.now()): number {
  if (!value) return 10;
  const seconds = Number(value);
  const parsed = Number.isFinite(seconds) ? seconds : (Date.parse(value) - now) / 1000;
  return Number.isFinite(parsed) ? Math.max(1, Math.ceil(parsed)) : 10;
}
export function buildSearchFilters(polygon: SearchPolygon, now = new Date()): SosSearchFilter[] {
  const from = new Date(now);
  from.setUTCFullYear(from.getUTCFullYear() - 25);
  const common = {
    dataProvider: { ids: [1] },
    date: { startDate: from.toISOString().slice(0, 10), endDate: now.toISOString().slice(0, 10), dateFilterType: "OverlappingStartDateAndEndDate" },
    geographics: { geometries: [{ type: "polygon" as const, coordinates: polygon.coordinates }], maxAccuracy: 100, considerObservationAccuracy: false },
    output: { fieldSet: "Extended" },
  };
  return [
    { ...common, taxon: { ids: [100001, 100048, 103031, 100109, 100100, 6001993, 100049, 2002091, 6006107, 6452, 4000105], includeUnderlyingTaxa: true, taxonListIds: [2], taxonListOperator: "Merge" } },
    { ...common, taxon: { redListCategories: ["DD", "NT", "VU", "EN", "CR", "RE"], includeUnderlyingTaxa: true } },
  ];
}

function abortError(): Error { const error = new Error("Hämtningen avbröts."); error.name = "AbortError"; return error; }

async function searchPage(filter: SosSearchFilter, skip: number, signal: AbortSignal): Promise<SosSearchResponse> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort);
  if (signal.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
  try {
    if (signal.aborted) throw abortError();
    const url = new URL(ENDPOINT!);
    url.searchParams.set("skip", String(skip));
    url.searchParams.set("take", String(PAGE_SIZE));
    url.searchParams.set("translationCultureCode", "sv-SE");
    const response = await fetch(url.toString(), {
      method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json", "X-Api-Version": "1.5", "X-Requesting-System": "Faltkarta" },
      body: JSON.stringify(filter),
    });
    if (response.status === 429) {
      const seconds = retryAfterSeconds(response.headers.get("Retry-After"));
      throw new ArtdataError(`Artportalen är upptagen. Försök igen om ${seconds} sekunder.`, seconds);
    }
    if (response.status === 401 || response.status === 403) throw new ArtdataError("Åtkomst nekades. Kontakta artfyndstjänstens administratör.");
    if (!response.ok) throw new ArtdataError(`Artportalen kunde inte svara (HTTP ${response.status}). Försök igen senare.`);
    const data = await response.json();
    if (!data || !Array.isArray(data.records) || !Number.isInteger(data.totalCount) || data.totalCount < 0
      || data.records.some((record: unknown) => !record || typeof record !== "object" || Array.isArray(record))) {
      throw new ArtdataError("Artportalen skickade ett oväntat svar. Försök igen senare.");
    }
    return data;
  } catch (error) {
    if (signal.aborted) throw abortError();
    if (timedOut) throw new ArtdataError("Artportalen svarade inte i tid. Försök igen.");
    if (error instanceof ArtdataError) throw error;
    throw new ArtdataError("Kunde inte hämta artfynd. Kontrollera internetanslutningen och försök igen.");
  } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}

async function searchPart(filter: SosSearchFilter, signal: AbortSignal) {
  const records: SosSearchResponse["records"] = [];
  let total = 0;
  while (records.length < SEARCH_LIMIT) {
    const page = await searchPage(filter, records.length, signal);
    total = page.totalCount;
    if (page.records.length === 0) {
      if (records.length < total) throw new ArtdataError("Artportalen returnerade ett ofullständigt svar. Försök igen.");
      break;
    }
    records.push(...page.records);
    if (records.length >= total) break;
  }
  return { records, limited: total > records.length || records.length >= SEARCH_LIMIT };
}

export async function searchArtfynd(polygon: SearchPolygon, signal: AbortSignal): Promise<ArtfyndSearchResult> {
  if (!ENDPOINT) throw new ArtdataError("Proxyadress saknas. Fyll i EXPO_PUBLIC_ARTFYND_PROXY_URL i .env och starta om appen.");
  if (signal.aborted) throw abortError();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, SEARCH_TIMEOUT_MS);
  try {
    const results = await Promise.all(buildSearchFilters(polygon).map(filter => searchPart(filter, controller.signal)));
    if (signal.aborted) throw abortError();
    const unique = new Map<string, Artfynd>();
    // Alternate sources as in the reference, so neither search monopolizes the cap.
    const length = Math.max(...results.map(r => r.records.length));
    for (let i = 0; i < length; i++) {
      for (const result of results) {
        const raw = result.records[i];
        if (!raw) continue;
        const observation = normalizeObservation(raw);
        if (observation) unique.set(observation.id, observation);
      }
    }
    return { observations: [...unique.values()].slice(0, SEARCH_LIMIT), limited: unique.size >= SEARCH_LIMIT || results.some(r => r.limited) };
  } catch (error) {
    controller.abort(); // A partial search is never committed; cancel its sibling too.
    if (timedOut && !signal.aborted) throw new ArtdataError("Hämtningen tog för lång tid. Försök igen eller sök i ett mindre område.");
    throw error;
  } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}
