const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function worker(fetch, timers = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../workers/artfynd-proxy/index.js'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  new Function('exports', 'fetch', 'setTimeout', 'clearTimeout', source)(
    exports, fetch, timers.setTimeout ?? setTimeout, clearTimeout);
  return exports.default;
}
const env = { ARTPORTALEN_API_KEY: 'server-only-test-key' };
const request = (query = '', body = '{}', headers = {}) => new Request(`https://proxy.example/${query}`, {
  method: 'POST', body, headers: { 'Content-Type': 'application/json', ...headers },
});

test('one upstream call preserves body, pagination, language and headers; client credentials never pass through', async () => {
  let calls = 0;
  const body = '{ "taxon": {"ids": [42]}, "output": {"fieldSet": "Extended"} }';
  const result = '{ "records": [{"occurrence":{"occurrenceId":"42"}}], "totalCount": 901 }';
  const proxy = worker(async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.artdatabanken.se/species-observation-system/v1/observations/search?skip=100&take=100&translationCultureCode=sv-SE');
    assert.equal(options.method, 'POST');
    assert.equal(options.body, body);
    assert.equal(options.headers.get('Ocp-Apim-Subscription-Key'), env.ARTPORTALEN_API_KEY);
    assert.equal(options.headers.get('X-Api-Version'), '1.5');
    assert.equal(options.headers.get('X-Requesting-System'), 'Faltkarta');
    assert.equal(options.headers.get('Authorization'), null);
    assert.equal(options.redirect, 'manual');
    return new Response(result, { headers: { 'Content-Type': 'application/json' } });
  });
  const response = await proxy.fetch(request('?skip=100&take=100&translationCultureCode=sv-SE', body, {
    'X-Api-Version': '1.5', 'X-Requesting-System': 'Faltkarta',
    'Ocp-Apim-Subscription-Key': 'untrusted', Authorization: 'untrusted',
  }), env);
  assert.equal(calls, 1);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), result);
});

test('SLU error statuses, raw error bodies and Retry-After survive with CORS', async () => {
  for (const status of [400, 401, 403, 429, 500, 503]) {
    const proxy = worker(async () => new Response('original error', {
      status, headers: { 'Retry-After': '17', 'Content-Type': 'text/plain' },
    }));
    const response = await proxy.fetch(request(), env);
    assert.equal(response.status, status);
    assert.equal(await response.text(), 'original error');
    assert.equal(response.headers.get('Retry-After'), '17');
    assert.equal(response.headers.get('Content-Type'), 'text/plain');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(response.headers.get('Access-Control-Expose-Headers'), 'Retry-After');
  }
});

test('preflight, invalid input and missing server configuration do not call SLU', async () => {
  const proxy = worker(async () => assert.fail('unexpected upstream call'));
  const preflight = await proxy.fetch(new Request('https://proxy.example', { method: 'OPTIONS' }), {});
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Headers'), 'Content-Type, X-Api-Version, X-Requesting-System');
  assert.equal((await proxy.fetch(new Request('https://proxy.example'), env)).status, 405);
  assert.equal((await proxy.fetch(request(), {})).status, 500);
  for (const body of ['bad json', 'null', '[]']) assert.equal((await proxy.fetch(request('', body), env)).status, 400);
  for (const query of ['?skip=-1', '?take=501', '?take=0', '?skip=0&skip=1']) {
    assert.equal((await proxy.fetch(request(query), env)).status, 400);
  }
});

test('network failures and timeouts produce CORS errors without exposing exception details', async () => {
  const failed = worker(async () => { throw new Error('sensitive details'); });
  const response = await failed.fetch(request(), env);
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /sensitive details/);
  const slow = worker((_, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }), { setTimeout: fn => setTimeout(fn, 5) });
  assert.equal((await slow.fetch(request(), env)).status, 504);
});
