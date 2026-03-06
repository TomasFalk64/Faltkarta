import { LatLon, MapItem } from "../types/models";

const DEFAULT_BBOX = {
  minLat: 55.0,
  minLon: 11.0,
  maxLat: 69.5,
  maxLon: 24.2,
};

export function getMapBounds(map: MapItem) {
  return map.bbox ?? DEFAULT_BBOX;
}

export function hasMapBounds(map: MapItem): boolean {
  return !!map.bbox && !isLegacyBounds(map.bbox);
}

export function isCoordInsideMapBounds(map: MapItem, point: LatLon): boolean {
  if (!map.bbox || isLegacyBounds(map.bbox)) return false;
  return (
    point.lat >= map.bbox.minLat &&
    point.lat <= map.bbox.maxLat &&
    point.lon >= map.bbox.minLon &&
    point.lon <= map.bbox.maxLon
  );
}

function isLegacyBounds(bounds: {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}): boolean {
  return (
    bounds.minLat === DEFAULT_BBOX.minLat &&
    bounds.minLon === DEFAULT_BBOX.minLon &&
    bounds.maxLat === DEFAULT_BBOX.maxLat &&
    bounds.maxLon === DEFAULT_BBOX.maxLon
  );
}

export function latLonToImagePoint(
  map: MapItem,
  point: LatLon,
  imageWidth: number,
  imageHeight: number
): { x: number; y: number } {
  const bounds = getMapBounds(map);
  const x = ((point.lon - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * imageWidth;
  const y = ((bounds.maxLat - point.lat) / (bounds.maxLat - bounds.minLat)) * imageHeight;
  return { x, y };
}

export function imagePointToLatLon(
  map: MapItem,
  point: { x: number; y: number },
  imageWidth: number,
  imageHeight: number
): LatLon {
  const bounds = getMapBounds(map);
  const lon = bounds.minLon + (point.x / imageWidth) * (bounds.maxLon - bounds.minLon);
  const lat = bounds.maxLat - (point.y / imageHeight) * (bounds.maxLat - bounds.minLat);
  return { lat, lon };
}
