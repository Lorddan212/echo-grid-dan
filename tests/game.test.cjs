const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8');
const dailySource = fs.readFileSync(path.join(__dirname, '../daily.js'), 'utf8');
const progressSource = fs.readFileSync(path.join(__dirname, '../progress.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

// Run the shipped script through its public click/key handlers without dependencies.
function game({ random = [0, 1, 2, 3], best = 0, storage: suppliedStorage, date = '2026-10-18T12:00:00Z', storageFails = false, hosted = false, delayScore = false, clipboard, search = '', hash = '', rankings, speech = false } = {}) {
  const timers = new Map();
  const storage = suppliedStorage || new Map([['echo-grid-best-v2-standard', String(best)]]);
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
      textContent: '', innerHTML: '', value: '', attributes: {},
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
      select() { this.selectionStart = 0; this.selectionEnd = this.value.length; },
    };
  }
  const ids = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], element()]));
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    ids.get(match[1]).hidden = /\shidden(?:\s|>)/.test(match[0]);
  }
  for (const id of ['overlay-start', 'start-btn', 'replay-btn', 'sound-btn', 'copy-result']) ids.get(id).tagName = 'BUTTON';
  ids.get('share-text').tagName = 'TEXTAREA';
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
  document.body = Object.assign(element(), { append(frame) { queueMicrotask(() => frame.onload()); } });
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
    document, window, navigator: { clipboard }, URLSearchParams,
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [wallTime])); }
      static now() { return wallTime; }
    },
    location: {
      hostname: hosted ? 'echo-grid-dan.start.ng' : 'localhost',
      origin: hosted ? 'https://echo-grid-dan.start.ng' : 'http://localhost:8000',
      pathname: '/', search, hash,
    },
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
  for (const file of ['rules.js', 'speech.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  context.EchoRankings = rankings || { enabled: false, signedIn: false };
  if (speech) context.EchoSpeech = { create: () => ({ supported: true, speak: async () => true, cancel() {} }) };
  vm.runInContext(dailySource, context);
  vm.runInContext(progressSource, context);
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
    now: () => now,
    setDate(value) { wallTime = new Date(value).valueOf(); },
    replyScore() { pendingScoreReply?.(); },
  };
}

function chooseSpeed(g, speed) {
  g.field('difficulty').value = speed;
  g.field('difficulty').dispatch('change');
}

test('Classic speeds change playback timing while retaining scoring and lock during a run', async () => {
  for (const [speed, duration] of [['relaxed', 3110], ['standard', 2280], ['fast', 1866]]) {
    const g = game();
    chooseSpeed(g, speed);
    await g.start();
    assert.equal(g.now(), duration, speed);
    assert.equal(g.field('difficulty').disabled, true);
    chooseSpeed(g, speed === 'fast' ? 'relaxed' : 'fast');
    assert.equal(g.field('difficulty').value, speed);
    g.tiles[0].click();
    g.tiles[1].click();
    assert.equal(g.field('score').textContent, '000195');
  }
});

test('Fast retains the original minimum flash and gap durations in later rounds', async () => {
  const g = game({ random: [0] });
  chooseSpeed(g, 'fast');
  await g.start();
  for (let round = 0; round < 18; round++) {
    for (let tile = 0; tile < round + 2; tile++) g.tiles[0].click();
    const finishedAt = g.now();
    await g.until('YOUR TURN');
    if (round === 17) assert.equal(g.now() - finishedAt, 1100 + 620 + 20 * (225 + 110));
  }
});

