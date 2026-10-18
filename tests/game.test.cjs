const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8');
const dailySource = fs.readFileSync(path.join(__dirname, '../daily.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

// Run the shipped script through its public click/key handlers without dependencies.
function game({ random = [0, 1, 2, 3], best = 0, storage: suppliedStorage, date = '2026-10-18T12:00:00Z', storageFails = false, hosted = false, delayScore = false } = {}) {
  const timers = new Map();
  const storage = suppliedStorage || new Map([['echo-grid-best', String(best)]]);
  const flashes = [];
  const requests = [];
  let pendingScoreReply;
  let wallTime = new Date(date).valueOf();
  let now = 0;
  let timerId = 0;
  let randomIndex = 0;
  let document;
  function element(tagName = 'DIV') {
    const classes = new Set();
    const events = new Map();
    const children = new Map();
    return {
      tagName, hidden: false, disabled: false, style: {}, dataset: {},
      textContent: '', innerHTML: '', attributes: {},
      classList: {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name),
        toggle(name, force = !classes.has(name)) {
          if (force) classes.add(name); else classes.delete(name);
        },
      },
      setAttribute(name, value) { this.attributes[name] = value; },
      querySelector(selector) {
        if (!children.has(selector)) children.set(selector, element());
        return children.get(selector);
      },
      addEventListener(type, callback) {
        if (!events.has(type)) events.set(type, new Set());
        events.get(type).add(callback);
      },
      removeEventListener(type, callback) { events.get(type)?.delete(callback); },
      dispatch(type, event = {}) { let result; for (const callback of events.get(type) || []) result = callback(event); return result; },
      append() {}, replaceChildren() {}, remove() {},
      click() { if (!this.disabled) return this.dispatch('click'); },
      focus() { document.activeElement = this; },
    };
  }
  const ids = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], element()]));
  for (const id of ['overlay-start', 'start-btn', 'replay-btn', 'sound-btn']) ids.get(id).tagName = 'BUTTON';
  const tiles = Array.from({ length: 9 }, (_, index) => {
    const tile = element('BUTTON');
    const addClass = tile.classList.add;
    tile.classList.add = (...names) => {
      if (names.includes('active') && ids.get('phase-label').textContent === 'WATCH CLOSELY') flashes.push(index);
      addClass(...names);
    };
    tile.dataset.pad = String(index);
    return tile;
  });
  document = Object.assign(element(), {
    getElementById: id => {
      assert.ok(ids.has(id), 'Missing HTML element: ' + id);
      return ids.get(id);
    },
    querySelectorAll: () => tiles,
    activeElement: null,
  });
  const window = element();
  document.visibilityState = 'visible';
  document.body = { append(frame) { queueMicrotask(() => frame.onload()); } };
  document.createElement = (tag) => {
    const created = element(tag.toUpperCase());
    if (tag === 'iframe') created.contentWindow = {
      postMessage(message) {
        requests.push(message);
        const responses = {
          'startng:whoami': { type: 'startng:user', user: { id: 42, name: 'Test player' } },
          'startng:leaderboard': { type: 'startng:leaderboardData', ok: true, entries: [] },
          'startng:score': { type: 'startng:scoreSaved', ok: true, result: { improved: true, rank: 1 } },
        };
        const reply = () => window.dispatch('message', {
          origin: 'https://start.ng', source: created.contentWindow,
          data: { ...responses[message.type], requestId: message.requestId },
        });
        if (delayScore && message.type === 'startng:score') pendingScoreReply = reply;
        else queueMicrotask(reply);
      },
    };
    return created;
  };
  const context = vm.createContext({
    document, window, navigator: {}, URLSearchParams,
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [wallTime])); }
      static now() { return wallTime; }
    },
    location: { hostname: hosted ? 'echo-grid-dan.start.ng' : 'localhost', search: '' },
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    crypto: { getRandomValues(array) { array[0] = random[randomIndex++ % random.length]; } },
    localStorage: {
      getItem: key => { if (storageFails === true) throw Error('Storage blocked'); return storage.get(key) ?? null; },
      setItem: (key, value) => { if (storageFails) throw Error('Storage blocked'); storage.set(key, value); },
    },
    setTimeout(callback, ms) { const id = ++timerId; timers.set(id, { at: now + ms, callback }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(dailySource, context);
  vm.runInContext(source, context);
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  async function advance(ms) {
    const end = now + ms;
    while (true) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
      await flush();
    }
    now = end;
    await flush();
  }
  const field = id => ids.get(id);
  const phase = () => field('phase-label').textContent;
  async function until(label) {
    for (let i = 0; i < 100 && phase() !== label; i++) {
      const next = Math.min(...[...timers.values()].map(timer => timer.at));
      assert.ok(Number.isFinite(next), 'No pending timer before ' + label);
      await advance(next - now);
    }
    assert.equal(phase(), label);
  }
  async function start() { field('start-btn').click(); await until('YOUR TURN'); }
  async function startDaily() { field('daily-mode').click(); await start(); }
  async function endRun() {
    for (let i = 0; i < 3; i++) {
      tiles[8].click();
      await until(i === 2 ? 'RUN COMPLETE' : 'YOUR TURN');
    }
  }
  return { field, tiles, document, window, storage, flashes, requests, advance, until, start, startDaily, phase, endRun,
    setDate(value) { wallTime = new Date(value).valueOf(); },
    replyScore() { pendingScoreReply?.(); },
  };
}

