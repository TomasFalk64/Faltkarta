export type LatLon = {
  lat: number;
  lon: number;
};

export type MapItem = {
  id: string;
  name: string;
  importName?: string;
  fileUri: string;
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
  photoAssetIds?: string[];
};

export type PolygonObservation = ObservationBase & {
  kind: "polygon";
  polygonName: string;
  wgs84: LatLon[];
};

export type Observation = PointObservation | PolygonObservation;

export type AppSettings = {
  gpsPingSeconds: number;
  showQuantityField: boolean;
  maxImageSizeMB: number;
  backgroundGPS: boolean;
  coordinateSystem: "WGS84" | "SWEREF99";
};