test('nonstandard Classic scores use separate records and never submit to the ranked board', async () => {
  const storage = new Map([['echo-grid-best-v2-standard', '50']]);
  for (const speed of ['relaxed', 'fast']) {
    const g = game({ storage, hosted: true });
    chooseSpeed(g, speed);
    await g.start();
    g.tiles[0].click();
    g.tiles[1].click();
    await g.until('YOUR TURN');
    await g.endRun();
    assert.equal(storage.get('echo-grid-best-v2-' + speed), '195');
    assert.equal(storage.get('echo-grid-best-v2-standard'), '50');
    assert.equal(g.requests.filter(r => r.type === 'startng:score').length, 0);
    assert.match(g.field('share-text').value, new RegExp('Classic · ' + (speed === 'fast' ? 'Fast' : 'Relaxed')));
    assert.equal(g.field('difficulty').disabled, false);
    chooseSpeed(g, 'standard');
    assert.equal(g.field('share-panel').hidden, true);
    assert.equal(g.phase(), 'SYSTEM READY');
    assert.equal(g.field('best').textContent, '000050');
    chooseSpeed(g, speed);
    assert.equal(g.field('best').textContent, '000195');
  }
});

test('Daily and Daily Practice keep standard timing and restore the chosen Classic speed', async () => {
  const g = game();
  chooseSpeed(g, 'relaxed');
  await g.startDaily();
  assert.equal(g.now(), 2280);
  assert.equal(g.field('difficulty').value, 'standard');
  assert.equal(g.field('difficulty').disabled, true);
  chooseSpeed(g, 'fast');
  assert.equal(g.field('difficulty').value, 'standard');
  g.field('start-btn').click();
  await g.until('RUN COMPLETE');
  const before = g.now();
  await g.start();
  assert.equal(g.now() - before, 2280);
  assert.match(g.field('run-mode').textContent, /DAILY PRACTICE/);
  g.field('classic-mode').click();
  assert.equal(g.field('difficulty').value, 'relaxed');
  const classicStart = g.now();
  await g.start();
  assert.equal(g.now() - classicStart, 3110);
});

test('speed, sound and reduced-motion preferences survive reload without starting a run', async () => {
  const storage = new Map();
  const g = game({ storage });
  chooseSpeed(g, 'fast');
  g.field('sound-btn').click();
  g.field('motion-btn').click();
  const reloaded = game({ storage });
  assert.equal(reloaded.field('difficulty').value, 'fast');
  assert.equal(reloaded.field('sound-btn').attributes['aria-pressed'], 'false');
  assert.equal(reloaded.field('motion-btn').attributes['aria-pressed'], 'true');
  assert.equal(reloaded.document.body.classList.contains('reduce-motion'), true);
  assert.equal(reloaded.phase(), 'SYSTEM READY');
  await reloaded.start();
  reloaded.field('motion-btn').click();
  assert.equal(reloaded.document.body.classList.contains('reduce-motion'), false);
  assert.equal(reloaded.phase(), 'YOUR TURN');
});

test('invalid or unavailable preference storage keeps defaults and controls usable', async () => {
  for (const saved of ['{invalid', 'null', '{"difficulty":"unknown","sound":"false","reduceMotion":"true"}']) {
    const g = game({ storage: new Map([['echo-grid-preferences-v1', saved]]) });
    assert.equal(g.field('difficulty').value, 'standard');
    assert.equal(g.field('sound-btn').attributes['aria-pressed'], 'true');
    assert.equal(g.field('motion-btn').attributes['aria-pressed'], 'false');
  }
  const g = game({ storageFails: true });
  chooseSpeed(g, 'relaxed');
  g.field('sound-btn').click();
  g.field('motion-btn').click();
  await g.start();
  assert.equal(g.now(), 3110);
  assert.equal(g.field('sound-btn').attributes['aria-pressed'], 'false');
  assert.equal(g.document.body.classList.contains('reduce-motion'), true);
});

test('a completed run preserves a higher best already saved by another tab', async () => {
  for (const speed of ['standard', 'relaxed', 'fast']) {
    const storage = new Map();
    const g = game({ storage });
    chooseSpeed(g, speed);
    await g.start();
    g.tiles[0].click();
    g.tiles[1].click();
    await g.until('YOUR TURN');
    const key = speed === 'standard' ? 'echo-grid-best-v2-standard' : 'echo-grid-best-v2-' + speed;
    storage.set(key, '1000');
    await g.endRun();
    assert.equal(storage.get(key), '1000', speed);
    assert.equal(g.field('best').textContent, '001000');
    assert.equal(g.field('overlay').classList.contains('is-record'), false);
    assert.match(g.field('overlay-copy').textContent, /806 more points/);
  }
});

