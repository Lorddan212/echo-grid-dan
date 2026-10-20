/* Personal progress is local to this browser, never a ranked score source. */
'use strict';
(() => {
  const KEY = 'echo-grid-progress-v1';
  const modes = ['standard', 'relaxed', 'fast', 'daily', 'practice'];
  const fields = ['runs', 'rounds', 'bestRounds', 'bestStreak'];
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const empty = () => Object.fromEntries(modes.map(mode => [mode, { runs: 0, rounds: 0, bestRounds: 0, bestStreak: 0 }]));
  const copy = data => Object.fromEntries(modes.map(mode => [mode, { ...data[mode] }]));
  const add = (a, b) => Math.min(Number.MAX_SAFE_INTEGER, a + b);

  function achievements(data) {
    const rows = modes.map(mode => data[mode]);
    const runs = rows.reduce((total, row) => add(total, row.runs), 0);
    const rounds = Math.max(...rows.map(row => row.bestRounds));
    const streak = Math.max(...rows.map(row => row.bestStreak));
    return [
      { id: 'first', title: 'First Signal', description: 'Finish your first run.', goal: 1, value: runs },
      { id: 'five', title: 'Finding Rhythm', description: 'Clear 5 rounds in one run.', goal: 5, value: rounds },
      { id: 'ten', title: 'Pattern Master', description: 'Clear 10 rounds in one run.', goal: 10, value: rounds },
      { id: 'streak', title: 'In the Zone', description: 'Reach a streak of 20 correct taps.', goal: 20, value: streak },
      { id: 'regular', title: 'One More Run', description: 'Finish 10 runs across any modes.', goal: 10, value: runs },
      { id: 'daily', title: 'Daily Explorer', description: 'Finish 3 Daily attempts; practice excluded.', goal: 3, value: data.daily.runs },
    ].map(badge => ({ ...badge, value: Math.min(badge.goal, badge.value), unlocked: badge.value >= badge.goal }));
  }

  function createStore() {
    let data = empty();
    let sessionOnly = false;
    function refresh() {
      if (sessionOnly) return;
      try {
        const raw = localStorage.getItem(KEY);
        if (raw === null) return;
        const stored = JSON.parse(raw);
        if (stored?.version !== 1 || !modes.every(mode =>
          stored.modes?.[mode] && fields.every(field => count(stored.modes[mode][field])) &&
          stored.modes[mode].bestRounds <= stored.modes[mode].rounds)) throw Error('Unreadable progress');
        // Preserve session progress and re-read completed writes from other tabs.
        for (const mode of modes) for (const field of fields) {
          data[mode][field] = Math.max(data[mode][field], stored.modes[mode][field]);
        }
      } catch { sessionOnly = true; }
    }
    return {
      snapshot() {
        refresh();
        return { modes: copy(data), sessionOnly };
      },
      record(mode, result) {
        if (!modes.includes(mode) || !count(result?.rounds) || !count(result?.streak)) return [];
        refresh();
        const unlocked = new Set(achievements(data).filter(badge => badge.unlocked).map(badge => badge.id));
        const row = data[mode];
        row.runs = add(row.runs, 1);
        row.rounds = add(row.rounds, result.rounds);
        row.bestRounds = Math.max(row.bestRounds, result.rounds);
        row.bestStreak = Math.max(row.bestStreak, result.streak);
        if (!sessionOnly) {
          try { localStorage.setItem(KEY, JSON.stringify({ version: 1, modes: data })); }
          catch { sessionOnly = true; }
        }
        return achievements(data).filter(badge => badge.unlocked && !unlocked.has(badge.id));
      },
    };
  }
  globalThis.EchoProgress = { createStore, achievements };
})();
