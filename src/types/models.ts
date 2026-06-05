export type LatLon = {
  lat: number;
  lon: number;
};

export type MapItem = {
  id: string;
  title: string;
  // Legacy field kept for backwards compatibility with older stored payloads.
  name?: string;
  importName?: string;
  fileName: string;
  previewFileName?: string;
  // Legacy fields kept for backwards compatibility with older stored payloads.
  fileUri?: string;
  thumbnailUri?: string;
  createdAt: string;
  georef?: {
    sourceEpsg: number;
    imageWidth: number;
    imageHeight: number;
    pixelToSource: {
      a: number;
      b: number;
      c: number;
      d: number;
      e: number;
      f: number;
    };
  };
  bbox?: {
    minLat: number;
    minLon: number;
    maxLat: number;
    maxLon: number;
  };
  isBackedUp?: boolean;
  isReportedToAP?: boolean;
};

export type ObservationBase = {
  id: string;
  mapId: string;
  count: number;
  notes: string;
  dateISO: string;
  photoUris: string[];
};

export type PointObservation = ObservationBase & {
  kind: "point";
  species: string;
  wgs84: LatLon;
  pointNumber?: number;
  localName: string;
  accuracyMeters: number | null;
  quantity: number;
  unit: string;
  hostSpecies?: string;
  activity?: string;
  substrate?: string;
  stage?: string;
  gender?: string;
  photoAssetIds?: string[];
};

export type PolygonObservation = ObservationBase & {
  kind: "polygon";
  polygonName: string;
  wgs84: LatLon[];
};

export type Observation = PointObservation | PolygonObservation;

export type VisibleFieldKey =
  | "quantity"
  | "unit"
  | "hostSpecies"
  | "activity"
  | "substrate"
  | "stage"
  | "gender";

export type VisibleFields = Record<VisibleFieldKey, boolean>;

export type AppSettings = {
  gpsPingSeconds: number;
  visibleFields: VisibleFields;
  maxImageSizeMB: number;
  backgroundGPS: boolean;
  autoFollow: boolean;
  coordinateSystem: "SWEREF99" | "WGS84";
  mapSortMode: "LATEST" | "ALPHA" | "NEAREST";
  mapSortAnchor?: LatLon;
};