test('invalid Classic records are ignored instead of displaying unsafe or partial numbers', () => {
  for (const value of ['900points', '1.5', '-40', 'Infinity', '9'.repeat(400), '9007199254740992']) {
    const g = game({ storage: new Map([['echo-grid-best-v2-standard', value]]) });
    assert.equal(g.field('best').textContent, '000000', value);
  }
});

test('blocked storage keeps separate session bests and does not claim they were saved', async () => {
  const g = game({ storageFails: true });
  for (const speed of ['standard', 'relaxed', 'fast']) {
    chooseSpeed(g, speed);
    await g.start();
    // This fixture cycles the same initial pair for each two-tile start.
    const pattern = g.flashes.slice(-2);
    pattern.forEach(index => g.tiles[index].click());
    await g.until('YOUR TURN');
    await g.endRun();
    assert.match(g.field('status').textContent, /could not be saved/i);
    assert.equal(g.field('best').textContent, '000195');
  }
  for (const speed of ['standard', 'relaxed', 'fast']) {
    chooseSpeed(g, speed);
    assert.equal(g.field('best').textContent, '000195', speed);
  }
});

test('idle tabs refresh their displayed best after a storage event', () => {
  const storage = new Map();
  const g = game({ storage });
  storage.set('echo-grid-best-v2-standard', '600');
  g.window.dispatch('storage');
  assert.equal(g.field('best').textContent, '000600');
});

const progressKey = 'echo-grid-progress-v1';
const progressOf = g => JSON.parse(g.storage.get(progressKey)).modes;

test('progress records completed runs once and persists without re-announcing old achievements', async () => {
  const storage = new Map([['echo-grid-best-v2-standard', '9000']]);
  const g = game({ storage });
  assert.equal(g.field('stats-runs').textContent, '0');
  assert.equal(g.field('achievement-count').textContent, '0 / 6');
  await g.start();
  g.tiles[0].click();
  g.tiles[1].click();
  await g.until('YOUR TURN');
  await g.endRun();
  assert.deepEqual(progressOf(g).standard, { runs: 1, rounds: 1, bestRounds: 1, bestStreak: 2 });
  assert.equal(g.field('stats-runs').textContent, '1');
  assert.equal(g.field('stats-rounds').textContent, '1');
  assert.match(g.field('achievement-notice').textContent, /First Signal/);
  await g.advance(5000);
  assert.equal(progressOf(g).standard.runs, 1);
  const reloaded = game({ storage });
  assert.equal(reloaded.field('stats-runs').textContent, '1');
  assert.equal(reloaded.field('achievement-notice').hidden, true);
  assert.equal(reloaded.field('achievement-count').textContent, '1 / 6');
});

test('restarting or switching away from unfinished Classic play does not count a run', async () => {
  const g = game();
  await g.start();
  g.tiles[0].click();
  g.field('start-btn').click();
  await g.until('YOUR TURN');
  g.field('daily-mode').click();
  assert.equal(g.storage.has(progressKey), false);
  assert.equal(g.field('stats-runs').textContent, '0');
});

test('all Classic speeds have separate progress, and viewing stats cannot change gameplay', async () => {
  const g = game();
  for (const speed of ['standard', 'relaxed', 'fast']) {
    chooseSpeed(g, speed);
    await g.start();
    await g.endRun();
    assert.equal(progressOf(g)[speed].runs, 1);
  }
  g.field('stats-mode').value = 'relaxed';
  g.field('stats-mode').dispatch('change');
  assert.equal(g.field('stats-runs').textContent, '1');
  assert.equal(g.field('difficulty').value, 'fast');
  assert.equal(g.phase(), 'RUN COMPLETE');
});