test('rapid taps register immediately and round completion locks extra input', async () => {
  const g = game();
  await g.start();
  g.tiles[0].click();
  g.tiles[1].click();
  g.tiles[8].click();
  assert.equal(g.field('score').textContent, '000195');
  assert.equal(g.phase(), 'ROUND CLEAR');
  assert.equal(g.field('lives').attributes['aria-label'], '3 lives remaining');
  await g.until('YOUR TURN');
  assert.match(g.field('progress-label').innerHTML, /0 \/ 3/);
});

test('repeated tile feedback survives the earlier pulse timeout', async () => {
  const g = game({ random: [0, 0] });
  await g.start();
  g.tiles[0].click();
  await g.advance(100);
  g.tiles[0].click();
  await g.advance(80);
  assert.equal(g.tiles[0].classList.contains('active'), true);
  assert.equal(g.field('score').textContent, '000195');
  await g.advance(100);
  assert.equal(g.tiles[0].classList.contains('active'), false);
});

test('keyboard inputs accept a quick sequence but ignore held keys', async () => {
  const g = game();
  await g.start();
  const key = (value, repeat = false) => g.document.dispatch('keydown', { key: value, repeat, preventDefault() {} });
  key('1');
  key('1', true);
  key('2');
  assert.equal(g.field('score').textContent, '000195');
  assert.equal(g.phase(), 'ROUND CLEAR');
});

test('mistakes identify both tiles, cost one life, and replay the same round', async () => {
  const g = game();
  await g.start();
  g.tiles[8].click();
  g.tiles[8].click();
  assert.equal(g.tiles[8].classList.contains('wrong'), true);
  assert.equal(g.tiles[0].classList.contains('expected'), true);
  assert.match(g.field('status').textContent, /tapped 9.*Expected 1/);
  assert.equal(g.field('lives').attributes['aria-label'], '2 lives remaining');
  await g.until('YOUR TURN');
  assert.equal(g.tiles[8].classList.contains('wrong'), false);
  assert.equal(g.tiles[0].classList.contains('expected'), false);
  g.tiles[0].click();
  g.tiles[1].click();
  assert.equal(g.field('score').textContent, '000145');
});

