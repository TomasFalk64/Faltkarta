export type RedlistStatus = "RE" | "CR" | "EN" | "VU" | "NT" | "DD" | "LC";
export type SearchPolygon = { type: "Polygon"; coordinates: [number, number][][] };

// SOS fields are optional; normalize only after validating the response.
export interface SosObservation {
  id?: string | number;
  occurrence?: { occurrenceId?: string; isInformationWithheld?: boolean };
  taxon?: {
    id?: number; scientificName?: string; vernacularName?: string; swedishName?: string;
    attributes?: { organismGroup?: string; redlistCategory?: string; redListCategory?: string };
    redlistCategory?: string; redListCategory?: string;
  };
  location?: { decimalLatitude?: number; decimalLongitude?: number; coordinateUncertaintyInMeters?: number };
  event?: { startDate?: string };
}
export interface SosSearchResponse { records: SosObservation[]; totalCount: number; }
export interface SosSearchFilter {
  dataProvider: { ids: number[] };
  date: { startDate: string; endDate: string; dateFilterType: string };
  geographics: { geometries: { type: "polygon"; coordinates: [number, number][][] }[]; maxAccuracy: number; considerObservationAccuracy: boolean };
  taxon: { ids?: number[]; includeUnderlyingTaxa: boolean; taxonListIds?: number[]; taxonListOperator?: string; redListCategories?: string[] };
  output: { fieldSet: string };
}
export interface Artfynd {
  id: string;
  taxonId: number | null;
  swedishName: string | null;
  scientificName: string | null;
  organismGroup: string | null;
  redlistStatus: string | null;
  latitude: number | null;
  longitude: number | null;
  date: string | null;
  uncertaintyMeters: number | null;
  protected: boolean | null;
  url: string | null;
}
export interface SpeciesGroup {
  key: string; name: string; scientificName: string | null; redlistStatus: string | null; count: number;
}
export type SpeciesSort = { field: "name" | "redlist" | "count"; direction: "asc" | "desc" };
export interface ArtfyndSearchResult { observations: Artfynd[]; limited: boolean; }
