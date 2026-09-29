export const POINT_COLORS = [
  { id: "red", label: "Röd", hex: "#d62828" },
  { id: "orange", label: "Orange", hex: "#ef7900" },
  { id: "yellow", label: "Gul", hex: "#e4bd00" },
  { id: "green", label: "Grön", hex: "#278538" },
  { id: "turquoise", label: "Turkos", hex: "#00a6a6" },
  { id: "purple", label: "Lila", hex: "#843bb5" },
  { id: "brown", label: "Brun", hex: "#80502e" },
] as const;

export type PointColor = typeof POINT_COLORS[number]["id"];

export function normalizePointColor(value: unknown): PointColor {
  return POINT_COLORS.find((color) => color.id === value)?.id ?? "red";
}

export function pointColorOption(value: unknown) {
  return POINT_COLORS.find((color) => color.id === value) ?? POINT_COLORS[0];
}
