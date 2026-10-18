/* Echo Grid: static, dependency-free memory game for start.ng. */
'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const tiles = [...document.querySelectorAll('.pad')];
  const fields = {
    score: $('score'), round: $('round'), lives: $('lives'), best: $('best'),
    progress: $('progress-fill'), progressLabel: $('progress-label'),
    phase: $('phase-label'), phaseDot: $('signal-dot'), status: $('status'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayKicker: $('overlay-kicker'),
    overlayCopy: $('overlay-copy'), overlayStart: $('overlay-start'),
    start: $('start-btn'), replay: $('replay-btn'), sound: $('sound-btn'),
    name: $('player-name'), account: $('player-account'), face: $('player-face'),
    fallback: $('fallback-face'), signin: $('sign-in'), leaders: $('leaderboard')
  };

  const NOTES = [261.63, 293.66, 329.63, 349.23, 392.0, 440, 493.88, 523.25, 587.33];
  const START_NG = 'https://start.ng';
  const HOSTED = location.hostname.endsWith('.start.ng');
  const GUEST_MODE = new URLSearchParams(location.search).has('guest');
  const GAME = HOSTED ? location.hostname.split('.')[0] : 'echo-grid';
  let framePromise = null;
  let signedInPlayer = null;
  let currentPlayerId = null;
  let audioContext = null;
  let soundOn = true;
  let epoch = 0;
  let sequence = [];
  let cursor = 0;
  let score = 0;
  let completed = 0;
  let lives = 3;
  let streak = 0;
  let bestStreak = 0;
  let replayAvailable = true;
  let phase = 'idle'; // idle, showing, input, between, over

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const randomTile = () => {
    if (globalThis.crypto && typeof crypto.getRandomValues === 'function') {
      const a = new Uint32Array(1);
      const limit = Math.floor(4294967296 / 9) * 9;
      do { crypto.getRandomValues(a); } while (a[0] >= limit);
      return a[0] % 9;
    }
    return Math.floor(Math.random() * 9);
  };
  const fmt = (value) => String(value).padStart(6, '0');
  const storedBest = () => {
    try { return Math.max(0, parseInt(localStorage.getItem('echo-grid-best') || '0', 10) || 0); }
    catch { return 0; }
  };
  let personalBest = storedBest();
  function saveLocalBest() {
    if (score > personalBest) {
      personalBest = score;
      try { localStorage.setItem('echo-grid-best', String(score)); } catch { /* storage optional */ }
    }
  }
  function setMessage(message) { fields.status.textContent = message; }
  function setPhase(next, label) {
    phase = next;
    fields.phase.textContent = label;
    fields.phaseDot.className = 'signal-dot' + (next === 'showing' ? ' playing' : next === 'input' ? ' listening' : '');
    $('pads').classList.toggle('is-watching', next !== 'input');
    for (const tile of tiles) tile.disabled = next !== 'input';
  }
  function render() {
    fields.score.textContent = fmt(score);
    fields.round.innerHTML = String(completed + 1).padStart(2, '0') + '<span class="stat-sub"> / ∞</span>';
    fields.lives.innerHTML = [...Array(3)].map((_, i) => '<span class="' + (i >= lives ? 'lost' : '') + '">♥</span>').join(' ');
    fields.lives.setAttribute('aria-label', lives + ' lives remaining');
    fields.best.textContent = fmt(Math.max(personalBest, score));
    const total = sequence.length;
    fields.progress.style.width = (total ? (cursor / total * 100) : 0) + '%';
    fields.progressLabel.innerHTML = 'PATTERN PROGRESS <b>' + cursor + ' / ' + total + '</b>';
    fields.replay.disabled = phase !== 'input' || !replayAvailable;
    fields.replay.querySelector('small').textContent = replayAvailable ? '×1' : '×0';
  }

  function tone(index, duration = .21, gain = .055) {
    if (!soundOn) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      audioContext ||= new Audio();
      if (audioContext.state === 'suspended') audioContext.resume();
      const osc = audioContext.createOscillator();
      const volume = audioContext.createGain();
      const now = audioContext.currentTime;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(NOTES[index], now);
      volume.gain.setValueAtTime(.00001, now);
      volume.gain.exponentialRampToValueAtTime(gain, now + .025);
      volume.gain.exponentialRampToValueAtTime(.00001, now + duration);
      osc.connect(volume);
      volume.connect(audioContext.destination);
      osc.start(now);
      osc.stop(now + duration + .025);
    } catch { /* playable without sound or permissions */ }
  }
  const pulse = async (index, ms = 330, token = epoch) => {
    if (token !== epoch) return;
    const tile = tiles[index];
    tile.classList.add('active');
    tone(index, Math.max(.14, ms / 1000 * .65));
    await wait(ms);
    if (token === epoch) tile.classList.remove('active');
  };
  const clearLights = () => tiles.forEach((tile) => tile.classList.remove('active'));

  async function showSequence(token = epoch) {
    setPhase('showing', 'WATCH CLOSELY');
    cursor = 0;
    setMessage('Memorise the flashing sequence…');
    render();
    await wait(620);
    if (token !== epoch) return;
    const duration = Math.max(225, 590 - completed * 21);
    const gap = Math.max(110, 240 - completed * 7);
    for (const index of sequence) {
      if (token !== epoch) return;
      await pulse(index, duration, token);
      await wait(gap);
    }
    if (token !== epoch) return;
    setPhase('input', 'YOUR TURN');
    setMessage('Your turn. Repeat ' + sequence.length + ' glowing tiles.');
    render();
  }

  async function nextRound(token = epoch) {
    if (token !== epoch) return;
    sequence.push(randomTile());
    if (sequence.length === 1) sequence.push(randomTile());
    fields.overlay.hidden = true;
    await showSequence(token);
  }
  function startRun() {
    epoch += 1;
    sequence = [];
    score = 0;
    completed = 0;
    lives = 3;
    streak = 0;
    bestStreak = 0;
    replayAvailable = true;
    cursor = 0;
    clearLights();
    setPhase('between', 'GET READY');
    render();
    nextRound(epoch);
  }
  async function onPad(index) {
    if (phase !== 'input') return;
    setPhase('between', 'CHECKING');
    const token = epoch;
    await pulse(index, 180, token);
    if (token !== epoch) return;
    if (sequence[cursor] !== index) {
      lives = Math.max(0, lives - 1);
      streak = 0;
      if (navigator.vibrate) navigator.vibrate(70);
      render();
      if (!lives) { await finishRun(token); return; }
      setMessage('Not quite! ' + lives + (lives === 1 ? ' life' : ' lives') + ' left. Watch again.');
      await wait(850);
      if (token !== epoch) return;
      await showSequence(token);
      return;
    }
    cursor += 1;
    score += 20 + Math.min(100, completed * 5);
    streak += 1;
    bestStreak = Math.max(bestStreak, streak);
    saveLocalBest();
    render();
    if (cursor < sequence.length) {
      setPhase('input', 'YOUR TURN');
      setMessage('Perfect so far. Keep going!');
      render();
      return;
    }
    completed++;
    score += 70 + completed * 35 + (lives === 3 ? 50 : 0);
    saveLocalBest();
    setPhase('between', 'ROUND CLEAR');
    setMessage('Round ' + completed + ' complete! + bonus points');
    render();
    tone(8, .34, .07);
    await wait(1100);
    if (token !== epoch) return;
    await nextRound(token);
  }
  async function replay() {
    if (phase !== 'input' || !replayAvailable) return;
    replayAvailable = false;
    score = Math.max(0, score - 60);
    saveLocalBest();
    await showSequence(epoch);
  }
  async function finishRun(token) {
    if (token !== epoch) return;
    setPhase('over', 'RUN COMPLETE');
    clearLights();
    saveLocalBest();
    render();
    fields.overlayKicker.textContent = 'RUN COMPLETE / NICE TRY';
    fields.overlayTitle.innerHTML = fmt(score) + '<br>POINTS.';
    fields.overlayCopy.textContent = completed + ' rounds cleared · ' + bestStreak + ' best streak. Your next personal best is one game away.';
    fields.overlayStart.innerHTML = 'PLAY AGAIN <span>↗</span>';
    fields.overlay.hidden = false;
    setMessage('Game over. Ready for another shot?');
    await submitScore();
  }

  // The start.ng connect frame is only available on *.start.ng, not local previews.
  function connectFrame() {
    if (!HOSTED) return Promise.resolve(null);
    framePromise ||= new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      let settled = false;
      let timer;
      const done = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!value) {
          iframe.remove();
          framePromise = null; // allow a fresh attempt after a network failure
        }
        resolve(value);
      };
      iframe.hidden = true;
      iframe.title = 'start.ng player connection';
      iframe.src = START_NG + '/connect';
      iframe.onload = () => done(iframe);
      iframe.onerror = () => done(null);
      timer = setTimeout(() => done(null), 5000);
      document.body.append(iframe);
    });
    return framePromise;
  }
  async function askStartNg(message, replyType, timeoutMs = 5000) {
    const iframe = await connectFrame();
    if (!iframe || !iframe.contentWindow) return null;
    return new Promise((resolve) => {
      const requestId = Math.random().toString(36).slice(2);
      let finished = false;
      const done = (reply) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        removeEventListener('message', onMessage);
        resolve(reply);
      };
      const timer = setTimeout(() => done(null), timeoutMs);
      function onMessage(event) {
        if (event.origin !== START_NG || event.source !== iframe.contentWindow) return;
        if (event.data && event.data.type === replyType && event.data.requestId === requestId) done(event.data);
      }
      addEventListener('message', onMessage);
      iframe.contentWindow.postMessage({ ...message, requestId }, START_NG);
    });
  }
  function signIn() {
    if (!HOSTED) { setMessage('Sign-in is available after publishing on start.ng.'); return; }
    location.href = START_NG + '/?return_to=' + encodeURIComponent(location.origin + location.pathname);
  }
  async function loadIdentity() {
    if (!HOSTED) {
      fields.name.textContent = 'Guest player';
      fields.account.textContent = 'Local preview mode';
      return;
    }
    const reply = await askStartNg({ type: 'startng:whoami' }, 'startng:user');
    const person = reply?.user || reply?.guest;
    signedInPlayer = reply?.user || null;
    currentPlayerId = signedInPlayer?.id || null;
    fields.name.textContent = person?.name || 'Guest';
    fields.account.textContent = signedInPlayer?.account ? '@' + signedInPlayer.account : 'Play as guest';
    fields.signin.hidden = Boolean(signedInPlayer);
    if (typeof person?.face === 'string' && person.face.startsWith('data:image/png;base64,')) {
      fields.face.src = person.face;
      fields.face.hidden = false;
      fields.fallback.hidden = true;
    } else {
      fields.face.hidden = true;
      fields.fallback.hidden = false;
    }
    if (!signedInPlayer && !GUEST_MODE && phase === 'idle') setMessage('Playing as guest. Sign in to save leaderboard scores.');
  }
  function showBoardEntries(entries) {
    fields.leaders.replaceChildren();
    if (!Array.isArray(entries) || entries.length === 0) {
      const row = document.createElement('li');
      row.className = 'board-empty';
      row.textContent = 'No scores yet. Be the first to claim the top spot!';
      fields.leaders.append(row);
      return;
    }
    for (const entry of entries.slice(0, 8)) {
      const li = document.createElement('li');
      if (entry.player_id === currentPlayerId && currentPlayerId !== null) li.classList.add('player-own');
      const rank = document.createElement('span');
      rank.className = 'rank-number';
      rank.textContent = '#' + String(entry.rank || '?').padStart(2, '0');
      const name = document.createElement('span');
      name.className = 'rank-name';
      name.textContent = entry.name || 'Player';
      const points = document.createElement('span');
      points.className = 'rank-points';
      points.textContent = Number(entry.stats?.score ?? entry.score ?? 0).toLocaleString();
      li.append(rank, name, points);
      fields.leaders.append(li);
    }
  }
  async function loadBoard() {
    if (!HOSTED) return;
    const result = await askStartNg({ type: 'startng:leaderboard', limit: 8 }, 'startng:leaderboardData');
    if (result?.ok) showBoardEntries(result.entries);
    else if (result === null) {
      fields.leaders.replaceChildren();
      const li = document.createElement('li');
      li.className = 'board-empty';
      li.textContent = 'Leaderboard is temporarily unavailable.';
      fields.leaders.append(li);
    }
  }
  async function submitScore() {
    if (!HOSTED || !signedInPlayer) {
      setMessage('Personal best saved on this device. Sign in on start.ng to join the rankings.');
      return;
    }
    try {
      const response = await askStartNg({
        type: 'startng:score',
        stats: { score: Math.floor(score), rounds: completed, streak: bestStreak }
      }, 'startng:scoreSaved', 7000);
      if (response?.ok) {
        const rank = response.result?.rank;
        setMessage(response.result?.improved ? 'New leaderboard best! Rank #' + rank : 'Run complete! Your best rank: #' + rank);
      } else {
        setMessage('Score saved locally. Sign in again if your start.ng session expired.');
      }
    } catch { setMessage('Score saved locally. Leaderboard could not be reached.'); }
    await loadBoard();
  }
  function wireEvents() {
    fields.overlayStart.addEventListener('click', startRun);
    fields.start.addEventListener('click', startRun);
    fields.replay.addEventListener('click', replay);
    fields.signin.addEventListener('click', signIn);
    $('refresh-board').addEventListener('click', loadBoard);
    fields.sound.addEventListener('click', () => {
      soundOn = !soundOn;
      fields.sound.textContent = soundOn ? '♫ SOUND ON' : '♫ SOUND OFF';
      fields.sound.setAttribute('aria-pressed', String(soundOn));
      if (soundOn) tone(4);
    });
    for (const tile of tiles) tile.addEventListener('click', () => onPad(Number(tile.dataset.pad)));
    document.addEventListener('keydown', (event) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      const focused = document.activeElement;
      if (focused && ['INPUT', 'TEXTAREA', 'SELECT'].includes(focused.tagName)) return;
      if (/^[1-9]$/.test(event.key) && phase === 'input') {
        event.preventDefault();
        onPad(Number(event.key) - 1);
      } else if (event.key === 'Enter' && (phase === 'idle' || phase === 'over') && focused?.tagName !== 'BUTTON') {
        startRun();
      }
    });
    const refreshPlayer = () => { if (document.visibilityState === 'visible') loadIdentity(); };
    document.addEventListener('visibilitychange', refreshPlayer);
    window.addEventListener('focus', refreshPlayer);
  }
  function boot() {
    wireEvents();
    setPhase('idle', 'SYSTEM READY');
    render();
    loadIdentity();
    loadBoard();
  }
  boot();
})();