test('Daily mode-switch endings count once; Daily Practice has separate stats', async () => {
  const g = game();
  await g.startDaily();
  g.field('classic-mode').click();
  assert.equal(progressOf(g).daily.runs, 1);
  await g.advance(10000);
  assert.equal(progressOf(g).daily.runs, 1);
  await g.startDaily();
  // Use an observed wrong first tile regardless of the date-seeded sequence.
  const wrong = (g.flashes.at(-2) + 1) % 9;
  for (let i = 0; i < 3; i++) {
    g.tiles[wrong].click();
    await g.until(i === 2 ? 'RUN COMPLETE' : 'YOUR TURN');
  }
  assert.equal(progressOf(g).practice.runs, 1);
  assert.equal(progressOf(g).daily.runs, 1);
  g.field('stats-mode').value = 'practice';
  g.field('stats-mode').dispatch('change');
  assert.equal(g.field('stats-runs').textContent, '1');
});

test('round and streak milestones unlock on completion and are not announced twice', async () => {
  const g = game({ random: [0] });
  await g.start();
  for (let round = 0; round < 10; round++) {
    for (let tile = 0; tile < round + 2; tile++) g.tiles[0].click();
    await g.until('YOUR TURN');
  }
  assert.equal(g.field('achievement-count').textContent, '0 / 6');
  await g.endRun();
  assert.equal(g.field('achievement-count').textContent, '4 / 6');
  assert.match(g.field('achievement-notice').textContent, /Finding Rhythm/);
  assert.match(g.field('achievement-notice').textContent, /Pattern Master/);
  assert.match(g.field('achievement-notice').textContent, /In the Zone/);
  assert.equal(progressOf(g).standard.bestRounds, 10);
  assert.equal(progressOf(g).standard.bestStreak, 65);
  await g.start();
  await g.endRun();
  assert.equal(g.field('achievement-notice').hidden, true);
});

test('blocked progress storage keeps useful session stats without claiming persistence', async () => {
  const g = game({ storageFails: true });
  await g.start();
  await g.endRun();
  assert.equal(g.field('stats-runs').textContent, '1');
  assert.match(g.field('progress-storage').textContent, /could not be saved or read/);
  assert.equal(g.storage.has(progressKey), false);
  assert.equal(g.field('achievement-count').textContent, '1 / 6');
});

test('corrupt progress is preserved on disk and does not break the game', async () => {
  for (const raw of ['{broken', '{"version":2,"modes":{}}', '{"version":1,"modes":{"standard":{"runs":-1}}}']) {
    const storage = new Map([[progressKey, raw]]);
    const g = game({ storage });
    await g.start();
    await g.endRun();
    assert.equal(g.field('stats-runs').textContent, '1');
    assert.equal(storage.get(progressKey), raw);
    assert.match(g.field('progress-storage').textContent, /could not be saved or read/);
  }
});

test('progress quota failure retains saved history and adds new session-only progress', async () => {
  const storage = new Map();
  const first = game({ storage });
  await first.start();
  await first.endRun();
  const next = game({ storage, storageFails: 'writes' });
  await next.start();
  await next.endRun();
  assert.equal(next.field('stats-runs').textContent, '2');
  assert.equal(progressOf(next).standard.runs, 1);
  assert.match(next.field('progress-storage').textContent, /could not be saved or read/);
});

test('progress re-reads another tab before counting the next completed run', async () => {
  const storage = new Map();
  const first = game({ storage });
  const second = game({ storage });
  await first.start();
  await second.start();
  await first.endRun();
  await second.endRun();
  assert.equal(progressOf(second).standard.runs, 2);
  first.window.dispatch('storage');
  assert.equal(first.field('stats-runs').textContent, '2');
});

test('regular and daily milestones count distinct completed attempts, not practice as Daily', async () => {
  const g = game({ random: [0] });
  for (let i = 0; i < 10; i++) { await g.start(); await g.endRun(); }
  assert.match(g.field('achievement-notice').textContent, /One More Run/);
  for (const day of ['2026-10-18', '2026-10-19', '2026-10-20']) {
    g.setDate(day + 'T12:00:00Z');
    await g.startDaily();
    g.field('start-btn').click();
    await g.until('RUN COMPLETE');
  }
  assert.match(g.field('achievement-notice').textContent, /Daily Explorer/);
  assert.equal(progressOf(g).daily.runs, 3);
  assert.equal(progressOf(g).practice.runs, 0);
});

