const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Same TypeScript runtime approach as the other scripts; no emitted source files.
function loader(overrides = {}, globals = {}) {
  const cache = new Map();
  function load(relative) {
    const file = path.resolve(__dirname, '../', relative);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    const localRequire = name => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      return name.startsWith('.') ? load(path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(file), name + '.ts'))) : require(name);
    };
    new Function('exports', 'require', ...Object.keys(globals), source)(exports, localRequire, ...Object.values(globals));
    return exports;
  }
  return load;
}
const load = loader();
const processor = load('src/services/artdataProcessor.ts');
const projection = load('src/services/mapProjection.ts');
const raw = (id, taxon = 1, name = 'Lav') => ({
  occurrence: { occurrenceId: `urn:lsid:artportalen.se:Sighting:${id}` },
  taxon: { id: taxon, vernacularName: name, scientificName: 'Cladonia parasitica', attributes: { redlistCategory: 'NT', organismGroup: 'Lavar' } },
  location: { decimalLatitude: 60, decimalLongitude: 16, coordinateUncertaintyInMeters: 5 },
  event: { startDate: '2026-10-14T10:00:00+02:00' },
});
const obs = (id, taxon = 1, name) => processor.normalizeObservation(raw(id, taxon, name));
const polygon = { type: 'Polygon', coordinates: [[[16, 60], [16.001, 60], [16.001, 60.001], [16, 60.001], [16, 60]]] };
const map = { bbox: { minLat: 60, maxLat: 60.01, minLon: 16, maxLon: 16.01 } };

test('missing values stay missing, real zero and false survive; invalid positions stay in the data', () => {
  const missing = processor.normalizeObservation({ id: '42' });
  for (const field of ['redlistStatus', 'uncertaintyMeters', 'protected', 'latitude', 'longitude']) assert.equal(missing[field], null);
  assert.equal(processor.redlistColor(missing.redlistStatus), '#16a34a');
  assert.equal(processor.hasCoordinates(missing), false);
  const zero = processor.normalizeObservation({ id: '42', occurrence: { isInformationWithheld: false }, location: { decimalLatitude: 0, decimalLongitude: 0, coordinateUncertaintyInMeters: 0 } });
  assert.equal(zero.protected, false); assert.equal(zero.uncertaintyMeters, 0); assert(processor.hasCoordinates(zero));
  assert.equal(processor.hasCoordinates({ ...zero, latitude: 91 }), false);
  assert.equal(processor.hasCoordinates({ ...zero, longitude: NaN }), false);
  assert.equal(processor.normalizeObservation({ id: '42', location: { coordinateUncertaintyInMeters: 101 } }), null);
  assert.equal(processor.normalizeObservation({}), null);
  assert.equal(obs(42).url, 'https://artportalen.se/sighting/42');
});

test('overlapping searches replace by full observation ID and retain other records', () => {
  const original = processor.mergeObservations(new Map(), [obs(1), obs(2)]);
  const updated = { ...obs(1), date: '2026-10-15' };
  const merged = processor.mergeObservations(original, [updated, obs(3)]);
  assert.equal(merged.size, 3); assert.equal(merged.get(updated.id).date, '2026-10-15');
  assert.equal(original.get(updated.id).date, '2026-10-14');
  assert.equal(processor.groupSpecies([...merged.values()], { field: 'name', direction: 'asc' })[0].count, 3);
});

test('Swedish name ordering, scientific fallback and redlist severity ordering', () => {
  const data = ['Ölav', 'Älav', 'Ålav', 'Zlav', 'Alav'].map((name, i) => obs(i, i + 1, name));
  assert.deepEqual(processor.groupSpecies(data, { field: 'name', direction: 'asc' }).map(g => g.name), ['Alav', 'Zlav', 'Ålav', 'Älav', 'Ölav']);
  const statuses = [null, 'LC', 'NT', 'DD', 'EN', 'CR', 'VU', 'RE'];
  const groups = processor.groupSpecies(statuses.map((status, i) => ({ ...obs(i, i + 1), redlistStatus: status })), { field: 'redlist', direction: 'asc' });
  assert.deepEqual(groups.map(g => g.redlistStatus), ['RE', 'CR', 'EN', 'VU', 'NT', 'DD', 'LC', null]);
  assert.equal(processor.speciesName({ ...obs(1), swedishName: null }), 'Cladonia parasitica');
});

