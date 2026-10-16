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
  let notifications = 0;
  const unsubscribe = p.subscribeAnimationProgress(() => notifications++);
  assert.equal(await p.loadAnimationPending(), true);
  let progress = await p.loadAnimationProgress();
  assert.equal(p.shouldShowAnimation(progress, 'mapList'), true);
  assert.equal(p.shouldShowAnimation(progress, 'artfynd'), true, 'Second animation does not depend on first');
  await p.completeAnimationStage('mapList', progress.run);
  assert.equal(p.shouldShowAnimation(await preference().loadAnimationProgress(), 'artfynd'), true, 'Second step survives restart');
  assert.equal(await p.loadAnimationPending(), false, 'First completed animation clears checkbox');
  await p.completeAnimationStage('mapList', progress.run);
  assert.equal((await p.loadAnimationProgress()).artfyndShown, false, 'Duplicate completion cannot skip second step');
  await p.completeAnimationStage('artfynd', progress.run);
  assert.equal(await p.loadAnimationPending(), false);
  assert.equal((await p.loadAnimationProgress()).artfyndShown, true);
  await p.saveAnimationPending(true, true);
  const replay = await p.loadAnimationProgress();
  await p.completeAnimationStage('mapList', progress.run);
  assert.equal((await p.loadAnimationProgress()).mapListShown, false, 'Old callbacks cannot finish a new replay');
  assert.equal(replay.artfyndShown, false, 'Replay resets both flags');
  // Open a map while the first animation is interrupted: only the second completes.
  await p.completeAnimationStage('artfynd', replay.run);
  const secondFirst = await preference().loadAnimationProgress();
  assert.equal(secondFirst.artfyndShown, true);
  assert.equal(secondFirst.mapListShown, false);
  assert.equal(p.animationCheckboxChecked(secondFirst), false);
  assert.equal(p.shouldShowAnimation(secondFirst, 'mapList'), true, 'Automatic uncheck allows unfinished animation on return');
  assert.equal((await preference().loadAnimationProgress()).manualPlayback, true, 'Explicit replay applies to both steps');
  await p.saveAnimationPending(false);
  await p.completeAnimationStage('mapList', replay.run);
  assert.equal(await p.loadAnimationPending(), false, 'Disabling cannot be undone by late completion');
  const disabled = await p.loadAnimationProgress();
  assert.equal(disabled.mapListShown, false, 'Stopping does not pretend an animation was shown');
  assert.equal(p.shouldShowAnimation(disabled, 'mapList'), false, 'Manual uncheck stops remaining animation');
  assert.equal(p.shouldShowAnimation(disabled, 'artfynd'), false);
  assert.ok(notifications > 0);
  unsubscribe();
  await p.saveAnimationPending(false);
  assert.equal(await preference().loadAnimationPending(), false, 'Completion survives remount/restart');
  await Promise.all([p.saveAnimationPending(false), p.saveAnimationPending(true)]);
  assert.equal(await p.loadAnimationPending(), true, 'Rearm follows completion in write order');
  const concurrent = await p.loadAnimationProgress();
  await Promise.all([p.completeAnimationStage('mapList', concurrent.run), p.completeAnimationStage('artfynd', concurrent.run)]);
  const both = await p.loadAnimationProgress();
  assert.equal(both.mapListShown && both.artfyndShown, true, 'Serialized completions preserve both flags');
  fail = true;
  await assert.rejects(p.saveAnimationPending(false));
  fail = false;
  await p.saveAnimationPending(false);
  assert.equal(await p.loadAnimationPending(), false, 'A failed write does not poison later writes');
  assert.equal(db.get('settings:v1'), originalSettings);
  assert.equal(db.get('observations:v1'), 'keep');
  db.delete('woodpeckerIntroProgress:v3');
  db.set('woodpeckerIntroPending:v1', 'false');
  assert.equal((await preference().loadAnimationProgress()).enabled, false, 'Previously disabled intros stay disabled');
  db.set('woodpeckerIntroPending:v1', 'true');
  assert.equal((await preference().loadAnimationProgress()).enabled, true);
  for (const stage of ['mapList', 'artfynd', 'done']) {
    db.set('woodpeckerIntroProgress:v2', JSON.stringify({ stage, run: 4, manualPlayback: true }));
    const migrated = await preference().loadAnimationProgress();
    assert.equal(migrated.mapListShown, stage !== 'mapList');
    assert.equal(migrated.artfyndShown, stage === 'done');
    assert.equal(migrated.enabled, stage !== 'done');
    assert.equal(migrated.run, 4);
  }

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
