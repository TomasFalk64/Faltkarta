import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Artfynd, SearchPolygon, SpeciesSort } from "../types/artfynd";
import { ArtdataError, searchArtfynd } from "../services/artdataApi";
import { groupSpecies, hasCoordinates, mergeObservations, speciesKey } from "../services/artdataProcessor";
import { validateSearchPolygon } from "../services/mapProjection";

export function useArtfynd() {
  const [observationsById, setObservations] = useState<Map<string, Artfynd>>(() => new Map());
  const [selectedSpeciesKeys, setSelected] = useState<Set<string>>(() => new Set());
  const [activeSpeciesFilter, setFilter] = useState<Set<string> | null>(null);
  const [sort, setSort] = useState<SpeciesSort>({ field: "redlist", direction: "asc" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resultLimited, setLimited] = useState(false);
  const [popup, setPopup] = useState<Artfynd | null>(null);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const retryAt = useRef(0);

  const invalidate = useCallback(() => {
    generation.current++;
    request.current?.abort();
    request.current = null;
  }, []);
  useEffect(() => invalidate, [invalidate]);
  const clear = useCallback(() => {
    invalidate();
    setObservations(new Map()); setSelected(new Set()); setFilter(null); setPopup(null);
    setLimited(false); setLoading(false); setError(null); setMessage(null);
  }, [invalidate]);

  const fetchObservations = useCallback(async (getPolygon: () => SearchPolygon) => {
    if (request.current) return;
    if (Date.now() < retryAt.current) {
      setError(`Artportalen är upptagen. Försök igen om ${Math.ceil((retryAt.current - Date.now()) / 1000)} sekunder.`);
      return;
    }
    let polygon: SearchPolygon;
    try { polygon = getPolygon(); validateSearchPolygon(polygon); }
    catch (e) { setError(e instanceof Error ? e.message : "Kartans sökområde kunde inte beräknas."); return; }
    const controller = new AbortController();
    request.current = controller;
    const token = ++generation.current;
    setLoading(true); setError(null); setMessage(null);
    try {
      const result = await searchArtfynd(polygon, controller.signal);
      if (token !== generation.current || controller.signal.aborted) return;
      setObservations(previous => mergeObservations(previous, result.observations));
      setSelected(new Set()); setFilter(null); setPopup(null);
      setLimited(previous => previous || result.limited);
      setMessage(result.observations.length === 0 ? "Inga fynd hittades i det sökta området. Tidigare hämtade fynd finns kvar."
        : `Hämtade ${result.observations.length} fynd i området. Alla ackumulerade fynd visas.`);
    } catch (e) {
      if (token !== generation.current || controller.signal.aborted) return;
      if (e instanceof ArtdataError && e.retryAfterSeconds) retryAt.current = Date.now() + e.retryAfterSeconds * 1000;
      setError(e instanceof Error ? e.message : "Kunde inte hämta artfynd. Försök igen.");
    } finally {
      if (token === generation.current) { request.current = null; setLoading(false); }
    }
  }, []);

  const observations = useMemo(() => [...observationsById.values()], [observationsById]);
  const groups = useMemo(() => groupSpecies(observations, sort), [observations, sort]);
  const activeObservations = useMemo(() => activeSpeciesFilter === null ? observations
    : observations.filter(o => activeSpeciesFilter.has(speciesKey(o))), [observations, activeSpeciesFilter]);
  const missingCoordinates = useMemo(() => observations.filter(o => !hasCoordinates(o)).length, [observations]);
  const reset = () => { setSelected(new Set()); setFilter(null); setPopup(null); };
  const applySelection = () => {
    if (!selectedSpeciesKeys.size) return false;
    setFilter(new Set(selectedSpeciesKeys)); setPopup(null); return true;
  };
  const toggleSpecies = (key: string) => setSelected(previous => {
    const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next;
  });
  const changeSort = (field: SpeciesSort["field"]) => setSort(previous => ({ field,
    direction: previous.field === field && previous.direction === "asc" ? "desc" : "asc" }));
  return { observationsById, selectedSpeciesKeys, activeSpeciesFilter, loading, error, message, resultLimited,
    popup, setPopup, groups, activeObservations, missingCoordinates, sort, changeSort, fetchObservations,
    clear, reset, applySelection, toggleSpecies };
}
