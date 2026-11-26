const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function app(response, previous) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { addEventListener() {}, textContent: '' });
    return elements.get(id);
  };
  const saved = new Map(previous ? [['eod-reporting-desk-public-v1', JSON.stringify(previous)]] : []);
  const calls = [];
  const context = vm.createContext({
    document: { getElementById: element, querySelector: () => element('main') },
    localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) },
    fetch: async (url, options) => { calls.push({ url, options }); return options ? { ok: true } : response; },
    setTimeout() {}, clearTimeout() {}, setInterval() {}, structuredClone,
  });
  vm.runInContext(fs.readFileSync('public/defaults.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('public/app.js', 'utf8').replace(/initialize\(\);\s*$/, ''), context);
  vm.runInContext('showProfile = () => {}; showDay = () => {}; showHistory = () => {}; openSettings = () => {};', context);
  return { context, saved, calls, element };
}

const response = (status, type, body) => ({ status, ok: status === 200, headers: { get: () => type }, json: async () => body });

test('static hosting loads browser data, prunes expired records and saves changes', async () => {
  const today = new Date().toLocaleDateString('en-CA');
  const older = new Date(today + 'T00:00:00Z');
  older.setUTCDate(older.getUTCDate() - 3);
  const old = older.toISOString().slice(0, 10);
  const stored = { settings: { sender: 'Test' }, drafts: { [today]: { raw: 'Keep' }, [old]: { raw: 'Expired' } }, history: {} };
  const fixture = app(response(404, 'text/html'), stored);
  await vm.runInContext('initialize()', fixture.context);
  const value = JSON.parse(fixture.saved.get('eod-reporting-desk-public-v1'));
  assert.equal(value.drafts[today].raw, 'Keep');
  assert.equal(value.drafts[old], undefined);
  assert.equal(fixture.element('storage-label').textContent, 'This browser - 3 days');
  assert.equal(fixture.calls.length, 1);
});

test('Pages HTML fallback uses browser storage', async () => {
  const fixture = app(response(200, 'text/html'));
  await vm.runInContext('initialize()', fixture.context);
  assert.ok(fixture.saved.size);
  assert.equal(fixture.element('storage-label').textContent, 'This browser - 3 days');
});

test('local API continues to save to SQLite', async () => {
  const fixture = app(response(200, 'application/json', { settings: { sender: 'Test' }, drafts: {}, history: {} }));
  await vm.runInContext('initialize()', fixture.context);
  assert.equal(fixture.element('storage-label').textContent, 'SQLite - 3 days');
  assert.equal(fixture.calls[1].options.method, 'PUT');
  assert.equal(fixture.saved.size, 0);
});

test('database errors do not silently switch storage', async () => {
  const fixture = app(response(500, 'application/json'));
  await vm.runInContext('initialize()', fixture.context);
  assert.match(fixture.element('main').textContent, /could not be loaded/);
  assert.equal(fixture.saved.size, 0);
});
