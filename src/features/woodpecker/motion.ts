import type { Facing, Point, Size, SpriteKind, Targets, WoodpeckerConfig } from './types';

export type Pose = Point & { kind: SpriteKind; frame: number; facing: Facing; angle: number };
export type Route = { start: Point; turnStart: Point; turnEnd: Point; gps: Point;
  plus: Point; end: Point; gpsFacing: Facing; plusFacing: Facing; bend: number };

export function validLayout(size: Size, targets: Targets): boolean {
  return [size.width, size.height, targets.gps.width, targets.gps.height,
    targets.plus.width, targets.plus.height].every(n => Number.isFinite(n) && n > 0)
    && [targets.gps.x, targets.gps.y, targets.plus.x, targets.plus.y].every(Number.isFinite);
}

export function createRoute(size: Size, targets: Targets, c: WoodpeckerConfig): Route {
  const sidePoint = (key: keyof Targets, facing: Facing): Point => {
    const r = targets[key];
    const offset = key === 'gps' ? c.gpsOffset : c.plusOffset;
    return { x: r.x + (facing === 1 ? 0 : r.width) + offset.x,
      y: r.y + r.height * c.landingHeight + offset.y };
  };
  const chooseSide = (key: keyof Targets, preferred: Facing): Facing => {
    const rect = targets[key];
    const leftSpace = rect.x;
    const rightSpace = size.width-rect.x-rect.width;
    const clearance = c.birdSize*c.peckScale*0.8;
    if (preferred === -1 && rightSpace < clearance && leftSpace > rightSpace) return 1;
    if (preferred === 1 && leftSpace < clearance && rightSpace > leftSpace) return -1;
    return preferred;
  };
  const turnX = size.width * (1 - c.turnInset);
  const gpsFacing = chooseSide('gps', targets.gps.x + targets.gps.width / 2 < turnX ? -1 : 1);
  const gps = sidePoint('gps', gpsFacing);
  const plusFacing = chooseSide('plus', targets.plus.x + targets.plus.width / 2 >= gps.x ? 1 : -1);
  const margin = c.birdSize * 1.8;
  return {
    start: { x: -margin, y: size.height * c.entryHeight },
    turnStart: { x: size.width * (1 - c.turnInset), y: size.height * c.entryHeight },
    turnEnd: { x: size.width * (1 - c.turnInset), y: size.height * (c.entryHeight + c.turnDepth) },
    gps, plus: sidePoint('plus', plusFacing),
    end: { x: size.width + margin, y: Math.max(0, targets.plus.y - size.height * 0.18) },
    gpsFacing, plusFacing, bend: Math.min(size.width, size.height) * c.arcHeight,
  };
}

export function totalDuration(c: WoodpeckerConfig): number {
  return Object.values(c.durations).reduce((a, b) => a + b, 0) / c.tempo;
}

function bezier(a: Point, b: Point, d: Point, e: Point, t: number): Point {
  'worklet';
  const s = 1 - t;
  return { x: s*s*s*a.x + 3*s*s*t*b.x + 3*s*t*t*d.x + t*t*t*e.x,
    y: s*s*s*a.y + 3*s*s*t*b.y + 3*s*t*t*d.y + t*t*t*e.y };
}

function fly(a: Point, b: Point, t: number, bend: number): Point {
  'worklet';
  return bezier(a, { x: a.x + (b.x-a.x)*0.32, y: a.y-bend },
    { x: a.x + (b.x-a.x)*0.72, y: b.y-bend }, b, t);
}

/** Pure UI-thread timeline. Path and wing cycle have independent clocks. */
export function samplePose(ms: number, r: Route, c: WoodpeckerConfig): Pose {
  'worklet';
  const d = c.durations;
  let t = Math.max(0, ms * c.tempo);
  const wing = c.flightOrder[Math.floor(t / c.flapMs * c.flightOrder.length) % c.flightOrder.length];
  const flight = (p: Point, facing: Facing): Pose => {
    'worklet';
    return { ...p, kind: 'flight', frame: wing, facing, angle: 0 };
  };
  const peck = (p: Point, facing: Facing, elapsed: number, duration: number): Pose => {
    'worklet';
    const cycle = (elapsed / duration * c.pecksPerStop) % 1;
    return { ...p, kind: 'peck', facing, angle: 0,
      frame: c.peckOrder[Math.min(c.peckOrder.length - 1, Math.floor(cycle * c.peckOrder.length))] };
  };
  if (t < d.entry) return flight(fly(r.start, r.turnStart, t / d.entry, r.bend * 0.15), 1);
  t -= d.entry;
  if (t < d.turn) {
    const u = t / d.turn;
    const p = bezier(r.turnStart, { x: r.turnStart.x+r.bend, y: r.turnStart.y },
      { x: r.turnEnd.x+r.bend, y: r.turnEnd.y }, r.turnEnd, u);
    return { ...p, kind: 'turn', frame: Math.min(6, Math.floor(u*7)), facing: 1, angle: 0 };
  }
  t -= d.turn;
  if (t < d.approach) {
    const u = t/d.approach;
    const b = { x: r.turnEnd.x-r.bend, y: r.turnEnd.y };
    const control = { x: r.gps.x-r.gpsFacing*r.bend*0.8, y: r.gps.y-r.bend };
    const s = 1-u;
    const dx = 3*s*s*(b.x-r.turnEnd.x) + 6*s*u*(control.x-b.x) + 3*u*u*(r.gps.x-control.x);
    return flight(bezier(r.turnEnd, b, control, r.gps, u), dx >= 0 ? 1 : -1);
  }
  t -= d.approach;
  if (t < d.gpsPeck) return peck(r.gps, r.gpsFacing, t, d.gpsPeck);
  t -= d.gpsPeck;
  if (t < d.transfer) return flight(fly(r.gps, r.plus, t/d.transfer, r.bend), r.plus.x >= r.gps.x ? 1 : -1);
  t -= d.transfer;
  if (t < d.plusPeck) return peck(r.plus, r.plusFacing, t, d.plusPeck);
  t -= d.plusPeck;
  return flight(fly(r.plus, r.end, Math.min(1, t/d.exit), r.bend*0.6), 1);
}
