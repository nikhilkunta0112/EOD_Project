const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const handler = import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync('functions/api/reformat.js', 'utf8')).toString('base64'));
const reports = { overall: { recipient: 'Team', subject: 'EOD - 26 November', message: 'Hi Team,\nFixed login. Testing is pending.\nBest regards,' }, project: null };
async function call(payload, env = {}, origin = 'https://eod.pages.dev') {
  const { onRequestPost } = await handler;
  return onRequestPost({ env, request: new Request('https://eod.pages.dev/api/reformat', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(payload)
  }) });
}

test('AI returns validated report text and preserves recipient metadata', async () => {
  let invocation;
  const result = await call({ reports }, { AI: { run: async (model, options) => {
    invocation = { model, options };
    return { response: JSON.stringify({ overall: { subject: 'Professional EOD', message: 'Hi Team,\nCompleted Work\n- Resolved the login issue.\nNext Steps\n- Testing remains pending.\nBest regards,' }, project: null }) };
  } } });
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.reports.overall.recipient, 'Team');
  assert.equal(body.reports.project, null);
  assert.match(invocation.model, /llama/);
  assert.match(invocation.options.messages[0].content, /Never invent/);
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
});

test('missing binding and exhausted quota return recoverable errors', async () => {
  assert.equal((await call({ reports })).status, 503);
  assert.equal((await call({ reports }, { AI: { run: async () => { throw Error('quota'); } } })).status, 503);
});

test('rejects invalid or oversized input before AI inference', async () => {
  let called = false;
  const env = { AI: { run: async () => { called = true; } } };
  assert.equal((await call({}, env)).status, 400);
  assert.equal((await call({ reports, padding: 'x'.repeat(25000) }, env)).status, 413);
  assert.equal((await call({ reports }, env, 'https://other.example')).status, 403);
  assert.equal(called, false);
});

test('rejects malformed or partial AI output', async () => {
  for (const response of ['not JSON', JSON.stringify({ overall: { subject: 'Missing body' }, project: null })]) {
    const result = await call({ reports }, { AI: { run: async () => ({ response }) } });
    assert.ok([502, 503].includes(result.status));
  }
});

test('both report variants are preserved', async () => {
  const both = { overall: reports.overall, project: { ...reports.overall, recipient: 'Lead' } };
  const result = await call({ reports: both }, { AI: { run: async () => ({ response: JSON.stringify(both) }) } });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).reports.project.recipient, 'Lead');
});