test('viewport inverse reflects pan, zoom and layout, without clipping to raster', () => {
  const image = { width: 800, height: 800 }, view = { width: 400, height: 400 }, center = { x: 400, y: 400 };
  const area = projection.visibleSearchPolygon(map, view, image, center, 2, { x: 0, y: 0 });
  assert.deepEqual(area.coordinates[0][0], area.coordinates[0].at(-1));
  const expected = projection.imagePointToLatLon(map, { x: 300, y: 300 }, 800, 800);
  assert(Math.abs(area.coordinates[0][0][0] - expected.lon) < 1e-9);
  assert(Math.abs(area.coordinates[0][0][1] - expected.lat) < 1e-9);
  const dragged = projection.visibleSearchPolygon(map, view, image, center, 2, { x: 50, y: 0 });
  assert(dragged.coordinates[0][0][0] < area.coordinates[0][0][0]);
  const outside = projection.visibleSearchPolygon(map, view, image, { x: 0, y: 0 }, 2, { x: 0, y: 0 });
  assert(outside.coordinates[0][0][0] < map.bbox.minLon);
  assert.throws(() => projection.visibleSearchPolygon(map, { width: 0, height: 400 }, image, center, 2, { x: 0, y: 0 }));
  assert.throws(() => projection.visibleSearchPolygon({}, view, image, center, 2, { x: 0, y: 0 }));
});

test('1500m limit uses EPSG:3006 and supports rotated georeferencing', () => {
  const g = { georef: { sourceEpsg: 3006, imageWidth: 800, imageHeight: 800,
    pixelToSource: { a: 1, b: 0, c: 550000, d: 0, e: -1, f: 6650000 } } };
  const view = { width: 800, height: 800 }, center = { x: 400, y: 400 };
  assert.doesNotThrow(() => projection.visibleSearchPolygon(g, view, view, center, 1, { x: 0, y: 0 }));
  assert.throws(() => projection.visibleSearchPolygon(g, view, view, center, 0.5, { x: 0, y: 0 }), /Sökområdet är för stort/);
  const rotated = { georef: { ...g.georef, pixelToSource: { ...g.georef.pixelToSource, b: 0.3, d: 0.2 } } };
  const area = projection.visibleSearchPolygon(rotated, view, view, center, 1, { x: 0, y: 0 });
  const expected = projection.imagePointToLatLon(rotated, { x: 0, y: 0 }, 800, 800);
  assert(Math.abs(area.coordinates[0][0][0] - expected.lon) < 1e-8);
  assert(Math.abs(area.coordinates[0][0][1] - expected.lat) < 1e-8);
});

const response = (records, total = records.length) => ({ ok: true, status: 200, json: async () => ({ records, totalCount: total }) });
function apiWith(fetch, extra = {}) {
  return loader({}, { fetch, process: { env: { EXPO_PUBLIC_ARTFYND_PROXY_URL: 'https://proxy.example/search' } }, ...extra })('src/services/artdataApi.ts');
}
test('missing proxy configuration fails before making a request', async () => {
  const api = apiWith(async () => assert.fail('unexpected request'), { process: { env: {} } });
  await assert.rejects(api.searchArtfynd(polygon, new AbortController().signal), /Proxyadress saknas/);
});

test('API uses the proxy without credentials, Artportalen only, two taxon searches and real query pagination', async () => {
  const calls = [];
  const api = apiWith(async (url, options) => {
    const u = new URL(url), body = JSON.parse(options.body); calls.push({ u, body });
    assert.equal(u.hostname, 'proxy.example');
    assert.equal(u.searchParams.get('translationCultureCode'), 'sv-SE');
    assert.equal(options.headers['X-Api-Version'], '1.5');
    assert.equal(options.headers['X-Requesting-System'], 'Faltkarta');
    assert.deepEqual(body.dataProvider.ids, [1]); assert.equal(body.geographics.maxAccuracy, 100);
    assert.equal(options.headers['Ocp-Apim-Subscription-Key'], undefined);
    if (body.taxon.redListCategories) return response([raw(1)]);
    const skip = Number(u.searchParams.get('skip'));
    return skip === 0 ? response(Array.from({ length: 100 }, (_, i) => raw(i + 1)), 101) : response([raw(101)], 101);
  });
  const result = await api.searchArtfynd(polygon, new AbortController().signal);
  assert.equal(result.observations.length, 101); assert.equal(result.limited, false); assert.equal(calls.length, 3);
  assert(calls.some(c => c.u.searchParams.get('skip') === '100'));
  const filters = api.buildSearchFilters(polygon, new Date('2026-10-15T12:00:00Z'));
  assert.equal(filters[0].date.startDate, '2001-10-15');
  assert.deepEqual(filters[1].taxon.redListCategories, ['DD', 'NT', 'VU', 'EN', 'CR', 'RE']);
});

