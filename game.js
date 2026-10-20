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
    results: $('run-results'), resultRounds: $('result-rounds'), resultStreak: $('result-streak'),
    classicMode: $('classic-mode'), dailyMode: $('daily-mode'), dailyPanel: $('daily-panel'),
    dailyDate: $('daily-date'), dailyState: $('daily-state'), runMode: $('run-mode'), bestLabel: $('best-label'),
    sharePanel: $('share-panel'), shareText: $('share-text'), copyResult: $('copy-result'), shareStatus: $('share-status'),
    difficulty: $('difficulty'), difficultyHelp: $('difficulty-help'), motion: $('motion-btn'),
    statsMode: $('stats-mode'), statsRuns: $('stats-runs'), statsRounds: $('stats-rounds'),
    statsBestRounds: $('stats-best-rounds'), statsStreak: $('stats-streak'), progressStorage: $('progress-storage'),
    achievementList: $('achievement-list'), achievementCount: $('achievement-count'), achievementNotice: $('achievement-notice'),
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
  const SPEEDS = {
    relaxed: { label: 'Relaxed', multiplier: 1.5 },
    standard: { label: 'Standard', multiplier: 1 },
    fast: { label: 'Fast', multiplier: .75 },
  };
  let preferences = {};
  try {
    const saved = JSON.parse(localStorage.getItem('echo-grid-preferences-v1') || '{}');
    if (saved && typeof saved === 'object') preferences = saved;
  } catch { /* preferences are optional */ }
  let selectedDifficulty = typeof preferences.difficulty === 'string' && Object.hasOwn(SPEEDS, preferences.difficulty) ? preferences.difficulty : 'standard';
  let runDifficulty = selectedDifficulty;
  let soundOn = preferences.sound !== false;
  let reduceMotion = preferences.reduceMotion === true;
  function savePreferences() {
    try {
      localStorage.setItem('echo-grid-preferences-v1', JSON.stringify({ difficulty: selectedDifficulty, sound: soundOn, reduceMotion }));
    } catch { /* playable without storage */ }
  }
  function renderPreferences() {
    fields.sound.textContent = soundOn ? '♫ SOUND ON' : '♫ SOUND OFF';
    fields.sound.setAttribute('aria-pressed', String(soundOn));
    fields.motion.textContent = 'REDUCE MOTION: ' + (reduceMotion ? 'ON' : 'OFF');
    fields.motion.setAttribute('aria-pressed', String(reduceMotion));
    document.body.classList.toggle('reduce-motion', reduceMotion);
  }
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
  const pulseVersions = Array(9).fill(0);
  const dailyStore = EchoDaily.createStore();
  const progressStore = EchoProgress.createStore();
  let progressRecorded = false;
  let selectedMode = 'classic';
  let runMode = 'classic'; // classic, daily (saved attempt), practice
  let runDay = null;
  let dailyAttemptId = null;
  let resultText = '';
  const isActive = () => ['showing', 'input', 'between'].includes(phase);

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
  let nextTile = randomTile;
  const fmt = (value) => String(value).padStart(6, '0');
  const bestKey = () => selectedDifficulty === 'standard' ? 'echo-grid-best' : 'echo-grid-best-' + selectedDifficulty;
  const sessionBests = new Map();
  const storedBest = () => {
    try {
      const value = Number(localStorage.getItem(bestKey()) || '0');
      return Number.isSafeInteger(value) && value >= 0 ? value : 0;
    }
    catch { return 0; }
  };
  let personalBest = 0;
  function refreshBest() {
    personalBest = Math.max(sessionBests.get(bestKey()) || 0, storedBest());
    sessionBests.set(bestKey(), personalBest);
  }
  function saveLocalBest() {
    refreshBest();
    personalBest = Math.max(score, personalBest);
    sessionBests.set(bestKey(), personalBest);
    try { localStorage.setItem(bestKey(), String(personalBest)); return true; }
    catch { return false; }
  }
  function setMessage(message) { fields.status.textContent = message; }
  function renderProgress() {
    const snapshot = progressStore.snapshot();
    const mode = Object.hasOwn(snapshot.modes, fields.statsMode.value) ? fields.statsMode.value : 'standard';
    const stats = snapshot.modes[mode];
    fields.statsRuns.textContent = stats.runs.toLocaleString();
    fields.statsRounds.textContent = stats.rounds.toLocaleString();
    fields.statsBestRounds.textContent = stats.bestRounds.toLocaleString();
    fields.statsStreak.textContent = stats.bestStreak.toLocaleString();
    fields.progressStorage.textContent = snapshot.sessionOnly
      ? 'Progress could not be saved or read. New progress lasts only while this page stays open.'
      : 'New completed runs count here. Progress stays on this device.';
    const badges = EchoProgress.achievements(snapshot.modes);
    fields.achievementCount.textContent = badges.filter(badge => badge.unlocked).length + ' / ' + badges.length;
    fields.achievementList.replaceChildren();
    for (const badge of badges) {
      const item = document.createElement('li');
      item.className = badge.unlocked ? 'unlocked' : '';
      const title = document.createElement('strong');
      title.textContent = badge.title;
      const description = document.createElement('span');
      description.textContent = badge.description;
      const state = document.createElement('small');
      state.textContent = badge.unlocked ? '✓ Unlocked' : 'Locked · ' + badge.value + ' / ' + badge.goal;
      item.append(title, description, state);
      fields.achievementList.append(item);
    }
  }
  function recordProgress() {
    if (progressRecorded) return;
    progressRecorded = true;
    const mode = runMode === 'classic' ? runDifficulty : runMode === 'daily' ? 'daily' : 'practice';
    const unlocked = progressStore.record(mode, { rounds: completed, streak: bestStreak });
    fields.achievementNotice.textContent = unlocked.length ? 'Unlocked: ' + unlocked.map(badge => badge.title).join(' · ') : '';
    fields.achievementNotice.hidden = !unlocked.length;
  }
  function clearShareResult() {
    resultText = '';
    fields.sharePanel.hidden = true;
    fields.shareText.value = '';
    fields.copyResult.disabled = false;
    fields.copyResult.textContent = 'COPY RESULT';
    fields.shareStatus.textContent = '';
  }
  function prepareShareResult() {
    const mode = runMode === 'classic' ? 'Classic' + (runDifficulty === 'standard' ? '' : ' · ' + SPEEDS[runDifficulty].label) :
      (runMode === 'practice' ? 'Daily Practice' : 'Daily Challenge') + ' · ' + runDay + ' (UTC)';
    const lines = [
      'Echo Grid · ' + mode,
      score.toLocaleString('en-US') + ' points · ' + completed + (completed === 1 ? ' round cleared' : ' rounds cleared'),
      'Longest streak: ' + bestStreak,
    ];
    if (HOSTED) {
      // Build a clean link: never copy sign-in fragments or incoming query parameters.
      const link = location.origin + location.pathname + (runMode === 'classic' ? '' : '?mode=daily');
      lines.push(runMode === 'classic' ? 'Can you beat my score?' : 'Play today’s daily challenge:');
      lines.push(link);
    }
    resultText = lines.join('\n');
    fields.shareText.value = resultText;
    fields.sharePanel.hidden = false;
    fields.shareStatus.textContent = 'Copy your result and paste it into a message.';
  }
  async function copyResult() {
    if (phase !== 'over' || !resultText || fields.copyResult.disabled) return;
    const token = epoch;
    const text = resultText;
    fields.copyResult.disabled = true;
    fields.copyResult.textContent = 'COPYING…';
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      if (token !== epoch) return;
      fields.shareStatus.textContent = 'Result copied. Paste it wherever you want to share.';
    } catch {
      if (token !== epoch) return;
      fields.shareStatus.textContent = 'Automatic copy is unavailable. Select the result text and use your device’s Copy command.';
      fields.shareText.focus();
      fields.shareText.select();
    } finally {
      if (token === epoch) {
        fields.copyResult.disabled = false;
        fields.copyResult.textContent = 'COPY RESULT';
      }
    }
  }
  function refreshDaily() {
    const date = selectedMode === 'daily' && isActive() ? runDay : EchoDaily.day();
    const record = dailyStore.read(date);
    fields.classicMode.setAttribute('aria-pressed', String(selectedMode === 'classic'));
    fields.dailyMode.setAttribute('aria-pressed', String(selectedMode === 'daily'));
    fields.dailyPanel.hidden = selectedMode !== 'daily';
    fields.dailyDate.textContent = date + ' · DAILY CHALLENGE';
    if (!dailyStore.available) {
      fields.dailyState.textContent = 'Browser storage is unavailable. Daily play is practice only; results cannot be saved.';
    } else if (selectedMode === 'daily' && isActive()) {
      fields.dailyState.textContent = runMode === 'daily'
        ? 'Your saved attempt is in progress. End the run to keep your current score.'
        : 'Practice run — your saved daily result stays unchanged.';
    } else if (record?.status === 'complete') {
      fields.dailyState.textContent = 'Your result: ' + record.score.toLocaleString() + ' points · ' + record.rounds + ' rounds · ' + record.streak + ' longest streak. Practice is available.';
    } else if (record) {
      fields.dailyState.textContent = 'Today’s attempt has already been started or interrupted. Practice is available.';
    } else {
      fields.dailyState.textContent = 'Today’s saved attempt is ready. Three lives and one Replay.';
    }
    fields.difficulty.value = selectedMode === 'daily' ? 'standard' : selectedDifficulty;
    fields.difficulty.disabled = selectedMode === 'daily' || isActive();
    fields.difficultyHelp.textContent = selectedMode === 'daily'
      ? 'Daily uses fixed Standard timing for everyone, including practice.'
      : 'Standard counts toward the Classic leaderboard. Other speeds have separate local bests. Choose before starting.';
    fields.runMode.textContent = selectedMode === 'classic' ? 'CLASSIC · ' + SPEEDS[selectedDifficulty].label.toUpperCase() + (selectedDifficulty === 'standard' ? ' · RANKED SPEED' : ' · LOCAL BEST ONLY') :
      ((runDay || date) + (runMode === 'practice' ? ' · DAILY PRACTICE' : ' · DAILY CHALLENGE'));
    const dailyAction = record || !dailyStore.available ? 'START PRACTICE' : 'START DAILY';
    fields.start.innerHTML = (selectedMode === 'classic' ? 'NEW RUN' :
      runMode === 'daily' && isActive() ? 'END DAILY RUN' : dailyAction) + ' <span>↗</span>';
    if (selectedMode === 'daily') fields.overlayStart.innerHTML = dailyAction + ' <span>↗</span>';
  }
  function saveDailyResult() {
    if (runMode !== 'daily' || !dailyAttemptId) return false;
    const saved = dailyStore.finish(runDay, dailyAttemptId, { score, rounds: completed, streak: bestStreak });
    dailyAttemptId = null;
    return saved;
  }
  function setPhase(next, label) {
    phase = next;
    fields.phase.textContent = label;
    fields.phaseDot.className = 'signal-dot' + (next === 'showing' ? ' playing' : next === 'input' ? ' listening' : '');
    $('pads').classList.toggle('is-watching', next !== 'input');
    for (const tile of tiles) tile.disabled = next !== 'input';
  }
  function render() {
    if (!isActive()) { refreshBest(); renderProgress(); }
    fields.score.textContent = fmt(score);
    fields.round.innerHTML = String(completed + 1).padStart(2, '0') + '<span class="stat-sub"> / ∞</span>';
    fields.lives.innerHTML = [...Array(3)].map((_, i) => '<span class="' + (i >= lives ? 'lost' : '') + '">♥</span>').join(' ');
    fields.lives.setAttribute('aria-label', lives + ' lives remaining');
    fields.bestLabel.textContent = selectedMode === 'classic' ? (selectedDifficulty === 'standard' ? 'PERSONAL BEST' : SPEEDS[selectedDifficulty].label.toUpperCase() + ' BEST') : 'DAILY RESULT';
    const dailyResult = selectedMode === 'daily' ? dailyStore.read(runDay || EchoDaily.day()) : null;
    fields.best.textContent = selectedMode === 'classic' ? fmt(personalBest) :
      dailyResult?.status === 'complete' ? fmt(dailyResult.score) : '—';
    const total = sequence.length;
    fields.progress.style.width = (total ? (cursor / total * 100) : 0) + '%';
    fields.progressLabel.innerHTML = 'PATTERN PROGRESS <b>' + cursor + ' / ' + total + '</b>';
    fields.replay.disabled = phase !== 'input' || !replayAvailable;
    const replayCost = Math.min(60, score);
    fields.replay.querySelector('small').textContent = replayAvailable ? '×1 · −' + replayCost + ' PTS' : 'USED';
    fields.replay.setAttribute('aria-label', replayAvailable ? 'Replay sequence once. Costs ' + replayCost + ' points.' : 'Replay already used');
    refreshDaily();
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
    const version = ++pulseVersions[index];
    tile.classList.add('active');
    tone(index, Math.max(.14, ms / 1000 * .65));
    await wait(ms);
    if (token === epoch && version === pulseVersions[index]) tile.classList.remove('active');
  };
  const clearLights = () => tiles.forEach((tile, index) => {
    pulseVersions[index]++;
    tile.classList.remove('active', 'wrong', 'expected');
  });

  async function showSequence(token = epoch) {
    if (token !== epoch) return;
    clearLights();
    setPhase('showing', 'WATCH CLOSELY');
    cursor = 0;
    setMessage('Memorise the flashing sequence…');
    render();
    await wait(620);
    if (token !== epoch) return;
    const multiplier = SPEEDS[runDifficulty].multiplier;
    // Fast reaches the original minimum timing sooner without raising the flash-rate ceiling.
    const duration = Math.max(225, Math.round(Math.max(225, 590 - completed * 21) * multiplier));
    const gap = Math.max(110, Math.round(Math.max(110, 240 - completed * 7) * multiplier));
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
    sequence.push(nextTile());
    if (sequence.length === 1) sequence.push(nextTile());
    fields.overlay.hidden = true;
    await showSequence(token);
  }
  function resetRun() {
    epoch += 1;
    progressRecorded = false;
    fields.achievementNotice.hidden = true;
    fields.achievementNotice.textContent = '';
    clearShareResult();
    sequence = [];
    score = 0;
    completed = 0;
    lives = 3;
    streak = 0;
    bestStreak = 0;
    replayAvailable = true;
    cursor = 0;
    clearLights();
    fields.results.hidden = true;
    fields.overlay.classList.remove('has-results', 'is-record');
    setPhase('between', 'GET READY');
  }
  function selectMode(mode, reset = false) {
    if (selectedMode === mode && !reset) return;
    if (isActive() && runMode === 'daily') {
      saveDailyResult();
      recordProgress();
    }
    selectedMode = mode;
    runMode = mode;
    runDay = null;
    dailyAttemptId = null;
    resetRun();
    setPhase('idle', 'SYSTEM READY');
    fields.overlay.hidden = false;
    fields.overlayKicker.textContent = mode === 'daily' ? 'ONE DAY. ONE PATTERN.' : 'ARE YOU READY?';
    fields.overlayTitle.innerHTML = mode === 'daily' ? 'TODAY’S<br>CHALLENGE.' : 'FIND YOUR<br>RHYTHM.';
    fields.overlayCopy.textContent = mode === 'daily' ? 'Your first attempt is saved. Later runs are practice. A new pattern arrives at 00:00 UTC.' : 'Memorise each flash, then tap the tiles in the same order.';
    fields.overlayStart.innerHTML = 'START THE GAME <span>↗</span>';
    setMessage(mode === 'daily' ? 'Press start for the daily pattern.' : 'Press start to begin.');
    render();
  }
  function startRun() {
    if (runMode === 'daily' && isActive()) {
      void finishRun(epoch);
      return;
    }
    runDay = selectedMode === 'daily' ? EchoDaily.day() : null;
    dailyAttemptId = runDay ? dailyStore.reserve(runDay) : null;
    runMode = selectedMode === 'classic' ? 'classic' : dailyAttemptId ? 'daily' : 'practice';
    runDifficulty = selectedMode === 'classic' ? selectedDifficulty : 'standard';
    nextTile = runDay ? EchoDaily.sequence(runDay) : randomTile;
    resetRun();
    render();
    nextRound(epoch);
  }
  async function onPad(index) {
    if (phase !== 'input') return;
    const token = epoch;
    if (sequence[cursor] !== index) {
      setPhase('between', 'PATTERN MISSED');
      clearLights();
      const expected = sequence[cursor];
      tiles[index].classList.add('wrong');
      tiles[expected].classList.add('expected');
      tone(expected, .35);
      lives = Math.max(0, lives - 1);
      streak = 0;
      try { navigator.vibrate?.(70); } catch { /* haptics optional */ }
      render();
      setMessage('You tapped ' + (index + 1) + ' (×). Expected ' + (expected + 1) + ' (✓). ' +
        (lives ? lives + (lives === 1 ? ' life left. Watch again.' : ' lives left. Watch again.') : 'No lives left.'));
      await wait(1200);
      if (token !== epoch) return;
      clearLights();
      if (!lives) { await finishRun(token); return; }
      await showSequence(token);
      return;
    }
    // Feedback runs independently so the next tap can be accepted immediately.
    void pulse(index, 180, token);
    cursor += 1;
    score += 20 + Math.min(100, completed * 5);
    streak += 1;
    bestStreak = Math.max(bestStreak, streak);
    render();
    if (cursor < sequence.length) {
      setPhase('input', 'YOUR TURN');
      setMessage('Perfect so far. Keep going!');
      render();
      return;
    }
    completed++;
    score += 70 + completed * 35 + (lives === 3 ? 50 : 0);
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
    await showSequence(epoch);
  }
  async function finishRun(token) {
    if (token !== epoch) return;
    // Cancel pending playback and next-round timers when ending early.
    token = ++epoch;
    setPhase('over', 'RUN COMPLETE');
    clearLights();
    refreshBest();
    const previousBest = personalBest;
    const isRecord = runMode === 'classic' && score > previousBest;
    const dailySaved = saveDailyResult();
    const bestSaved = runMode === 'classic' && saveLocalBest();
    recordProgress();
    render();
    fields.overlay.classList.add('has-results');
    fields.overlay.classList.toggle('is-record', isRecord);
    fields.overlayKicker.textContent = isRecord ? '✦ NEW PERSONAL BEST ✦' : 'RUN COMPLETE';
    fields.overlayTitle.innerHTML = fmt(score) + '<br>POINTS.';
    fields.resultRounds.textContent = String(completed);
    fields.resultStreak.textContent = String(bestStreak);
    fields.results.hidden = false;
    fields.overlayCopy.textContent = isRecord
      ? (previousBest ? (score - previousBest).toLocaleString() + ' points above your previous best!' : 'Your first personal best. Make this the score to beat!')
      : (score === previousBest && score > 0 ? 'You matched your personal best. One more point sets a new record!' :
        (previousBest - score + 1).toLocaleString() + ' more ' + (previousBest - score + 1 === 1 ? 'point' : 'points') + ' to set a new personal best.');
    fields.overlayStart.innerHTML = 'PLAY AGAIN <span>↗</span>';
    if (runMode !== 'classic') {
      fields.overlayKicker.textContent = runMode === 'daily' ? 'DAILY CHALLENGE COMPLETE' : 'DAILY PRACTICE COMPLETE';
      fields.overlayCopy.textContent = runDay + ' · ' + (runMode === 'practice'
        ? 'Practice result only. Your saved daily attempt stays unchanged.'
        : dailySaved ? 'Your daily result is saved in this browser. Come back tomorrow for a new pattern!'
          : 'This result could not be saved. You can still practice today’s pattern.');
    }
    refreshDaily();
    fields.overlay.hidden = false;
    prepareShareResult();
    fields.overlayStart.focus({ preventScroll: true });
    setMessage('Game over. Ready for another shot?');
    if (runMode === 'classic' && runDifficulty === 'standard') await submitScore(token, bestSaved);
    else if (runMode === 'classic') setMessage(SPEEDS[runDifficulty].label + ' run complete. ' +
      (bestSaved ? 'Local best saved.' : 'Local best could not be saved; it lasts only while this page stays open.') + ' Classic rankings are unchanged.');
    else setMessage(runMode === 'practice' ? 'Practice complete. Classic rankings are unchanged.' :
      dailySaved ? 'Daily result saved on this device.' : 'Daily result could not be saved.');
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
  async function submitScore(token = epoch, bestSaved = true) {
    const localMessage = bestSaved ? 'Personal best saved on this device.' :
      'Local best could not be saved; it lasts only while this page stays open.';
    if (!HOSTED || !signedInPlayer) {
      setMessage(localMessage + ' Sign in on start.ng to join the rankings.');
      return;
    }
    try {
      const response = await askStartNg({
        type: 'startng:score',
        stats: { score: Math.floor(score), rounds: completed, streak: bestStreak }
      }, 'startng:scoreSaved', 7000);
      if (token !== epoch) return;
      if (response?.ok) {
        const rank = response.result?.rank;
        setMessage((response.result?.improved ? 'New leaderboard best! Rank #' + rank : 'Run complete! Your best rank: #' + rank) +
          (bestSaved ? '' : ' ' + localMessage));
      } else {
        setMessage(localMessage + ' Sign in again if your start.ng session expired.');
      }
    } catch { if (token === epoch) setMessage(localMessage + ' Leaderboard could not be reached.'); }
    if (token !== epoch) return;
    await loadBoard();
  }
  function wireEvents() {
    fields.statsMode.addEventListener('change', renderProgress);
    fields.difficulty.addEventListener('change', () => {
      if (isActive() || selectedMode !== 'classic' || !Object.hasOwn(SPEEDS, fields.difficulty.value)) {
        render();
        return;
      }
      selectedDifficulty = fields.difficulty.value;
      refreshBest();
      savePreferences();
      // Reset a finished result before changing the speed it belongs to.
      selectMode('classic', true);
    });
    fields.motion.addEventListener('click', () => {
      reduceMotion = !reduceMotion;
      savePreferences();
      renderPreferences();
    });
    fields.copyResult.addEventListener('click', copyResult);
    fields.classicMode.addEventListener('click', () => selectMode('classic'));
    fields.dailyMode.addEventListener('click', () => selectMode('daily'));
    fields.overlayStart.addEventListener('click', startRun);
    fields.start.addEventListener('click', startRun);
    fields.replay.addEventListener('click', replay);
    fields.signin.addEventListener('click', signIn);
    $('refresh-board').addEventListener('click', loadBoard);
    fields.sound.addEventListener('click', () => {
      soundOn = !soundOn;
      savePreferences();
      renderPreferences();
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
      } else if (event.key === 'Enter' && (phase === 'idle' || phase === 'over') &&
        (!focused || ['BODY', 'HTML'].includes(focused.tagName))) {
        startRun();
      }
    });
    const refreshPlayer = () => {
      if (document.visibilityState === 'visible') {
        loadIdentity();
        if (!isActive()) render();
      }
    };
    document.addEventListener('visibilitychange', refreshPlayer);
    window.addEventListener('focus', refreshPlayer);
    window.addEventListener('storage', () => { if (!isActive()) render(); });
    const refreshDate = () => {
      if (!isActive()) render();
      setTimeout(refreshDate, 60000);
    };
    setTimeout(refreshDate, 60000);
  }
  function boot() {
    wireEvents();
    renderPreferences();
    clearShareResult();
    setPhase('idle', 'SYSTEM READY');
    render();
    if (new URLSearchParams(location.search).get('mode') === 'daily') selectMode('daily');
    loadIdentity();
    loadBoard();
  }
  boot();
})();
