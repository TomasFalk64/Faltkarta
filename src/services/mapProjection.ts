import { LatLon, MapItem } from "../types/models";
import proj4 from "proj4";
import { SearchPolygon } from "../types/artfynd";

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

/** Inverse of MapCanvas's screen transform, with no fallback or silent clipping. */
export function visibleSearchPolygon(
  map: MapItem,
  view: { width: number; height: number },
  image: { width: number; height: number },
  center: { x: number; y: number },
  scale: number,
  drag: { x: number; y: number },
): SearchPolygon {
  const fail = () => new Error("Kartans sökområde kunde inte beräknas. Vänta tills kartan visas.");
  if (![view.width, view.height, image.width, image.height, scale].every(v => Number.isFinite(v) && v > 0)
    || ![center.x, center.y, drag.x, drag.y].every(Number.isFinite)
    || (!map.georef && !hasMapBounds(map))) throw fail();
  const bounds = getDisplayBounds3857(map);
  const corners = [[0, 0], [view.width, 0], [view.width, view.height], [0, view.height]];
  const ring: [number, number][] = [];
  for (let edge = 0; edge < 4; edge++) {
    const a = corners[edge], b = corners[(edge + 1) % 4];
    for (let step = 0; step < 8; step++) {
      const fraction = step / 8;
      const x = center.x + (a[0] + (b[0] - a[0]) * fraction - view.width / 2) / scale - drag.x;
      const y = center.y + (a[1] + (b[1] - a[1]) * fraction - view.height / 2) / scale - drag.y;
      let wgs: { x: number; y: number } | null = null;
      if (map.georef) {
        const g = map.georef;
        if (!Number.isFinite(g.imageWidth) || !Number.isFinite(g.imageHeight) || g.imageWidth <= 0 || g.imageHeight <= 0
          || Math.abs(g.pixelToSource.a * g.pixelToSource.e - g.pixelToSource.b * g.pixelToSource.d) < 1e-12) throw fail();
        const source = pixelToSource(g.pixelToSource, x / image.width * g.imageWidth, y / image.height * g.imageHeight);
        wgs = projectCoords(`EPSG:${g.sourceEpsg}`, "EPSG:4326", source.x, source.y);
      } else if (bounds) {
        wgs = projectCoords("EPSG:3857", "EPSG:4326", bounds.minX + x / image.width * (bounds.maxX - bounds.minX), bounds.maxY - y / image.height * (bounds.maxY - bounds.minY));
      }
      if (!wgs || !Number.isFinite(wgs.x) || !Number.isFinite(wgs.y) || Math.abs(wgs.x) > 180 || Math.abs(wgs.y) >= 90) throw fail();
      ring.push([wgs.x, wgs.y]);
    }
  }
  ring.push([...ring[0]]);
  const polygon: SearchPolygon = { type: "Polygon", coordinates: [ring] };
  validateSearchPolygon(polygon);
  return polygon;
}

export function validateSearchPolygon(polygon: SearchPolygon): void {
  const points = polygon.coordinates[0];
  if (!points || points.length < 4) throw new Error("Kartans sökområde är ogiltigt.");
  const meters = points.map(([lon, lat]) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) >= 90) return null;
    return projectCoords("EPSG:4326", "EPSG:3006", lon, lat);
  });
  if (meters.some(p => !p)) throw new Error("Kartans koordinatsystem kunde inte omvandlas.");
  const xs = meters.map(p => p!.x), ys = meters.map(p => p!.y);
  const width = Math.max(...xs) - Math.min(...xs), height = Math.max(...ys) - Math.min(...ys);
  if (width <= 0 || height <= 0) throw new Error("Kartans sökområde är tomt.");
  if (width > 1500 || height > 1500) throw new Error("Sökområdet är för stort. Zooma in för att söka.");
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