test('500 is the cap per combined search, not per data source; overlaps do not inflate totals', async () => {
  const api = apiWith(async (url, options) => {
    const skip = Number(new URL(url).searchParams.get('skip'));
    const offset = JSON.parse(options.body).taxon.redListCategories ? 1000 : 0;
    return response(Array.from({ length: 100 }, (_, i) => raw(offset + skip + i)), 600);
  });
  const result = await api.searchArtfynd(polygon, new AbortController().signal);
  assert.equal(result.observations.length, 500); assert.equal(result.limited, true);
  assert.equal(new Set(result.observations.map(o => o.id)).size, 500);
  assert(result.observations.some(o => o.id.endsWith(':1000')));
});

test('429 Retry-After and authentication errors have actionable Swedish messages', async () => {
  const api = apiWith(async () => ({ ok: false, status: 429, headers: { get: () => '17' } }));
  await assert.rejects(api.searchArtfynd(polygon, new AbortController().signal), e => e.retryAfterSeconds === 17 && /upptagen/.test(e.message));
  assert.equal(api.retryAfterSeconds('Thu, 15 Oct 2026 12:00:20 GMT', Date.parse('2026-10-15T12:00:00Z')), 20);
  assert.equal(api.retryAfterSeconds('garbage'), 10);
  const denied = apiWith(async () => ({ ok: false, status: 403 }));
  await assert.rejects(denied.searchArtfynd(polygon, new AbortController().signal), /Åtkomst nekades/);
});

test('network, malformed and partial responses fail instead of committing partial results', async () => {
  const bad = apiWith(async () => { throw new TypeError('offline'); });
  await assert.rejects(bad.searchArtfynd(polygon, new AbortController().signal), /internetanslutningen/);
  const invalid = apiWith(async () => ({ ok: true, json: async () => ({ records: null }) }));
  await assert.rejects(invalid.searchArtfynd(polygon, new AbortController().signal), /oväntat svar/);
  const partial = apiWith(async () => response([], 5));
  await assert.rejects(partial.searchArtfynd(polygon, new AbortController().signal), /ofullständigt/);
});

test('timeout and caller cancellation terminate both parallel requests', async () => {
  let aborted = 0;
  const pending = async (_, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => { aborted++; const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
  });
  const api = apiWith(pending, { setTimeout: (fn, ms) => setTimeout(fn, ms === 30000 ? 5 : 1000), clearTimeout });
  await assert.rejects(api.searchArtfynd(polygon, new AbortController().signal), /inte i tid/);
  assert.equal(aborted, 2);
  const controller = new AbortController(), cancellable = apiWith(pending);
  const task = cancellable.searchArtfynd(polygon, controller.signal); controller.abort();
  await assert.rejects(task, e => e.name === 'AbortError');
});

