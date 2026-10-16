import { Artfynd, SpeciesGroup, SpeciesSort, SosObservation } from "../types/artfynd";

const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
export const redlistRank = (status: string | null) => ({ RE: 0, CR: 1, EN: 2, VU: 3, NT: 4, DD: 5, LC: 6 }[status ?? ""] ?? 7);
export function redlistColor(status: string | null): string {
  return ({ NT: "#38bdf8", DD: "#2563eb", VU: "#eab308", EN: "#7e22ce", CR: "#ef4444" }[status ?? ""] ?? "#16a34a");
}
export function redlistDrawOrder(status: string | null): number {
  return ({ RE: 0, DD: 1, LC: 2, NT: 3, VU: 4, EN: 5, CR: 6 }[status ?? ""] ?? 2);
}
export function normalizeObservation(raw: SosObservation): Artfynd | null {
  const rawId = raw.occurrence?.occurrenceId ?? raw.id;
  const id = typeof rawId === "string" ? text(rawId) : number(rawId)?.toString();
  if (!id) return null;
  const t = raw.taxon;
  const uncertaintyMeters = number(raw.location?.coordinateUncertaintyInMeters);
  if (uncertaintyMeters !== null && uncertaintyMeters > 100) return null;
  const sightingId = id.match(/(?:^|:)(\d+)$/)?.[1];
  const swedishName = text(t?.swedishName) ?? text(t?.vernacularName);
  return {
    id, taxonId: number(t?.id),
    swedishName: swedishName?.toLocaleLowerCase("sv-SE") === "svenskt namn saknas" ? null : swedishName,
    scientificName: text(t?.scientificName), organismGroup: text(t?.attributes?.organismGroup),
    redlistStatus: (text(t?.attributes?.redlistCategory) ?? text(t?.attributes?.redListCategory) ?? text(t?.redlistCategory) ?? text(t?.redListCategory))?.toUpperCase() ?? null,
    latitude: number(raw.location?.decimalLatitude), longitude: number(raw.location?.decimalLongitude),
    date: text(raw.event?.startDate)?.slice(0, 10) ?? null, uncertaintyMeters,
    protected: typeof raw.occurrence?.isInformationWithheld === "boolean" ? raw.occurrence.isInformationWithheld : null,
    url: sightingId ? `https://artportalen.se/sighting/${sightingId}` : null,
  };
}
export function hasCoordinates(o: Artfynd): boolean {
  return o.latitude !== null && o.longitude !== null && Number.isFinite(o.latitude) && Number.isFinite(o.longitude)
    && Math.abs(o.latitude) <= 90 && Math.abs(o.longitude) <= 180;
}
export const speciesKey = (o: Artfynd): string => o.taxonId !== null ? `taxon:${o.taxonId}`
  : o.scientificName ? `scientific:${o.scientificName.toLocaleLowerCase("sv-SE")}`
  : o.swedishName ? `swedish:${o.swedishName.toLocaleLowerCase("sv-SE")}` : "unknown";
export const speciesName = (o: Artfynd): string => o.swedishName ?? o.scientificName ?? "Okänd art";
export function mergeObservations(previous: ReadonlyMap<string, Artfynd>, incoming: Artfynd[]): Map<string, Artfynd> {
  const next = new Map(previous);
  incoming.forEach(o => next.set(o.id, o));
  return next;
}
export function groupSpecies(observations: Artfynd[], sort: SpeciesSort): SpeciesGroup[] {
  const groups = new Map<string, SpeciesGroup>();
  for (const o of observations) {
    const key = speciesKey(o);
    const group = groups.get(key);
    if (group) {
      group.count++;
      if (o.swedishName) group.name = o.swedishName;
      group.scientificName ??= o.scientificName;
      if (redlistRank(o.redlistStatus) < redlistRank(group.redlistStatus)) group.redlistStatus = o.redlistStatus;
    } else groups.set(key, { key, name: speciesName(o), scientificName: o.scientificName, redlistStatus: o.redlistStatus, count: 1 });
  }
  return [...groups.values()].sort((a, b) => {
    if (sort.field === "redlist" && (a.redlistStatus === null) !== (b.redlistStatus === null)) return a.redlistStatus === null ? 1 : -1;
    const names = a.name.localeCompare(b.name, "sv-SE");
    const rank = redlistRank(a.redlistStatus) - redlistRank(b.redlistStatus);
    const count = a.count - b.count;
    const comparison = sort.field === "name" ? names || rank
      : sort.field === "count" ? count || names
        : rank || names;
    return comparison * (sort.direction === "asc" ? 1 : -1);
  });
}
