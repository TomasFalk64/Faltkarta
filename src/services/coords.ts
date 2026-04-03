import proj4 from "proj4";
import { LatLon } from "../types/models";

const SWEREF99_TM_DEF =
  "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";
const WEB_MERCATOR_DEF =
  "+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +no_defs";

proj4.defs("EPSG:3006", SWEREF99_TM_DEF);
proj4.defs("EPSG:3857", WEB_MERCATOR_DEF);

export function wgs84ToSweref99tm(lon: number, lat: number): { x: number; y: number } {
  const [x, y] = proj4("EPSG:4326", "EPSG:3006", [lon, lat]);
  return { x, y };
}

export function sweref99tmToWgs84(x: number, y: number): { lon: number; lat: number } | null {
  const [lon, lat] = proj4("EPSG:3006", "EPSG:4326", [x, y]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon, lat };
}

export function meters3857ToWgs84(x: number, y: number): { lon: number; lat: number } | null {
  const [lon, lat] = proj4("EPSG:3857", "EPSG:4326", [x, y]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon, lat };
}

export function averageLatLon(points: LatLon[]): LatLon {
  const sum = points.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lon: acc.lon + p.lon }),
    { lat: 0, lon: 0 }
  );
  return {
    lat: sum.lat / points.length,
    lon: sum.lon / points.length,
  };
}

export function distanceMeters(a: LatLon, b: LatLon): number {
  const r = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
