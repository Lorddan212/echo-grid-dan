/* Scoring season 2: shared by the browser and leaderboard validator. */
'use strict';
(() => {
  const VERSION = 2;
  const MAX_EVENTS = 50000;
  const multipliers = { standard: 1, relaxed: 1.5, fast: .75, daily: 1 };
  function sequence(seed) {
    let state = 2166136261;
    for (const char of 'echo-grid-v2:' + seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
    return () => {
      let value;
      do {
        state = (state + 0x6D2B79F5) >>> 0;
        let mixed = Math.imul(state ^ (state >>> 15), state | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
        value = (mixed ^ (mixed >>> 14)) >>> 0;
      } while (value >= 4294967292);
      return value % 9;
    };
  }
  const tapPoints = round => 20 + Math.min(100, round * 5);
  const bonus = (rounds, lives) => 70 + rounds * 35 + (lives === 3 ? 50 : 0);
  function timing(round, speed) {
    const multiplier = multipliers[speed] || 1;
    return {
      duration: Math.max(225, Math.round(Math.max(225, 590 - round * 21) * multiplier)),
      gap: Math.max(110, Math.round(Math.max(110, 240 - round * 7) * multiplier)),
    };
  }
  function evaluate(seed, mode, events) {
    if (!Object.hasOwn(multipliers, mode) || !Array.isArray(events) || events.length > MAX_EVENTS) throw Error('Invalid run');
    const next = sequence(seed);
    const pattern = [next(), next()];
    let score = 0, rounds = 0, lives = 3, streak = 0, bestStreak = 0, cursor = 0, credited = 0;
    let replayAvailable = true, show = true, delay = 0, minimumMs = 0;
    for (const event of events) {
      if (!lives) throw Error('Moves after game over');
      if (show) {
        const { duration, gap } = timing(rounds, mode);
        minimumMs += delay + 620 + pattern.length * (duration + gap);
        show = false;
      }
      if (event === 'replay') {
        if (!replayAvailable) throw Error('Replay already used');
        replayAvailable = false;
        score = Math.max(0, score - 60);
        cursor = 0;
        streak = 0;
        show = true;
        delay = 0;
      } else {
        if (!Number.isInteger(event) || event < 0 || event > 8) throw Error('Invalid tile');
        if (event !== pattern[cursor]) {
          lives--;
          cursor = 0;
          streak = 0;
          show = true;
          delay = 1200;
        } else {
          if (cursor >= credited) score += tapPoints(rounds);
          cursor++;
          credited = Math.max(credited, cursor);
          streak++;
          bestStreak = Math.max(bestStreak, streak);
          if (cursor === pattern.length) {
            rounds++;
            score += bonus(rounds, lives);
            cursor = 0;
            credited = 0;
            pattern.push(next());
            show = true;
            delay = 1100;
          }
        }
      }
    }
    return { score, rounds, streak: bestStreak, lives, minimumMs };
  }
  const rules = { VERSION, MAX_EVENTS, sequence, tapPoints, bonus, timing, evaluate };
  if (typeof module !== 'undefined' && module.exports) module.exports = rules;
  else globalThis.EchoRules = rules;
})();
