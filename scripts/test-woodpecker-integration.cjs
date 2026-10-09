const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

function load(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    if (!(name in dependencies)) throw Error(name);
    return dependencies[name];
  } });
  return exports;
}

async function main() {
  const originalSettings = '{"backgroundGPS":true}';
  const db = new Map([['settings:v1', originalSettings], ['observations:v1', 'keep']]);
  let fail = false;
  const storage = {
    getItem: async key => db.get(key) ?? null,
    setItem: async (key, value) => {
      await new Promise(resolve => setTimeout(resolve, 5));
      if (fail) throw Error('storage full');
      db.set(key, value);
    },
  };
  const preference = () => load('src/storage/animationPreference.ts', {
    '@react-native-async-storage/async-storage': storage,
  });
  const p = preference();
  assert.equal(await p.loadAnimationPending(), true);
  await p.saveAnimationPending(false);
  assert.equal(await preference().loadAnimationPending(), false, 'Completion survives remount/restart');
  await Promise.all([p.saveAnimationPending(false), p.saveAnimationPending(true)]);
  assert.equal(await p.loadAnimationPending(), true, 'Rearm follows completion in write order');
  fail = true;
  await assert.rejects(p.saveAnimationPending(false));
  fail = false;
  await p.saveAnimationPending(false);
  assert.equal(await p.loadAnimationPending(), false, 'A failed write does not poison later writes');
  assert.equal(db.get('settings:v1'), originalSettings);
  assert.equal(db.get('observations:v1'), 'keep');

  const { lowerScreenLayout } = load('src/features/woodpecker/layout.ts');
  const { resolveConfig } = load('src/features/woodpecker/config.ts');
  const { createRoute } = load('src/features/woodpecker/motion.ts');
  for (const [width, height] of [[320, 568], [390, 760], [768, 1024], [844, 320]]) {
    const targets = {
      gps: { x: width / 2 - 70, y: height - 86, width: 140, height: 42 },
      plus: { x: width - 82, y: height - 96, width: 62, height: 62 },
    };
    const band = lowerScreenLayout({ width, height }, targets);
    const route = createRoute(band.size, band.targets, resolveConfig({ birdSize: 76 }));
    assert.ok(route.start.x < 0 && route.end.x > width);
    assert.ok(route.start.y + band.top > height / 2 || height < 400);
    for (const key of ['gps', 'plus']) {
      assert.ok(Math.abs(route[key].y + band.top - (targets[key].y + targets[key].height * 0.95)) < 0.001);
      const edge = route[key].x;
      assert.ok(edge === targets[key].x || edge === targets[key].x + targets[key].width);
    }
  }
  console.log('Woodpecker integration checks passed: persistence, write failures/order, data isolation and measured targets.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
