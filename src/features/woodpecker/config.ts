import type { SpriteFrame, WoodpeckerConfig } from './types';

const flight: SpriteFrame[] = Array.from({ length: 5 }, (_, i) => ({
  x: i * 434.4 + 3, y: 90, width: 429, height: 500,
  anchor: { x: 230, y: 295 },
}));

// The turn sheet is NOT a regular seven-cell grid. These crops follow the birds.
const turn: SpriteFrame[] = [
  [0, 351, 215], [320, 310, 220], [612, 318, 218],
  [939, 259, 175], [1218, 332, 141], [1517, 308, 113], [1815, 357, 140],
].map(([x, width, anchorX]) => ({
  x, y: 160, width, height: 385, anchor: { x: anchorX, y: 235 },
}));

// Feet differ in horizontal position between frames; never anchor by image centre.
const peck: SpriteFrame[] = [
  [35, 325, 285], [430, 325, 285], [838, 326, 284],
  [1235, 360, 296], [1650, 325, 291],
].map(([x, width, footX]) => ({
  x, y: 40, width, height: 720, anchor: { x: footX, y: 307 },
}));

export const woodpeckerConfig: WoodpeckerConfig = {
  birdSize: 100,
  tempo: 1,
  flapMs: 420,
  pecksPerStop: 2,
  peckScale: 0.72,
  landingHeight: 0.95,
  gpsOffset: { x: 0, y: 0 },
  plusOffset: { x: 0, y: 0 },
  entryHeight: 0.39,
  turnInset: 0.16,
  turnDepth: 0.16,
  arcHeight: 0.2,
  durations: { entry: 1100, turn: 450, approach: 600, gpsPeck: 650,
    transfer: 750, plusPeck: 650, exit: 800 },
  // Up → half down → down → back up. Last two originals are both downstroke.
  flightOrder: [0, 1, 2, 3, 4, 3, 2, 1],
  // Head raised → poised → forward → impact blur → recovery → raised.
  peckOrder: [0, 1, 2, 3, 4, 1, 0],
  frames: { flight, turn, peck },
};

export function resolveConfig(overrides?: Partial<WoodpeckerConfig>): WoodpeckerConfig {
  const c = { ...woodpeckerConfig, ...overrides };
  if (![c.birdSize, c.tempo, c.flapMs, c.peckScale].every(v => Number.isFinite(v) && v > 0)
    || !Number.isInteger(c.pecksPerStop) || c.pecksPerStop < 1
    || !Object.values(c.durations).every(v => Number.isFinite(v) && v > 0)) {
    throw new Error('Woodpecker: size, tempo, timing and peck count must be positive.');
  }
  for (const [order, frames] of [[c.flightOrder, c.frames.flight], [c.peckOrder, c.frames.peck]] as const) {
    if (!order.length || order.some(i => !Number.isInteger(i) || !frames[i])) {
      throw new Error('Woodpecker: invalid sprite frame order.');
    }
  }
  return c;
}