test('restarting during mistake feedback cancels the old continuation', async () => {
  const g = game();
  await g.start();
  g.tiles[8].click();
  g.field('start-btn').click();
  assert.equal(g.tiles[8].classList.contains('wrong'), false);
  await g.until('YOUR TURN');
  assert.equal(g.field('lives').attributes['aria-label'], '3 lives remaining');
  g.tiles[2].click();
  g.tiles[3].click();
  assert.equal(g.field('score').textContent, '000195');
});

test('replay displays its actual cost, floors score at zero, and is single-use', async () => {
  const g = game();
  await g.start();
  assert.match(g.field('replay-btn').querySelector('small').textContent, /−0 PTS/);
  g.tiles[0].click();
  assert.match(g.field('replay-btn').querySelector('small').textContent, /−20 PTS/);
  g.field('replay-btn').click();
  assert.equal(g.field('score').textContent, '000000');
  assert.equal(g.field('replay-btn').disabled, true);
  await g.until('YOUR TURN');
  assert.equal(g.field('replay-btn').disabled, true);
  assert.equal(g.field('replay-btn').querySelector('small').textContent, 'USED');
  assert.match(g.field('progress-label').innerHTML, /0 \/ 2/);
  g.tiles[0].click();
  g.tiles[1].click();
  assert.equal(g.phase(), 'ROUND CLEAR');
});

test('end screen celebrates the final score after replay, with rounds and streak', async () => {
  const g = game({ best: 100 });
  await g.start();
  g.tiles[0].click();
  g.tiles[1].click();
  assert.equal(g.storage.get('echo-grid-best'), '100');
  await g.until('YOUR TURN');
  assert.match(g.field('replay-btn').querySelector('small').textContent, /−60 PTS/);
  g.field('replay-btn').click();
  await g.until('YOUR TURN');
  await g.endRun();
  assert.equal(g.storage.get('echo-grid-best'), '135');
  assert.equal(g.field('best').textContent, '000135');
  assert.equal(g.field('result-rounds').textContent, '1');
  assert.equal(g.field('result-streak').textContent, '2');
  assert.match(g.field('overlay-title').innerHTML, /000135/);
  assert.match(g.field('overlay-copy').textContent, /35 points above/);
  assert.equal(g.field('overlay').classList.contains('is-record'), true);
  assert.equal(g.document.activeElement, g.field('overlay-start'));
  g.field('overlay-start').click();
  assert.equal(g.field('run-results').hidden, true);
  assert.equal(g.field('overlay').classList.contains('is-record'), false);
  await g.until('YOUR TURN');
  assert.equal(g.field('score').textContent, '000000');
});

test('existing best is retained and the end screen gives the exact next-record target', async () => {
  const g = game({ best: 200 });
  await g.start();
  g.tiles[0].click();
  g.tiles[1].click();
  await g.until('YOUR TURN');
  await g.endRun();
  assert.equal(g.storage.get('echo-grid-best'), '200');
  assert.match(g.field('overlay-copy').textContent, /6 more points/);
  assert.equal(g.field('overlay').classList.contains('is-record'), false);
});

test('an unfinished run does not replace a completed personal best', async () => {
  const g = game({ best: 100 });
  await g.start();
  g.tiles[0].click();
  g.tiles[1].click();
  g.field('start-btn').click();
  await g.until('YOUR TURN');
  assert.equal(g.storage.get('echo-grid-best'), '100');
  assert.equal(g.field('score').textContent, '000000');
});

const dailyKey = day => 'echo-grid-daily-v1:' + day;
const dailyRecord = (g, day = '2026-10-18') => JSON.parse(g.storage.get(dailyKey(day)));
const repeatPattern = g => { for (const tile of g.flashes.slice(-2)) g.tiles[tile].click(); };

test('daily patterns agree across players and timezone offsets on the same UTC date', async () => {
  const a = game({ date: '2026-10-18T23:30:00Z' });
  const b = game({ date: '2026-10-19T00:30:00+01:00', random: [8, 7, 6] });
  const tomorrow = game({ date: '2026-10-19T00:00:00Z' });
  await a.startDaily();
  await b.startDaily();
  await tomorrow.startDaily();
  assert.deepEqual(a.flashes, b.flashes);
  assert.notDeepEqual(a.flashes, tomorrow.flashes);
  assert.match(b.field('daily-date').textContent, /2026-10-18/);
});

