'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, dirname, resolve } = require('node:path');
const { createService, startNgIdentity } = require('../server/server.cjs');
const rules = require('../rules.js');
const origin = 'https://echo-grid-dan.start.ng';

// Real HTTP and SQLite; only the external identity provider and clock are mocked.
async function fixture(t, filename) {
  let time = Date.parse('2026-10-20T23:59:00Z');
  const server = createService({ filename, origin, now: () => time, authenticate: async token => {
    if (!['alice', 'bob'].includes(token)) throw Object.assign(Error('Sign in again'), { status: 401 });
    return { id: token, name: token === 'alice' ? '<Alice>' : 'Bob' };
  } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await new Promise(resolve => server.close(resolve)); } };
  t.after(close);
  return {
    close, advance: ms => time += ms,
    async request(path, data, token = 'alice', extra = {}) {
      const response = await fetch('http://127.0.0.1:' + server.address().port + path, {
        method: data === undefined ? 'GET' : 'POST',
        headers: { Origin: origin, ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      return { status: response.status, data: await response.json(), headers: response.headers };
    },
  };
}
let requestIndex = 0;
async function start(f, mode = 'standard', token = 'alice') {
  const result = await f.request('/v2/runs', { mode, requestId: 'request-' + (++requestIndex) }, token);
  assert.equal(result.status, 201);
  return result.data;
}
function firstRound(run) { const next = rules.sequence(run.seed); return [next(), next()]; }

test('HTTP authentication, CORS and strict requests reject spoofed identities', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/health', undefined, null)).status, 200);
  assert.equal((await f.request('/v2/daily', undefined, null)).status, 401);
  assert.equal((await f.request('/v2/daily', undefined, 'expired')).status, 401);
  assert.equal((await f.request('/health', undefined, null, { Origin: 'https://other.example' })).status, 403);
  const ok = await f.request('/v2/daily');
  assert.equal(ok.headers.get('access-control-allow-origin'), origin);
  assert.equal(ok.data.day, '2026-10-20');
  assert.equal((await f.request('/v2/runs', { mode: 'standard', requestId: 'spoof-123', player_id: 'bob' })).status, 400);
  assert.equal((await f.request('/v2/runs', { mode: 'practice', requestId: 'practice-123' })).status, 400);
  assert.equal((await f.request('/v2/runs', { mode: 'standard', requestId: 12345678 })).status, 400);
  assert.equal((await f.request('/v2/runs', { mode: 'standard', requestId: 'wrong-type' }, 'alice',
    { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await f.request('/v2/runs', { oversized: 'x'.repeat(350000) })).status, 413);
});

test('Daily reservation is atomic across tabs, account scoped and pinned to server UTC day', async t => {
  const f = await fixture(t);
  const attempts = await Promise.all(['daily-a1', 'daily-a2'].map(requestId => f.request('/v2/runs', { mode: 'daily', requestId })));
  assert.deepEqual(attempts.map(r => r.status).sort(), [201, 409]);
  const daily = attempts.find(r => r.status === 201).data;
  const bob = await start(f, 'daily', 'bob');
  assert.equal(bob.seed, daily.seed);
  assert.equal((await f.request('/v2/daily')).data.attempt.status, 'started');
  f.advance(60001);
  assert.equal((await f.request('/v2/daily')).data.attempt, null);
  const tomorrow = await start(f, 'daily');
  assert.equal(tomorrow.day, '2026-10-21');
  assert.notEqual(tomorrow.seed, daily.seed);
  const finished = await f.request('/v2/runs/' + daily.id + '/finish', { events: firstRound(daily) });
  assert.equal(finished.status, 200);
  assert.equal((await f.request('/v2/leaderboard?mode=daily&day=2026-10-20')).data.entries.length, 1);
  assert.equal((await f.request('/v2/leaderboard?mode=daily')).data.entries.length, 0);
});

test('start and finish retries are idempotent; finalized runs and ownership are immutable', async t => {
  const f = await fixture(t);
  const payload = { mode: 'daily', requestId: 'retry-request' };
  const first = await f.request('/v2/runs', payload);
  const retry = await f.request('/v2/runs', payload);
  assert.equal(retry.status, 200);
  assert.deepEqual(first.data, retry.data);
  assert.equal((await f.request('/v2/runs', { ...payload, mode: 'fast' })).status, 409);
  const endpoint = '/v2/runs/' + first.data.id + '/finish';
  assert.equal((await f.request(endpoint, { events: [] }, 'bob')).status, 404);
  const result = await f.request(endpoint, { events: [] });
  assert.equal(result.status, 200);
  assert.deepEqual((await f.request(endpoint, { events: [] })).data, result.data);
  assert.equal((await f.request(endpoint, { events: [0] })).status, 409);
});

test('server calculates scores, rejects impossible moves and early finishes', async t => {
  const f = await fixture(t);
  const run = await start(f);
  const endpoint = '/v2/runs/' + run.id + '/finish';
  const pattern = firstRound(run);
  assert.equal((await f.request(endpoint, { events: pattern, score: 999999 })).status, 400);
  assert.equal((await f.request(endpoint, { events: pattern })).status, 400);
  assert.equal((await f.request(endpoint, { events: [9] })).status, 400);
  assert.equal((await f.request(endpoint, { events: ['replay', 'replay'] })).status, 400);
  const wrong = (pattern[1] + 1) % 9;
  f.advance(20000);
  const result = await f.request(endpoint, { events: [pattern[0], wrong, ...pattern] });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.stats, { score: 145, rounds: 1, streak: 2 });
});

test('boards separate difficulty and keep one best run per player with deterministic ties', async t => {
  const f = await fixture(t);
  for (const [mode, player, complete] of [['standard', 'alice', true], ['standard', 'alice', false],
    ['standard', 'bob', true], ['fast', 'bob', true], ['relaxed', 'alice', true]]) {
    const run = await start(f, mode, player);
    f.advance(5000);
    assert.equal((await f.request('/v2/runs/' + run.id + '/finish', { events: complete ? firstRound(run) : [] }, player)).status, 200);
  }
  const board = (await f.request('/v2/leaderboard?mode=standard', undefined, null)).data;
  assert.deepEqual(board.entries.map(r => r.player_id), ['alice', 'bob']);
  assert.equal(board.entries[0].stats.score, 195);
  assert.equal((await f.request('/v2/leaderboard?mode=fast')).data.entries[0].player_id, 'bob');
  assert.equal((await f.request('/v2/leaderboard?mode=relaxed')).data.entries.length, 1);
  for (const query of ['mode=practice', 'mode=daily&day=2026-02-30', 'mode=daily&day=bad']) {
    assert.equal((await f.request('/v2/leaderboard?' + query)).status, 400);
  }
});

test('SQLite retains attempts and results after process service restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'echo-grid-test-'));
  // The path is generated under tmpdir and contains only this test's database.
  t.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  });
  const filename = join(directory, 'test.sqlite');
  const first = await fixture(t, filename);
  const run = await start(first, 'daily');
  first.advance(3000);
  await first.request('/v2/runs/' + run.id + '/finish', { events: firstRound(run) });
  await first.close();
  const second = await fixture(t, filename);
  assert.equal((await second.request('/v2/daily')).data.attempt.status, 'complete');
  assert.equal((await second.request('/v2/leaderboard?mode=daily')).data.entries[0].stats.score, 195);
  await second.close();
});

test('start.ng adapter forwards only the bearer token and distinguishes expiry from provider failure', async t => {
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  const authenticate = startNgIdentity('echo-grid-dan');
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.start.ng/games/echo-grid-dan/player');
    assert.equal(options.headers.Authorization, 'Bearer test-session');
    assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => ({ id: 42, name: 'Player' }) };
  };
  assert.deepEqual(await authenticate('test-session'), { id: '42', name: 'Player' });
  global.fetch = async () => ({ ok: false, status: 401 });
  await assert.rejects(authenticate('expired'), { status: 401 });
  global.fetch = async () => { throw Error('network'); };
  await assert.rejects(authenticate('test'), { status: 503 });
});