test('Enter on achievement summaries and links does not start or restart gameplay', async () => {
  const g = game();
  for (const tagName of ['SUMMARY', 'A', 'SELECT', 'BUTTON']) {
    g.document.activeElement = { tagName };
    g.document.dispatch('keydown', { key: 'Enter' });
    assert.equal(g.phase(), 'SYSTEM READY', tagName);
  }
  g.document.activeElement = { tagName: 'BODY' };
  g.document.dispatch('keydown', { key: 'Enter' });
  await g.until('YOUR TURN');
  await g.endRun();
  g.document.activeElement = { tagName: 'SUMMARY' };
  g.document.dispatch('keydown', { key: 'Enter' });
  assert.equal(g.phase(), 'RUN COMPLETE');
});

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
  assert.equal(g.storage.get('echo-grid-best-v2-standard'), '100');
  await g.until('YOUR TURN');
  assert.match(g.field('replay-btn').querySelector('small').textContent, /−60 PTS/);
  g.field('replay-btn').click();
  await g.until('YOUR TURN');
  await g.endRun();
  assert.equal(g.storage.get('echo-grid-best-v2-standard'), '135');
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
  assert.equal(g.storage.get('echo-grid-best-v2-standard'), '200');
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
  assert.equal(g.storage.get('echo-grid-best-v2-standard'), '100');
  assert.equal(g.field('score').textContent, '000000');
});

const dailyKey = day => 'echo-grid-daily-v2:' + day;
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
  assert.equal(g.storage.get('echo-grid-best-v2-standard'), '100');
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
  assert.equal(g.storage.get('echo-grid-best-v2-standard'), '100');
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
  assert.equal(g.storage.get('echo-grid-best-v2-standard'), '195');
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

