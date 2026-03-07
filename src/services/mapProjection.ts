import { LatLon, MapItem } from "../types/models";
import proj4 from "proj4";

const DEFAULT_BBOX = {
  minLat: 55.0,
  minLon: 11.0,
  maxLat: 69.5,
  maxLon: 24.2,
};
const DISPLAY_EPSG = 3006;
const SWEREF99_TM_DEF =
  "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";

proj4.defs("EPSG:3006", SWEREF99_TM_DEF);

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
  if (map.georef) {
    const display = projectCoords("EPSG:4326", `EPSG:${DISPLAY_EPSG}`, point.lon, point.lat);
    if (display) {
      const source = projectCoords(`EPSG:${DISPLAY_EPSG}`, `EPSG:${map.georef.sourceEpsg}`, display.x, display.y);
      if (source) {
        const pixel = sourceToPixel(map.georef.pixelToSource, source.x, source.y);
        if (pixel) {
          return {
            x: (pixel.x / map.georef.imageWidth) * imageWidth,
            y: (pixel.y / map.georef.imageHeight) * imageHeight,
          };
        }
      }
    }
  }
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
  if (map.georef) {
    const srcPx = {
      x: (point.x / imageWidth) * map.georef.imageWidth,
      y: (point.y / imageHeight) * map.georef.imageHeight,
    };
    const source = pixelToSource(map.georef.pixelToSource, srcPx.x, srcPx.y);
    const display = projectCoords(`EPSG:${map.georef.sourceEpsg}`, `EPSG:${DISPLAY_EPSG}`, source.x, source.y);
    const wgs84 = display
      ? projectCoords(`EPSG:${DISPLAY_EPSG}`, "EPSG:4326", display.x, display.y)
      : null;
    if (wgs84) {
      return { lat: wgs84.y, lon: wgs84.x };
    }
  }
  const bounds = getMapBounds(map);
  const lon = bounds.minLon + (point.x / imageWidth) * (bounds.maxLon - bounds.minLon);
  const lat = bounds.maxLat - (point.y / imageHeight) * (bounds.maxLat - bounds.minLat);
  return { lat, lon };
}

function pixelToSource(
  affine: { a: number; b: number; c: number; d: number; e: number; f: number },
  x: number,
  y: number
): { x: number; y: number } {
  return {
    x: affine.a * x + affine.b * y + affine.c,
    y: affine.d * x + affine.e * y + affine.f,
  };
}

function sourceToPixel(
  affine: { a: number; b: number; c: number; d: number; e: number; f: number },
  x: number,
  y: number
): { x: number; y: number } | null {
  const det = affine.a * affine.e - affine.b * affine.d;
  if (Math.abs(det) < 1e-12) return null;
  const xx = x - affine.c;
  const yy = y - affine.f;
  return {
    x: (affine.e * xx - affine.b * yy) / det,
    y: (-affine.d * xx + affine.a * yy) / det,
  };
}

function projectCoords(fromCrs: string, toCrs: string, x: number, y: number): { x: number; y: number } | null {
  try {
    if (fromCrs === toCrs) return { x, y };
    const [nx, ny] = proj4(fromCrs, toCrs, [x, y]);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
    return { x: nx, y: ny };
  } catch {
    return null;
  }
}
