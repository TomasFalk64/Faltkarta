// Focused checks with injected storage/filesystem failures; no device data is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, dependencies) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: (name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, console });
  return exports;
}

function fixture() {
  const map = { id: 'a', title: 'Area', fileName: 'a.tif', previewFileName: 'a.png' };
  const db = new Map([
    ['maps:v1', JSON.stringify([map])],
    ['observations:perMapMigration:v1', 'true'],
    ['observations:map:v1:a', '[{"id":"old"}]'],
    ['observations:map:v1:b', '[{"id":"keep"}]'],
    ['observations:v1', '{"a":[{"id":"legacy"}]}'],
    ['observationCounts:v1', '{"a":1,"b":1}'],
    ['mapAreaDescriptions:v1', '{"a":"keep when clearing"}'],
  ]);
  const files = new Map([
    ['doc/maps/a.tif', 'map'], ['doc/previews/a.png', 'preview'],
    ['doc/maps/a/photos/photo.jpg', 'photo'], ['gallery/original.jpg', 'original'],
    ['exports/backup.zip', 'backup'],
  ]);
  const events = [];
  let failKey;
  let failPhoto = false;
  const storage = {
    getItem: async (key) => db.get(key) ?? null,
    getAllKeys: async () => [...db.keys()],
    removeItem: async (key) => { events.push(`remove:${key}`); db.delete(key); },
    setItem: async (key, value) => {
      events.push(`write:${key}`);
      // A full database must be relieved before any metadata writes.
      if (db.has('observations:map:v1:a') || key === failKey) throw Error('SQLITE_FULL');
      db.set(key, value);
    },
  };
  const filesystem = {
    documentDirectory: 'doc/',
    getInfoAsync: async (path) => ({ exists: files.has(path) || [...files.keys()].some((key) => key.startsWith(path)) }),
    makeDirectoryAsync: async () => {},
    writeAsStringAsync: async (path, value) => { files.set(path, value); },
    readAsStringAsync: async (path) => files.get(path),
    moveAsync: async ({ from, to }) => { files.set(to, files.get(from)); files.delete(from); },
    readDirectoryAsync: async (path) => [...files.keys()].filter((key) => key.startsWith(path)).map((key) => key.slice(path.length)),
    deleteAsync: async (path) => {
      events.push(`file:${path}`);
      if (failPhoto && path.endsWith('/photos/')) throw Error('file cleanup interrupted');
      for (const key of [...files.keys()]) if (key === path || (path.endsWith('/') && key.startsWith(path))) files.delete(key);
    },
  };
  const dependencies = {
    '@react-native-async-storage/async-storage': storage,
    'expo-file-system/legacy': filesystem,
    '../services/mapPaths': { getSafeUri: (name, kind) => `doc/${kind === 'map' ? 'maps' : 'previews'}/${name}`, toStoredMapPath: (name) => name },
    '../services/photoUtils': {},
    '../services/photos': { mapPhotosDir: (id) => `doc/maps/${id}/photos/` },
    '../services/photoProcessing': { waitForPhotoProcessing: async () => {} },
  };
  return { db, files, events, create: () => load('src/storage/storage.ts', dependencies),
    failWrite: (key) => { failKey = key; }, failCleanup: (value) => { failPhoto = value; } };
}

async function main() {
  const a = fixture();
  await a.create().clearMapObservations('a');
  assert(!a.db.has('observations:map:v1:a'));
  assert(a.db.has('observations:map:v1:b'));
  assert(!a.db.has('observations:v1'));
  assert.equal(JSON.parse(a.db.get('maps:v1')).length, 1);
  assert.equal(JSON.parse(a.db.get('mapAreaDescriptions:v1')).a, 'keep when clearing');
  assert(a.files.has('doc/maps/a.tif'));
  assert(!a.files.has('doc/maps/a/photos/photo.jpg'));
  assert(a.files.has('gallery/original.jpg') && a.files.has('exports/backup.zip'));

  const b = fixture();
  b.failWrite('maps:v1');
  await assert.rejects(b.create().removeMap('a'), /SQLITE_FULL/);
  assert(b.files.has('doc/maps/a.tif') && b.files.has('doc/previews/a.png'));
  assert([...b.files.keys()].some((key) => key.endsWith('pending-deletions/a.json')));
  b.failWrite(undefined);
  // A new module instance simulates restarting the app after an interrupted deletion.
  assert.equal((await b.create().loadMaps()).length, 0);
  assert(!b.files.has('doc/maps/a.tif'));
  assert(!b.files.has('doc/previews/a.png'));
  assert(b.events.indexOf('remove:observations:map:v1:a') < b.events.indexOf('write:maps:v1'));

  const c = fixture();
  c.failCleanup(true);
  await assert.rejects(c.create().clearMapObservations('a'), /interrupted/);
  c.failCleanup(false);
  await c.create().loadMaps();
  assert(!c.files.has('doc/maps/a/photos/photo.jpg'));
  assert.equal(JSON.parse(c.db.get('maps:v1')).length, 1);

  let mb = 24.9;
  const alerts = [];
  const platform = { OS: 'android' };
  const health = load('src/services/storageHealth.ts', {
    'react-native': { Platform: platform, Alert: { alert: (...args) => alerts.push(args) } },
    'expo-modules-core': { requireOptionalNativeModule: () => ({ getUsedDatabaseBytes: async () => mb * 1024 * 1024 }) },
  });
  await health.checkDatabaseStorage();
  assert.equal(alerts.length, 0);
  mb = 25; await health.checkDatabaseStorage(); await health.checkDatabaseStorage();
  assert.equal(alerts.length, 1);
  mb = 28; await health.checkDatabaseStorage();
  assert.equal(alerts.length, 2);
  mb = 20; await health.checkDatabaseStorage();
  mb = 25; await health.checkDatabaseStorage();
  assert.equal(alerts.length, 3);
  platform.OS = 'ios'; mb = 29; await health.checkDatabaseStorage();
  assert.equal(alerts.length, 3);
  console.log('Passed: full database deletion, preserved originals/exports, interrupted write and file cleanup recovery, Android warning thresholds, iOS exclusion.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
