export type LatLon = {
  lat: number;
  lon: number;
};

export type MapItem = {
  id: string;
  name: string;
  fileUri: string;
  thumbnailUri?: string;
  createdAt: string;
  bbox?: {
    minLat: number;
    minLon: number;
    maxLat: number;
    maxLon: number;
  };
};

export type ObservationBase = {
  id: string;
  mapId: string;
  species: string;
  count: number;
  notes: string;
  dateISO: string;
  photoUris: string[];
};

export type PointObservation = ObservationBase & {
  kind: "point";
  wgs84: LatLon;
};

export type PolygonObservation = ObservationBase & {
  kind: "polygon";
  wgs84: LatLon[];
};

export type Observation = PointObservation | PolygonObservation;

export type AppSettings = {
  gpsPingSeconds: number;
};