test('daily result persists separately and practice cannot overwrite it or the classic best', async () => {
  const g = game({ best: 100 });
  await g.startDaily();
  repeatPattern(g);
  g.field('start-btn').click(); // End the saved attempt, even between rounds.
  assert.equal(g.phase(), 'RUN COMPLETE');
  assert.equal(dailyRecord(g).score, 195);
  assert.equal(dailyRecord(g).rounds, 1);
  assert.equal(dailyRecord(g).streak, 2);
  assert.equal(g.storage.get('echo-grid-best'), '100');
  assert.equal(g.field('best').textContent, '000195');
  assert.match(g.field('overlay-copy').textContent, /saved in this browser/);
  const saved = g.storage.get(dailyKey('2026-10-18'));
  await g.start();
  assert.match(g.field('run-mode').textContent, /DAILY PRACTICE/);
  for (let i = 0; i < 3; i++) {
    const expected = g.flashes.at(-2);
    g.tiles[(expected + 1) % 9].click();
    await g.until(i === 2 ? 'RUN COMPLETE' : 'YOUR TURN');
  }
  assert.equal(g.storage.get(dailyKey('2026-10-18')), saved);
  assert.equal(g.storage.get('echo-grid-best'), '100');
  assert.match(g.field('overlay-kicker').textContent, /PRACTICE/);
});

test('refreshing an unfinished daily attempt allows practice only', async () => {
  const original = game();
  await original.startDaily();
  assert.equal(dailyRecord(original).status, 'started');
  const reloaded = game({ storage: original.storage });
  await reloaded.startDaily();
  assert.match(reloaded.field('run-mode').textContent, /PRACTICE/);
  assert.deepEqual(reloaded.flashes, original.flashes);
  assert.equal(dailyRecord(original).status, 'started');
});

test('a second open tab checks storage at start instead of granting another saved attempt', async () => {
  const first = game();
  const second = game({ storage: first.storage });
  second.field('daily-mode').click();
  await first.startDaily();
  await second.start();
  assert.match(second.field('run-mode').textContent, /PRACTICE/);
});

test('switching to Classic ends the daily attempt and restores normal scoring', async () => {
  const g = game({ best: 10 });
  await g.startDaily();
  g.tiles[g.flashes[0]].click();
  g.field('classic-mode').click();
  assert.equal(dailyRecord(g).score, 20);
  assert.equal(g.field('best').textContent, '000010');
  assert.equal(g.field('daily-panel').hidden, true);
  await g.start();
  assert.deepEqual(g.flashes.slice(-2), [0, 1]);
  g.tiles[0].click();
  g.tiles[1].click();
  await g.until('YOUR TURN');
  await g.endRun();
  assert.equal(g.storage.get('echo-grid-best'), '195');
  assert.equal(dailyRecord(g).score, 20);
});

test('midnight preserves an active challenge and unlocks the next date afterward', async () => {
  const g = game({ date: '2026-10-18T23:59:58Z' });
  const reference = game();
  await g.startDaily();
  await reference.startDaily();
  g.setDate('2026-10-19T00:00:01Z');
  repeatPattern(g);
  repeatPattern(reference);
  await g.until('YOUR TURN');
  await reference.until('YOUR TURN');
  assert.deepEqual(g.flashes, reference.flashes);
  assert.match(g.field('run-mode').textContent, /2026-10-18/);
  g.field('start-btn').click();
  assert.equal(dailyRecord(g, '2026-10-18').score, 195);
  assert.equal(g.storage.has(dailyKey('2026-10-19')), false);
  assert.match(g.field('overlay-start').innerHTML, /START DAILY/);
  await g.start();
  assert.equal(dailyRecord(g, '2026-10-19').status, 'started');
  assert.match(g.field('run-mode').textContent, /2026-10-19 · DAILY CHALLENGE/);
});

