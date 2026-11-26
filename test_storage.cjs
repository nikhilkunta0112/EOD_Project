const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function app(response, previous) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { handlers: {}, addEventListener(type, callback) { this.handlers[type] = callback; }, textContent: '' });
    return elements.get(id);
  };
  const saved = new Map(previous ? [['eod-reporting-desk-public-v1', JSON.stringify(previous)]] : []);
  const calls = [];
  const context = vm.createContext({
    document: { getElementById: element, querySelector: () => element('main') },
    localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) },
    fetch: async (url, options) => { calls.push({ url, options }); return options ? { ok: true } : response; },
    setTimeout() {}, clearTimeout() {}, setInterval() {}, structuredClone, AbortController,
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

test('raw notes produce professional sections without settings or invented completion', () => {
  const fixture = app(response(404, 'text/html'));
  const result = vm.runInContext(`
    reportFor('overall', parseUpdates('fixed the login issue. API testing is in progress. Discussed release options; tomorrow I will update the docs', []), defaults, '26 November 2026')
  `, fixture.context);
  assert.equal(result.subject, 'EOD Status Update - 26 November 2026');
  assert.match(result.message, /^Hi Team,/);
  assert.match(result.message, /Completed Work\n\n\u2022 Fixed the login issue\./);
  assert.match(result.message, /Work Updates\n\n\u2022 Discussed release options\./);
  assert.match(result.message, /In Progress \/ Next Steps/);
  assert.doesNotMatch(result.message, /undefined|null|Projects:/);
  assert.match(result.message, /Best regards,$/);
});

test('headings, project scopes and incomplete work preserve meaning', () => {
  const fixture = app(response(404, 'text/html'));
  const updates = vm.runInContext(String.raw`parseUpdates('Completed:\n- Portal: fixed login\n- testing not completed\nBlocked: waiting for access', ['Portal'])`, fixture.context);
  assert.equal(updates[0].scope, 'project:Portal');
  assert.equal(updates[0].status, 'completed');
  assert.equal(updates[1].status, 'pending');
  assert.equal(updates[2].status, 'pending');
  assert.match(updates[2].text, /Blocked:/);
});

test('generate button consumes raw notes without requiring review or profile', async () => {
  const fixture = app(response(404, 'text/html'));
  await vm.runInContext('initialize()', fixture.context);
  vm.runInContext(`
    showUpdates = () => {}; showReport = () => {}; refreshActions = () => {};
    draft().raw = 'fixed the login issue. Testing is pending';
  `, fixture.context);
  await fixture.element('generate').handlers.click();
  const result = vm.runInContext('draft()', fixture.context);
  assert.equal(result.raw, '');
  assert.equal(result.updates.length, 2);
  assert.match(result.reports.overall.message, /Hi Team,/);
  assert.match(result.reports.overall.message, /Testing is pending\./);
  assert.equal(result.reports.project, null);
});

test('AI rewritten EOD is applied and saved in browser history state', async () => {
  const fixture = app(response(404, 'text/html'));
  await vm.runInContext('initialize()', fixture.context);
  fixture.context.fetch = async () => response(200, 'application/json', { reports: {
    overall: { recipient: 'Team', subject: 'Polished EOD', message: 'Hi Team,\nResolved the login issue.\nBest regards,' }, project: null
  } });
  vm.runInContext(`showUpdates = () => {}; showReport = () => {}; refreshActions = () => {}; draft().raw = 'fixed login';`, fixture.context);
  await fixture.element('generate').handlers.click();
  const result = vm.runInContext('draft()', fixture.context);
  assert.equal(result.formatter, 'ai');
  assert.equal(result.reports.overall.subject, 'Polished EOD');
  assert.match(fixture.element('ai-status').textContent, /Rewritten with Cloudflare/);
});

test('AI failure clearly labels basic fallback', async () => {
  const fixture = app(response(404, 'text/html'));
  await vm.runInContext('initialize()', fixture.context);
  fixture.context.fetch = async () => response(503, 'application/json');
  vm.runInContext(`showUpdates = () => {}; showReport = () => {}; refreshActions = () => {}; draft().raw = 'fixed login';`, fixture.context);
  await fixture.element('generate').handlers.click();
  assert.equal(vm.runInContext('draft().formatter', fixture.context), 'basic');
  assert.match(fixture.element('ai-status').textContent, /Basic formatting was used/);
});

test('late AI responses cannot replace notes changed during generation', async () => {
  const fixture = app(response(404, 'text/html'));
  await vm.runInContext('initialize()', fixture.context);
  let finish;
  fixture.context.fetch = () => new Promise(resolve => { finish = resolve; });
  vm.runInContext(`showUpdates = () => {}; showReport = () => {}; refreshActions = () => {}; draft().raw = 'fixed login';`, fixture.context);
  const pending = fixture.element('generate').handlers.click();
  vm.runInContext(`draft().raw = 'new work added while generating';`, fixture.context);
  finish(response(200, 'application/json', { reports: { overall: { subject: 'Old response', message: 'Old work' }, project: null } }));
  await pending;
  assert.equal(vm.runInContext('draft().reports', fixture.context), undefined);
  assert.equal(vm.runInContext('draft().raw', fixture.context), 'new work added while generating');
  assert.match(fixture.element('ai-status').textContent, /changed while AI was working/);
});
