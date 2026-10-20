'use strict';
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const { randomUUID, createHash } = require('node:crypto');
const { mkdirSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const rules = require('../rules.js');
const modes = ['standard', 'relaxed', 'fast', 'daily'];
const fail = (status, message) => Object.assign(Error(message), { status });
const dayOf = time => new Date(time).toISOString().slice(0, 10);

// Production identity always comes from start.ng, never from a submitted player ID.
function startNgIdentity(game) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(game || '')) throw Error('Set STARTNG_GAME to the published game slug');
  return async token => {
    let response;
    try {
      response = await fetch('https://api.start.ng/games/' + game + '/player', {
        headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(5000), redirect: 'error',
      });
    } catch { throw fail(503, 'Identity provider unavailable'); }
    if (response.status === 401 || response.status === 403) throw fail(401, 'Sign in again');
    if (!response.ok) throw fail(503, 'Identity provider unavailable');
    let player;
    try { player = await response.json(); } catch { throw fail(503, 'Invalid identity response'); }
    if (!['string', 'number'].includes(typeof player?.id) || !String(player.id) || typeof player.name !== 'string') {
      throw fail(503, 'Invalid identity response');
    }
    return { id: String(player.id), name: player.name.slice(0, 100) };
  };
}
function createService({ filename = ':memory:', origin, authenticate, now = Date.now } = {}) {
  if (!origin || new URL(origin).origin !== origin) throw Error('GAME_ORIGIN must be one exact origin');
  if (typeof authenticate !== 'function') throw Error('Identity verification is required');
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, player_id TEXT NOT NULL, name TEXT NOT NULL,
      request_id TEXT NOT NULL, mode TEXT NOT NULL, day TEXT,
      seed TEXT NOT NULL, created INTEGER NOT NULL, finished INTEGER,
      score INTEGER, rounds INTEGER, streak INTEGER, digest TEXT,
      UNIQUE(player_id, request_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS daily_attempt ON runs(player_id, day) WHERE mode='daily';
    CREATE INDEX IF NOT EXISTS board_lookup ON runs(mode,day,finished);`);
  const limits = new Map();
  function limit(key, maximum) {
    const time = now();
    if (limits.size > 10000) for (const [id, value] of limits) if (value.until <= time) limits.delete(id);
    const value = limits.get(key);
    if (!value || value.until <= time) {
      if (limits.size >= 20000) throw fail(429, 'Please try again later');
      limits.set(key, { count: 1, until: time + 60000 });
    } else if (++value.count > maximum) throw fail(429, 'Please try again later');
  }
  async function body(req) {
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, 'Use application/json');
    let text = '';
    for await (const chunk of req) {
      text += chunk.toString('utf8');
      if (Buffer.byteLength(text) > 300000) throw fail(413, 'Request too large');
    }
    try {
      const value = JSON.parse(text);
      if (!value || Array.isArray(value) || typeof value !== 'object') throw Error();
      return value;
    } catch { throw fail(400, 'Invalid JSON object'); }
  }
  const publicRun = row => ({ id: row.id, mode: row.mode, day: row.day, seed: row.seed, version: rules.VERSION });
  const stats = row => ({ score: row.score, rounds: row.rounds, streak: row.streak });
  async function handle(req, res) {
    const send = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Origin');
    try {
      if (req.headers.origin && req.headers.origin !== origin) throw fail(403, 'Origin not allowed');
      if (req.headers.origin === origin) res.setHeader('Access-Control-Allow-Origin', origin);
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.writeHead(204); res.end(); return;
      }
      limit('ip:' + req.socket.remoteAddress, 600); // Do not trust arbitrary forwarded headers.
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') return send(200, { ok: true, version: rules.VERSION });
      if (req.method === 'GET' && url.pathname === '/v2/leaderboard') {
        const mode = url.searchParams.get('mode') || 'standard';
        const day = mode === 'daily' ? url.searchParams.get('day') || dayOf(now()) : null;
        if (!modes.includes(mode) || (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) ||
          !Number.isFinite(Date.parse(day)) || dayOf(Date.parse(day)) !== day))) throw fail(400, 'Invalid board');
        const entries = db.prepare(`SELECT * FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY score DESC, rounds DESC, streak DESC, finished, id) AS best
          FROM runs WHERE mode=? AND day IS ? AND finished IS NOT NULL
        ) WHERE best=1 ORDER BY score DESC, rounds DESC, streak DESC, finished, id LIMIT 50`).all(mode, day);
        return send(200, { mode, day, version: rules.VERSION, entries: entries.map((row, i) =>
          ({ rank: i + 1, player_id: row.player_id, name: row.name, stats: stats(row) })) });
      }
      const match = /^\/v2\/runs\/([a-zA-Z0-9-]{1,64})\/finish$/.exec(url.pathname);
      if (!(req.method === 'GET' && url.pathname === '/v2/daily') &&
          !(req.method === 'POST' && (url.pathname === '/v2/runs' || match))) throw fail(404, 'Route not found');
      const token = /^Bearer ([^\s]{1,4096})$/.exec(req.headers.authorization || '')?.[1];
      if (!token) throw fail(401, 'Sign in required');
      const player = await authenticate(token);
      if (!player?.id || typeof player.name !== 'string') throw fail(401, 'Invalid player');
      player.id = String(player.id);
      limit('player:' + player.id, 90);
      if (req.method === 'GET') {
        const day = dayOf(now());
        const row = db.prepare("SELECT * FROM runs WHERE player_id=? AND mode='daily' AND day=?").get(player.id, day);
        return send(200, { day, seed: 'daily:' + day, attempt: row ? {
          id: row.id, status: row.finished === null ? 'started' : 'complete', ...(row.finished === null ? {} : { stats: stats(row) }),
        } : null });
      }
      const data = await body(req);
      if (url.pathname === '/v2/runs') {
        if (Object.keys(data).some(key => !['mode', 'requestId'].includes(key)) ||
          !modes.includes(data.mode) || typeof data.requestId !== 'string' ||
          !/^[a-zA-Z0-9-]{8,100}$/.test(data.requestId)) throw fail(400, 'Invalid run request');
        const prior = db.prepare('SELECT * FROM runs WHERE player_id=? AND request_id=?').get(player.id, data.requestId);
        if (prior) {
          if (prior.mode !== data.mode) throw fail(409, 'Request ID already used for another mode');
          return send(200, publicRun(prior));
        }
        const day = data.mode === 'daily' ? dayOf(now()) : null;
        const id = randomUUID();
        const seed = day ? 'daily:' + day : randomUUID();
        try {
          db.prepare('INSERT INTO runs(id,player_id,name,request_id,mode,day,seed,created) VALUES(?,?,?,?,?,?,?,?)')
            .run(id, player.id, player.name, data.requestId, data.mode, day, seed, now());
        } catch (error) {
          if (String(error.message).includes('UNIQUE')) throw fail(409, 'Daily attempt already used');
          throw error;
        }
        return send(201, { id, mode: data.mode, day, seed, version: rules.VERSION });
      }
      const row = db.prepare('SELECT * FROM runs WHERE id=? AND player_id=?').get(match[1], player.id);
      if (!row) throw fail(404, 'Run not found');
      if (Object.keys(data).some(key => key !== 'events')) throw fail(400, 'Submit moves only');
      let result;
      try { result = rules.evaluate(row.seed, row.mode, data.events); } catch (error) { throw fail(400, error.message); }
      const digest = createHash('sha256').update(JSON.stringify(data.events)).digest('hex');
      if (row.finished !== null) {
        if (digest !== row.digest) throw fail(409, 'Run already finalized');
        return send(200, { id: row.id, stats: stats(row), version: rules.VERSION });
      }
      if (now() - row.created + 500 < result.minimumMs) throw fail(400, 'Run completed before playback could finish');
      db.prepare('UPDATE runs SET finished=?,score=?,rounds=?,streak=?,digest=? WHERE id=?')
        .run(now(), result.score, result.rounds, result.streak, digest, row.id);
      return send(200, { id: row.id, stats: stats(result), version: rules.VERSION });
    } catch (error) { send(error.status || 500, { error: error.status ? error.message : 'Service unavailable' }); }
  }
  const server = http.createServer((req, res) => { void handle(req, res); });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on('close', () => db.close());
  return server;
}
if (require.main === module) {
  const filename = resolve(process.env.DATABASE_PATH || 'server/data/echo-grid.sqlite');
  mkdirSync(dirname(filename), { recursive: true });
  const server = createService({
    filename, origin: process.env.GAME_ORIGIN,
    authenticate: startNgIdentity(process.env.STARTNG_GAME),
  });
  server.listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1', () => {
    console.log('Echo Grid leaderboard listening on port ' + server.address().port);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
module.exports = { createService, startNgIdentity };
