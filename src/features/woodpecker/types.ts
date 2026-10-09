export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
/** All values are logical pixels in the overlay's local coordinate system. */
export type TargetRect = Point & Size;
export type Targets = { gps: TargetRect; plus: TargetRect };
export type Facing = 1 | -1;
export type SpriteKind = 'flight' | 'turn' | 'peck';
export type SpriteFrame = {
  /** Rectangle within the original transparent PNG. */
  x: number; y: number; width: number; height: number;
  /** Contact point relative to this rectangle, in source-image pixels. */
  anchor: Point;
};
export type WoodpeckerConfig = {
  birdSize: number;
  tempo: number;
  flapMs: number;
  pecksPerStop: number;
  peckScale: number;
  landingHeight: number;
  gpsOffset: Point;
  plusOffset: Point;
  entryHeight: number;
  turnInset: number;
  turnDepth: number;
  arcHeight: number;
  durations: {
    entry: number; turn: number; approach: number; gpsPeck: number;
    transfer: number; plusPeck: number; exit: number;
  };
  flightOrder: readonly number[];
  peckOrder: readonly number[];
  frames: Record<SpriteKind, readonly SpriteFrame[]>;
};
