export function buildPhotoFileName(options: {
  observationId: string;
  label: string;
  name: string;
  dateISO: string;
  index: number;
  extension: string;
}): string {
  const name = sanitizeSpeciesForPhotoFileName(options.name);
  const date = formatDateOnly(options.dateISO);
  const time = formatTimeForPhotoFileName(options.dateISO);
  const sequence = Math.max(1, options.index + 1);
  return `${time}_${name}_${date}_${sequence}.jpg`;
}

export function buildPointPhotoFileName(
  pointNumber: string,
  species: string,
  dateISO: string,
  sequence: number,
  extension: string
): string {
  const point = sanitizeForFileName(pointNumber);
  const art = sanitizeForFileName(species);
  const ts = formatDateForFileName(dateISO);
  const ext = sanitizeExtension(extension);
  return `${point}_${art}_${ts}_${sequence}.${ext}`;
}

export function maxPhotoSideForSetting(maxImageSizeMB: number): number {
  if (maxImageSizeMB >= 1.5 && maxImageSizeMB < 2) return 1700;
  return maxImageSizeMB < 2 ? 1500 : 2000;
}

export function sanitizeForFileName(value: string): string {
  const normalized = toAscii(value)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_\-.]+|[_\-.]+$/g, "");
  return normalized || "okand";
}

export function sanitizeSpeciesForPhotoFileName(value: string): string {
  const normalized = toAscii(value).replace(/[^A-Za-z0-9._-]+/g, "");
  return normalized || "okand";
}

export function formatDateForFileName(dateISO: string): string {
  const date = new Date(dateISO);
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const min = pad2(date.getMinutes());
  return `${yyyy}-${mm}-${dd}_${hh}-${min}`;
}

export function formatDateOnly(dateISO: string): string {
  const date = new Date(dateISO);
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  return `${yyyy}-${mm}-${dd}`;
}

export function formatTimeForPhotoFileName(dateISO: string): string {
  const date = new Date(dateISO);
  const hh = pad2(date.getHours());
  const min = pad2(date.getMinutes());
  return `${hh}-${min}`;
}

function sanitizeExtension(value: string): string {
  const ext = String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!ext) return "jpg";
  return ext === "jpeg" ? "jpg" : ext;
}

function toAscii(value: string): string {
  return String(value ?? "")
    .replace(/[åä]/gi, "a")
    .replace(/[ö]/gi, "o")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