test('hook isolates pending selections, accumulates data and preserves state on errors', async () => {
  const React = require('react');
  const { create, act } = require('react-test-renderer');
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const requests = [];
  const api = { searchArtfynd: (_, signal) => new Promise((resolve, reject) => requests.push({ signal, resolve, reject })), ArtdataError: class extends Error {} };
  const { useArtfynd } = loader({ '../services/artdataApi': api })('src/hooks/useArtfynd.ts');
  let current, root;
  function Harness() { current = useArtfynd(); return null; }
  await act(async () => { root = create(React.createElement(Harness)); });
  try {
    let task;
    await act(async () => { task = current.fetchObservations(() => polygon); void current.fetchObservations(() => polygon); });
    assert.equal(requests.length, 1); assert.equal(current.loading, true);
    await act(async () => { requests[0].resolve({ observations: [obs(1), obs(2, 2)], limited: true }); await task; });
    assert.equal(current.observationsById.size, 2);
    await act(async () => current.toggleSpecies('taxon:1'));
    assert.equal(current.activeObservations.length, 2); assert.equal(current.activeSpeciesFilter, null);
    await act(async () => current.applySelection());
    assert.equal(current.activeObservations.length, 1);
    await act(async () => current.toggleSpecies('taxon:2'));
    assert.equal(current.activeObservations.length, 1); assert.equal(current.selectedSpeciesKeys.size, 2);
    await act(async () => { task = current.fetchObservations(() => polygon); });
    await act(async () => { requests[1].reject(new Error('Nätverksfel')); await task; });
    assert.equal(current.activeObservations.length, 1); assert.equal(current.selectedSpeciesKeys.size, 2);
    assert.equal(current.observationsById.size, 2); assert.equal(current.error, 'Nätverksfel');
    await act(async () => { task = current.fetchObservations(() => polygon); });
    await act(async () => { requests[2].resolve({ observations: [{ ...obs(1), date: '2026-10-15' }, obs(3)], limited: false }); await task; });
    assert.equal(current.observationsById.size, 3); assert.equal(current.selectedSpeciesKeys.size, 0); assert.equal(current.activeSpeciesFilter, null);
    assert.equal(current.resultLimited, true); // Earlier truncation still matters.
    await act(async () => { current.toggleSpecies('taxon:1'); });
    await act(async () => { current.applySelection(); });
    await act(async () => { task = current.fetchObservations(() => polygon); });
    await act(async () => { requests[3].resolve({ observations: [], limited: false }); await task; });
    assert.equal(current.observationsById.size, 3); assert.equal(current.activeSpeciesFilter, null); assert.match(current.message, /Inga fynd/);
    await act(async () => current.toggleSpecies('taxon:1'));
    await act(async () => current.applySelection());
    await act(async () => current.reset());
    assert.equal(current.observationsById.size, 3); assert.equal(current.selectedSpeciesKeys.size, 0); assert.equal(current.activeSpeciesFilter, null);
  } finally { await act(async () => root.unmount()); }
});

test('clear and unmount abort requests; stale success/error/finally cannot restore data or unlock a newer request', async () => {
  const React = require('react');
  const { create, act } = require('react-test-renderer');
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const requests = [];
  const api = { searchArtfynd: (_, signal) => new Promise((resolve, reject) => requests.push({ signal, resolve, reject })), ArtdataError: class extends Error {} };
  const { useArtfynd } = loader({ '../services/artdataApi': api })('src/hooks/useArtfynd.ts');
  let current, root;
  function Harness() { current = useArtfynd(); return null; }
  await act(async () => { root = create(React.createElement(Harness)); });
  let old, next;
  await act(async () => { old = current.fetchObservations(() => polygon); });
  await act(async () => { current.setPopup(obs(99)); current.clear(); });
  assert(requests[0].signal.aborted); assert.equal(current.popup, null);
  await act(async () => { next = current.fetchObservations(() => polygon); });
  await act(async () => { requests[0].resolve({ observations: [obs(1)], limited: true }); await old; });
  assert.equal(current.observationsById.size, 0); assert.equal(current.loading, true); assert.equal(current.resultLimited, false);
  await act(async () => { void current.fetchObservations(() => polygon); });
  assert.equal(requests.length, 2);
  await act(async () => { requests[1].resolve({ observations: [obs(2)], limited: false }); await next; });
  assert.equal(current.observationsById.size, 1); assert.equal(current.loading, false);
  await act(async () => { old = current.fetchObservations(() => polygon); });
  await act(async () => current.clear());
  await act(async () => { requests[2].reject(new Error('stale error')); await old; });
  assert.equal(current.error, null); assert.equal(current.observationsById.size, 0);
  await act(async () => { old = current.fetchObservations(() => polygon); });
  await act(async () => root.unmount());
  assert(requests[3].signal.aborted);
  await act(async () => { requests[3].resolve({ observations: [obs(9)], limited: false }); await old; });
});
