const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(name) {
  const source = fs.readFileSync(path.join(__dirname, '../src/features/woodpecker', name + '.ts'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  new Function('exports', js)(exports);
  return exports;
}
const { resolveConfig } = load('config');
const { createRoute, samplePose, totalDuration, validLayout } = load('motion');
const c = resolveConfig();
const size = { width: 390, height: 520 };
const targets = { gps: { x: 32, y: 440, width: 162, height: 48 },
  plus: { x: 302, y: 432, width: 64, height: 64 } };
const route = createRoute(size, targets, c);
assert.equal(totalDuration(c), 5000);
assert.equal(validLayout(size, targets), true);
assert.equal(validLayout({ width: 0, height: 520 }, targets), false);
assert.equal(validLayout(size, { ...targets, plus: { ...targets.plus, x: NaN } }), false);
assert.throws(() => resolveConfig({ tempo: 0 }));
assert.throws(() => resolveConfig({ flightOrder: [99] }));

for (const [start, end, point] of [[2150, 2800, route.gps], [3550, 4200, route.plus]]) {
  const contacts = [];
  let impacts = 0;
  let previousFrame = -1;
  for (let t = start; t < end; t++) {
    const pose = samplePose(t, route, c);
    assert.equal(pose.kind, 'peck');
    assert.equal(pose.x, point.x);
    assert.equal(pose.y, point.y);
    contacts.push(pose.frame);
    if (pose.frame === 3 && previousFrame !== 3) impacts++;
    previousFrame = pose.frame;
  }
  assert.equal(impacts, 2, 'Two distinct impacts at each button');
  assert.equal(new Set(contacts).size, 5, 'Every inspected peck pose is used');
}

for (const time of [1100, 1550, 2150, 2800, 3550, 4200]) {
  const a = samplePose(time - 0.001, route, c);
  const b = samplePose(time, route, c);
  assert.ok(Math.hypot(a.x-b.x, a.y-b.y) < 0.01, 'Continuous path at ' + time);
}
assert.equal(samplePose(3100, route, c).facing, 1);
const reversed = createRoute(size, { gps: { ...targets.gps, x: 195 },
  plus: { ...targets.plus, x: 24 } }, c);
assert.equal(samplePose(3100, reversed, c).facing, -1);
assert.equal(samplePose(3800, reversed, c).facing, -1);
assert.equal(samplePose(4600, reversed, c).facing, 1);
assert.equal(reversed.gpsFacing, 1, 'Grip the spacious side when GPS is near the right edge');
assert.ok(samplePose(0, route, c).x < -c.birdSize);
assert.ok(samplePose(5000, route, c).x > size.width + c.birdSize);
const fast = resolveConfig({ tempo: 2 });
assert.equal(totalDuration(fast), 2500);
assert.deepEqual(samplePose(1800, route, fast), samplePose(3600, route, c));
for (const layout of [size, { width: 844, height: 250 }, { width: 320, height: 240 }]) {
  const r = createRoute(layout, targets, c);
  for (let t = 0; t <= 5000; t += 17) {
    const p = samplePose(t, r, c);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    assert.ok(c.frames[p.kind][p.frame], 'All sampled poses have an existing sprite');
  }
}
console.log('Motion checks passed: timing, two impacts, fixed contacts, continuity, direction, tempo and layouts.');