test('season 2 Classic never uploads into the legacy start.ng board', async () => {
  const g = game({ hosted: true });
  await g.advance(0);
  await classicResult(g);
  assert.equal(g.requests.filter(request => request.type === 'startng:score').length, 0);
  assert.match(g.field('rank-status').textContent, /not connected/);
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

async function classicResult(g) {
  await g.start();
  g.tiles[0].click();
  g.tiles[1].click();
  await g.until('YOUR TURN');
  await g.endRun();
}

test('sharing is explicit and copies a completed Classic result with a clean public link', async () => {
  const copied = [];
  const g = game({ hosted: true, clipboard: { writeText: async text => copied.push(text) },
    search: '?guest&tracking=private', hash: '#startng_session=private-session' });
  assert.equal(g.field('share-panel').hidden, true);
  await g.field('copy-result').click();
  assert.equal(copied.length, 0);
  await classicResult(g);
  assert.equal(copied.length, 0);
  assert.equal(g.field('share-panel').hidden, false);
  await g.field('copy-result').click();
  assert.equal(copied[0], [
    'Echo Grid · Classic · Season 2', '195 points · 1 round cleared', 'Longest streak: 2',
    'Can you beat my score?', 'https://echo-grid-dan.start.ng/',
  ].join('\n'));
  assert.doesNotMatch(copied[0], /private|startng_session|tracking|Test player/);
  assert.match(g.field('share-status').textContent, /Result copied/);
});

test('shared scores include Replay deductions instead of the stored personal best', async () => {
  const g = game({ best: 1000 });
  await g.start();
  g.tiles[0].click();
  g.tiles[1].click();
  await g.until('YOUR TURN');
  g.field('replay-btn').click();
  await g.until('YOUR TURN');
  await g.endRun();
  assert.match(g.field('share-text').value, /135 points/);
  assert.doesNotMatch(g.field('share-text').value, /1,000|localhost|http:|file:/);
});

test('daily sharing pins the result date across midnight and links to today’s mode', async () => {
  const g = game({ hosted: true, date: '2026-10-18T23:59:59Z' });
  await g.startDaily();
  repeatPattern(g);
  g.setDate('2026-10-19T00:00:01Z');
  g.field('start-btn').click();
  const result = g.field('share-text').value;
  assert.match(result, /Daily Challenge · 2026-10-18 \(UTC\)/);
  assert.match(result, /195 points · 1 round cleared/);
  assert.match(result, /Play today’s daily challenge:\nhttps:\/\/echo-grid-dan.start.ng\/\?mode=daily$/);
  g.window.dispatch('focus');
  await g.advance(60000);
  assert.equal(g.field('share-text').value, result);
});

test('practice sharing is clearly labelled and does not copy the saved attempt’s score', async () => {
  const g = game();
  await g.startDaily();
  repeatPattern(g);
  g.field('start-btn').click();
  await g.start();
  for (let i = 0; i < 3; i++) {
    g.tiles[(g.flashes.at(-2) + 1) % 9].click();
    await g.until(i === 2 ? 'RUN COMPLETE' : 'YOUR TURN');
  }
  assert.match(g.field('share-text').value, /Daily Practice · 2026-10-18 \(UTC\)/);
  assert.match(g.field('share-text').value, /0 points · 0 rounds cleared/);
  assert.equal(dailyRecord(g).score, 195);
});

test('missing clipboard selects the result for manual copying without restarting on Enter', async () => {
  const g = game();
  await classicResult(g);
  await g.field('copy-result').click();
  assert.equal(g.document.activeElement, g.field('share-text'));
  assert.equal(g.field('share-text').selectionEnd, g.field('share-text').value.length);
  assert.match(g.field('share-status').textContent, /Automatic copy is unavailable/);
  assert.equal(g.field('copy-result').disabled, false);
  g.document.dispatch('keydown', { key: 'Enter' });
  assert.equal(g.phase(), 'RUN COMPLETE');
});

test('clipboard denial provides manual copying and allows a successful retry', async () => {
  let deny = true;
  const g = game({ clipboard: { writeText: async () => { if (deny) throw Error('NotAllowedError'); } } });
  await classicResult(g);
  await g.field('copy-result').click();
  assert.match(g.field('share-status').textContent, /Automatic copy is unavailable/);
  deny = false;
  await g.field('copy-result').click();
  assert.match(g.field('share-status').textContent, /Result copied/);
});

test('a pending copy cannot restore old feedback after a mode switch', async () => {
  let rejectCopy;
  let calls = 0;
  const g = game({ clipboard: { writeText: () => {
    calls++;
    return new Promise((resolve, reject) => { rejectCopy = reject; });
  } } });
  await classicResult(g);
  const pending = g.field('copy-result').click();
  g.field('copy-result').click();
  assert.equal(calls, 1);
  assert.equal(g.field('copy-result').disabled, true);
  g.field('daily-mode').click();
  rejectCopy(Error('Late rejection'));
  await pending;
  assert.equal(g.field('share-panel').hidden, true);
  assert.equal(g.field('share-text').value, '');
  assert.equal(g.field('share-status').textContent, '');
  assert.notEqual(g.document.activeElement, g.field('share-text'));
  assert.equal(g.field('copy-result').disabled, false);
});

test('restarting clears a finished result and active runs cannot be copied', async () => {
  const copied = [];
  const g = game({ clipboard: { writeText: async text => copied.push(text) } });
  await classicResult(g);
  await g.start();
  await g.field('copy-result').click();
  assert.equal(g.field('share-panel').hidden, true);
  assert.equal(g.field('share-text').value, '');
  assert.equal(copied.length, 0);
});

test('daily links select today’s challenge without reserving an attempt or trusting a supplied date', async () => {
  const g = game({ search: '?mode=daily&date=2000-01-01' });
  assert.equal(g.field('daily-panel').hidden, false);
  assert.equal(g.phase(), 'SYSTEM READY');
  assert.match(g.field('daily-date').textContent, /2026-10-18/);
  assert.equal(g.storage.has(dailyKey('2026-10-18')), false);
  await g.start();
  assert.match(g.field('run-mode').textContent, /2026-10-18 · DAILY CHALLENGE/);
});

test('unrecognised shared modes leave the game in Classic', () => {
  const g = game({ search: '?mode=unknown' });
  assert.equal(g.field('daily-panel').hidden, true);
  assert.match(g.field('run-mode').textContent, /CLASSIC/);
  assert.equal(g.phase(), 'SYSTEM READY');
});

test('mistake and Replay prefixes earn points only once per round', async () => {
  for (const replay of [false, true]) {
    const g = game();
    await g.start();
    g.tiles[0].click();
    if (replay) g.field('replay-btn').click();
    else g.tiles[8].click();
    await g.until('YOUR TURN');
    const before = g.field('score').textContent;
    g.tiles[0].click();
    assert.equal(g.field('score').textContent, before);
    g.tiles[1].click();
    assert.equal(g.field('score').textContent, replay ? '000175' : '000145');
  }
});

test('legacy records remain visible and are never imported into the new season', async () => {
  const storage = new Map([['echo-grid-best', '9000'], ['echo-grid-daily-v1:2026-10-18', '{"old":true}']]);
  const g = game({ storage });
  assert.equal(g.field('best').textContent, '000000');
  assert.equal(g.field('previous-best').hidden, false);
  assert.match(g.field('previous-best').textContent, /9,000/);
  await classicResult(g);
  assert.equal(storage.get('echo-grid-best'), '9000');
  assert.equal(storage.get('echo-grid-best-v2-standard'), '195');
  assert.equal(storage.get('echo-grid-daily-v1:2026-10-18'), '{"old":true}');
});

test('explicit Daily practice has adjustable speed and leaves the saved attempt available', async () => {
  const g = game();
  g.field('daily-mode').click();
  g.field('practice-only').checked = true;
  g.field('practice-only').dispatch('change');
  chooseSpeed(g, 'relaxed');
  await g.start();
  assert.equal(g.now(), 3110);
  assert.equal(g.storage.has(dailyKey('2026-10-18')), false);
  g.field('classic-mode').click();
  g.field('daily-mode').click();
  g.field('practice-only').checked = false;
  g.field('practice-only').dispatch('change');
  assert.equal(g.field('difficulty').value, 'standard');
  await g.start();
  assert.match(g.field('run-mode').textContent, /DAILY CHALLENGE/);
});

test('spoken playback uses separate practice records and never reserves a shared attempt', async () => {
  let starts = 0;
  const g = game({ speech: true, rankings: {
    enabled: true, signedIn: true, daily: async () => ({ day: '2026-10-18', attempt: null }),
    board: async () => ({ entries: [] }), start: async () => { starts++; throw Error('Unexpected'); },
  } });
  g.field('speech-btn').click();
  await classicResult(g);
  assert.equal(starts, 0);
  assert.equal(g.storage.get('echo-grid-best-v2-standard-spoken'), '195');
  assert.equal(progressOf(g).practice.runs, 1);
  assert.match(g.field('share-text').value, /Spoken practice/);
  await g.startDaily();
  assert.equal(g.storage.has(dailyKey('2026-10-18')), false);
  assert.match(g.field('run-mode').textContent, /PRACTICE/);
});

test('failed shared uploads can retry after a mode switch without changing game messages', async () => {
  let failures = true;
  const uploaded = [];
  const g = game({ rankings: {
    enabled: true, signedIn: true, daily: async () => ({ day: '2026-10-18', attempt: null }),
    board: async () => ({ entries: [] }),
    start: async () => ({ id: 'shared-daily', mode: 'daily', day: '2026-10-18', seed: 'daily:2026-10-18' }),
    finish: async (id, events) => { uploaded.push({ id, events }); if (failures) throw Error('offline'); },
  } });
  await g.advance(0);
  await g.startDaily();
  repeatPattern(g);
  g.field('classic-mode').click();
  await g.advance(0);
  assert.equal(g.field('retry-score').hidden, false);
  assert.equal(g.phase(), 'SYSTEM READY');
  const message = g.field('status').textContent;
  failures = false;
  g.field('retry-score').click();
  await g.advance(0);
  assert.equal(uploaded.length, 2);
  assert.deepEqual(uploaded[0], uploaded[1]);
  assert.equal(g.field('retry-score').hidden, true);
  assert.equal(g.field('status').textContent, message);
});
