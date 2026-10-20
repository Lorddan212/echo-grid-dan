'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const source = file => readFileSync(join(__dirname, '..', file), 'utf8');
const rules = require('../rules.js');

test('validator rejects duplicate Replay, illegal tiles, excessive logs and moves after death', () => {
  const seed = 'test';
  const first = rules.sequence(seed)();
  const wrong = (first + 1) % 9;
  for (const events of [['replay', 'replay'], [9], [-1], [null], [1.5], [wrong, wrong, wrong, first], Array(50001).fill(0)]) {
    assert.throws(() => rules.evaluate(seed, 'standard', events));
  }
  assert.throws(() => rules.evaluate(seed, 'practice', []));
  assert.equal(rules.evaluate(seed, 'standard', [wrong, wrong, wrong]).lives, 0);
});

test('Replay cannot inflate score or longest streak by replaying credited prefixes', () => {
  const next = rules.sequence('test');
  const pattern = [next(), next()];
  const result = rules.evaluate('test', 'standard', [pattern[0], 'replay', ...pattern]);
  assert.equal(result.score, 175);
  assert.equal(result.streak, 2);
  assert.equal(result.minimumMs, 4560);
});

function speechFixture() {
  let utterance, timeout;
  const context = vm.createContext({
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: { speak(value) { utterance = value; }, cancel() {} },
    setTimeout(callback) { timeout = callback; return 1; }, clearTimeout() {},
  });
  vm.runInContext(source('speech.js'), context);
  return { narrator: context.EchoSpeech.create(), utterance: () => utterance, expire: () => timeout() };
}
test('spoken tile numbers wait for completion and cancellation ignores late callbacks', async () => {
  const f = speechFixture();
  let done = false;
  const first = f.narrator.speak(8).then(value => { done = true; return value; });
  await Promise.resolve();
  assert.equal(done, false);
  assert.equal(f.utterance().text, '9');
  const old = f.utterance();
  f.narrator.cancel();
  assert.equal(await first, false);
  const second = f.narrator.speak(0);
  old.onend();
  f.utterance().onend();
  assert.equal(await second, true);
});
test('speech error and timeout release playback; missing engines fall back', async () => {
  const f = speechFixture();
  const failed = f.narrator.speak(1);
  f.utterance().onerror();
  assert.equal(await failed, false);
  const hung = f.narrator.speak(2);
  f.expire();
  assert.equal(await hung, false);
  const context = vm.createContext({});
  vm.runInContext(source('speech.js'), context);
  assert.equal(context.EchoSpeech.create().supported, false);
  assert.equal(await context.EchoSpeech.create().speak(0), false);
});

function rankingsFixture({ url = 'https://rankings.example', status = 200 } = {}) {
  const storage = new Map(), requests = [], history = [];
  const context = vm.createContext({
    EchoConfig: { leaderboardUrl: url }, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    location: { hash: '#startng_session=test-session&expires_in=7200&keep=yes', pathname: '/', search: '?mode=daily' },
    history: { replaceState: (...args) => history.push(args) },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: status === 200, status, json: async () => ({ error: 'Expired' }) }; },
  });
  vm.runInContext(source('rankings.js'), context);
  return { client: context.EchoRankings, storage, requests, history };
}
test('session fragment is removed, bearer stays off public board requests, and moves are the only finish data', async () => {
  const f = rankingsFixture();
  assert.equal(f.history[0][2], '/?mode=daily#keep=yes');
  await f.client.board('daily');
  await f.client.finish('run-123', [0, 'replay']);
  assert.equal(f.requests[0].options.headers.Authorization, undefined);
  assert.equal(f.requests[1].options.headers.Authorization, 'Bearer test-session');
  assert.deepEqual(JSON.parse(f.requests[1].options.body), { events: [0, 'replay'] });
  assert.equal(f.requests[1].options.credentials, 'omit');
});
test('expired sessions clear stored credentials and insecure remote backend URLs stay disabled', async () => {
  const f = rankingsFixture({ status: 401 });
  await assert.rejects(f.client.daily(), { status: 401 });
  assert.equal(f.client.signedIn, false);
  assert.equal(f.storage.has('echo-grid-session'), false);
  assert.equal(rankingsFixture({ url: 'http://rankings.example' }).client.enabled, false);
  assert.equal(rankingsFixture({ url: 'http://localhost:8787' }).client.enabled, true);
});
