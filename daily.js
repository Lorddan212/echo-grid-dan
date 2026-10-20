/* Daily challenge v2. Legacy records remain in their v1 keys. */
'use strict';
(() => {
  const key = (day) => 'echo-grid-daily-v2:' + day;
  const day = (date = new Date()) => date.toISOString().slice(0, 10);

  function sequence(date) {
    return EchoRules.sequence('daily:' + date);
  }

  function createStore() {
    let available = true;
    const memory = new Map();
    function read(date) {
      if (!available) return memory.get(date) || null;
      try {
        const raw = localStorage.getItem(key(date));
        if (raw === null) return null;
        const record = JSON.parse(raw);
        if (!record || typeof record.id !== 'string' || !record.id ||
          !['started', 'complete'].includes(record.status) ||
          !['score', 'rounds', 'streak'].every(name => Number.isSafeInteger(record[name]) && record[name] >= 0)) {
          return { status: 'unavailable' };
        }
        memory.set(date, record);
        return record;
      } catch {
        // Unreadable records must not grant a fresh saved attempt.
        available = false;
        return memory.get(date) || null;
      }
    }
    function write(date, record) {
      memory.set(date, record);
      try {
        if (!available) return false;
        localStorage.setItem(key(date), JSON.stringify(record));
        return true;
      } catch { available = false; return false; }
    }
    return {
      get available() { return available; },
      read,
      reserve(date) {
        if (read(date) || !available) return null;
        const id = globalThis.crypto?.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2);
        const record = { id, status: 'started', score: 0, rounds: 0, streak: 0 };
        return write(date, record) ? id : null;
      },
      finish(date, id, stats) {
        const record = read(date);
        if (!record || record.id !== id || record.status !== 'started') return false;
        return write(date, { id, status: 'complete', ...stats });
      },
    };
  }
  globalThis.EchoDaily = { day, sequence, createStore };
})();
