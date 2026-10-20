'use strict';
(() => {
  const configured = globalThis.EchoConfig?.leaderboardUrl || '';
  let base = '';
  try {
    const url = new URL(configured);
    if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) base = url.origin;
  } catch { /* an unconfigured backend leaves local play available */ }
  let session = null;
  try { session = sessionStorage.getItem('echo-grid-session'); } catch { /* memory fallback */ }
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (fragment.has('startng_session')) {
    session = fragment.get('startng_session');
    try { sessionStorage.setItem('echo-grid-session', session); } catch { /* memory fallback */ }
    fragment.delete('startng_session');
    fragment.delete('expires_in');
    globalThis.history?.replaceState(null, '', location.pathname + location.search + (fragment.size ? '#' + fragment.toString() : ''));
  }
  async function request(path, body, auth = false) {
    if (!base) throw Object.assign(Error('Shared rankings are not connected yet.'), { status: 0 });
    if (auth && !session) throw Object.assign(Error('Sign in to enable shared rankings.'), { status: 401 });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(base + path, {
        method: body === undefined ? 'GET' : 'POST', signal: controller.signal, credentials: 'omit',
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(auth ? { Authorization: 'Bearer ' + session } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) {
          session = null;
          try { sessionStorage.removeItem('echo-grid-session'); } catch { /* optional storage */ }
        }
        throw Object.assign(Error(result.error || 'Rankings unavailable.'), { status: response.status });
      }
      return result;
    } finally { clearTimeout(timer); }
  }
  globalThis.EchoRankings = {
    enabled: Boolean(base),
    get signedIn() { return Boolean(session); },
    daily: () => request('/v2/daily', undefined, true),
    start: (mode, requestId) => request('/v2/runs', { mode, requestId }, true),
    finish: (id, events) => request('/v2/runs/' + encodeURIComponent(id) + '/finish', { events }, true),
    board: mode => request('/v2/leaderboard?mode=' + encodeURIComponent(mode)),
  };
})();