test('returning to an idle tab refreshes the UTC date', async () => {
  const g = game();
  g.field('daily-mode').click();
  g.setDate('2026-10-19T00:00:01Z');
  g.window.dispatch('focus');
  assert.match(g.field('daily-date').textContent, /2026-10-19/);
});

test('storage failures keep Daily playable as clearly labelled practice', async () => {
  const g = game({ storageFails: true });
  await g.startDaily();
  assert.match(g.field('run-mode').textContent, /PRACTICE/);
  assert.match(g.field('daily-state').textContent, /storage is unavailable/);
  repeatPattern(g);
  assert.equal(g.field('score').textContent, '000195');
  assert.equal(g.storage.has(dailyKey('2026-10-18')), false);
});

test('unreadable daily data never grants another saved attempt', async () => {
  const storage = new Map([[dailyKey('2026-10-18'), '{broken']]);
  const g = game({ storage });
  await g.startDaily();
  assert.match(g.field('run-mode').textContent, /PRACTICE/);
  assert.equal(storage.get(dailyKey('2026-10-18')), '{broken');
});

test('a storage quota failure before playback downgrades the attempt to practice', async () => {
  const g = game({ storageFails: 'write' });
  await g.startDaily();
  assert.match(g.field('run-mode').textContent, /PRACTICE/);
  assert.match(g.field('daily-state').textContent, /storage is unavailable/);
  assert.equal(g.storage.has(dailyKey('2026-10-18')), false);
});

test('a zero-score daily attempt is still used after reload', async () => {
  const g = game();
  await g.startDaily();
  g.field('start-btn').click();
  assert.equal(dailyRecord(g).score, 0);
  const reloaded = game({ storage: g.storage });
  await reloaded.startDaily();
  assert.match(reloaded.field('run-mode').textContent, /PRACTICE/);
});

test('daily completion does not submit to start.ng even for a signed-in player', async () => {
  const g = game({ hosted: true });
  await g.advance(0);
  assert.equal(g.field('player-name').textContent, 'Test player');
  await g.startDaily();
  repeatPattern(g);
  g.field('start-btn').click();
  await g.advance(0);
  assert.equal(g.requests.filter(request => request.type === 'startng:score').length, 0);
});

test('Classic retains the existing score contract and late replies cannot replace daily messages', async () => {
  const g = game({ hosted: true, delayScore: true });
  await g.advance(0);
  await g.start();
  g.tiles[0].click();
  g.tiles[1].click();
  await g.until('YOUR TURN');
  await g.endRun();
  const sent = g.requests.find(request => request.type === 'startng:score');
  assert.ok(sent);
  assert.deepEqual(JSON.parse(JSON.stringify(sent.stats)), { score: 195, rounds: 1, streak: 2 });
  g.field('daily-mode').click();
  const message = g.field('status').textContent;
  g.replyScore();
  await g.advance(0);
  assert.equal(g.field('status').textContent, message);
});

test('ending a daily run cancels pending playback and next-round timers', async () => {
  const duringPlayback = game();
  duringPlayback.field('daily-mode').click();
  duringPlayback.field('start-btn').click();
  duringPlayback.field('start-btn').click();
  await duringPlayback.advance(5000);
  assert.equal(duringPlayback.phase(), 'RUN COMPLETE');
  assert.equal(duringPlayback.field('overlay').hidden, false);
  assert.equal(dailyRecord(duringPlayback).score, 0);

  const betweenRounds = game();
  await betweenRounds.startDaily();
  repeatPattern(betweenRounds);
  betweenRounds.field('start-btn').click();
  await betweenRounds.advance(5000);
  assert.equal(betweenRounds.phase(), 'RUN COMPLETE');
  assert.equal(betweenRounds.field('overlay').hidden, false);
  assert.equal(dailyRecord(betweenRounds).score, 195);
});
