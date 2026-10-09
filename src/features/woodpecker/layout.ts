import type { Size, Targets } from './types';

/** Keep the original route in a lower band, with measured targets in that band. */
export function lowerScreenLayout(size: Size, targets: Targets) {
  const height = Math.min(size.height, Math.max(240, Math.min(size.width, size.height) * 0.8));
  const top = Math.max(0, Math.min(size.height - height,
    Math.min(targets.gps.y, targets.plus.y) - 120));
  return {
    top,
    size: { width: size.width, height: size.height - top },
    targets: {
      gps: { ...targets.gps, y: targets.gps.y - top },
      plus: { ...targets.plus, y: targets.plus.y - top },
    },
  };
}
