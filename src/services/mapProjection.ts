import { LatLon, MapItem } from "../types/models";
import proj4 from "proj4";

const DEFAULT_BBOX = {
  minLat: 55.0,
  minLon: 11.0,
  maxLat: 69.5,
  maxLon: 24.2,
};
const DISPLAY_EPSG_3857 = 3857;
const WEB_MERCATOR_DEF =
  "+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +no_defs";
const SWEREF99_TM_DEF =
  "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";

proj4.defs("EPSG:3857", WEB_MERCATOR_DEF);
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
    const display = projectCoords("EPSG:4326", `EPSG:${DISPLAY_EPSG_3857}`, point.lon, point.lat);
    if (display) {
      const source = projectCoords(
        `EPSG:${DISPLAY_EPSG_3857}`,
        `EPSG:${map.georef.sourceEpsg}`,
        display.x,
        display.y
      );
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
  const display = projectCoords("EPSG:4326", `EPSG:${DISPLAY_EPSG_3857}`, point.lon, point.lat);
  const bounds = getDisplayBounds3857(map);
  if (display && bounds) {
    const x = ((display.x - bounds.minX) / (bounds.maxX - bounds.minX)) * imageWidth;
    const y = ((bounds.maxY - display.y) / (bounds.maxY - bounds.minY)) * imageHeight;
    return { x, y };
  }
  return { x: 0, y: 0 };
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
    const display = projectCoords(`EPSG:${map.georef.sourceEpsg}`, `EPSG:${DISPLAY_EPSG_3857}`, source.x, source.y);
    const wgs84 = display
      ? projectCoords(`EPSG:${DISPLAY_EPSG_3857}`, "EPSG:4326", display.x, display.y)
      : null;
    if (wgs84) {
      return { lat: wgs84.y, lon: wgs84.x };
    }
  }
  const bounds = getDisplayBounds3857(map);
  if (bounds) {
    const x = bounds.minX + (point.x / imageWidth) * (bounds.maxX - bounds.minX);
    const y = bounds.maxY - (point.y / imageHeight) * (bounds.maxY - bounds.minY);
    const wgs84 = projectCoords(`EPSG:${DISPLAY_EPSG_3857}`, "EPSG:4326", x, y);
    if (wgs84) {
      return { lat: wgs84.y, lon: wgs84.x };
    }
  }
  return { lat: 0, lon: 0 };
}

export function wgs84ToMeters3857(point: LatLon): { x: number; y: number } | null {
  return projectCoords("EPSG:4326", `EPSG:${DISPLAY_EPSG_3857}`, point.lon, point.lat);
}

export function meters3857ToSource(
  map: MapItem,
  meters3857: { x: number; y: number }
): { x: number; y: number } | null {
  if (!map.georef) return null;
  return projectCoords(
    `EPSG:${DISPLAY_EPSG_3857}`,
    `EPSG:${map.georef.sourceEpsg}`,
    meters3857.x,
    meters3857.y
  );
}

export function sourceCrsToImagePoint(
  map: MapItem,
  sourceCrs: { x: number; y: number },
  imageWidth: number,
  imageHeight: number
): { x: number; y: number } | null {
  if (!map.georef) return null;
  const pixel = sourceToPixel(map.georef.pixelToSource, sourceCrs.x, sourceCrs.y);
  if (!pixel) return null;
  return {
    x: (pixel.x / map.georef.imageWidth) * imageWidth,
    y: (pixel.y / map.georef.imageHeight) * imageHeight,
  };
}

export function meters3857ToImagePoint(
  bounds3857: { minX: number; minY: number; maxX: number; maxY: number },
  meters3857: { x: number; y: number },
  imageWidth: number,
  imageHeight: number
): { x: number; y: number } {
  const x = ((meters3857.x - bounds3857.minX) / (bounds3857.maxX - bounds3857.minX)) * imageWidth;
  const y = ((bounds3857.maxY - meters3857.y) / (bounds3857.maxY - bounds3857.minY)) * imageHeight;
  return { x, y };
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

export function getDisplayBounds3857(
  map: MapItem
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const bounds = getMapBounds(map);
  const corners = [
    projectCoords("EPSG:4326", `EPSG:${DISPLAY_EPSG_3857}`, bounds.minLon, bounds.minLat),
    projectCoords("EPSG:4326", `EPSG:${DISPLAY_EPSG_3857}`, bounds.minLon, bounds.maxLat),
    projectCoords("EPSG:4326", `EPSG:${DISPLAY_EPSG_3857}`, bounds.maxLon, bounds.minLat),
    projectCoords("EPSG:4326", `EPSG:${DISPLAY_EPSG_3857}`, bounds.maxLon, bounds.maxLat),
  ].filter((p): p is { x: number; y: number } => !!p);

  if (corners.length < 4) return null;
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return null;
  }
  if (minX === maxX || minY === maxY) return null;
  return { minX, minY, maxX, maxY };
}
