# Portable Echo Grid leaderboard

Implemented and tested locally; **not deployed**. Hosting will be chosen later. The frontend remains disconnected by default.

## Runtime and configuration

Use Node.js 24 or newer with built-in `node:sqlite`; there are no npm dependencies. Tests in this workspace ran on Node 26.10.0. The Docker target is Node 24; the image has not been built here.

From the repository root in PowerShell:

```powershell
$env:STARTNG_GAME = 'echo-grid-dan'
$env:GAME_ORIGIN = 'https://echo-grid-dan.start.ng'
$env:DATABASE_PATH = 'C:\path\to\persistent-data\echo-grid.sqlite'
$env:PORT = '8787'
node server/server.cjs
```

`GAME_ORIGIN` must be one exact origin, without a trailing slash. `STARTNG_GAME` must match the published slug. `HOST` defaults to `127.0.0.1`; use `0.0.0.0` in a container behind an HTTPS proxy. The database defaults to `server/data/echo-grid.sqlite`, ignored by Git. Do not place it in a static/public directory.

Docker instructions, for later use from the repository root:

```sh
docker build -f server/Dockerfile -t echo-grid-rankings .
docker volume create echo-grid-data
docker run --name echo-grid-rankings --restart unless-stopped \
  -p 127.0.0.1:8787:8787 -v echo-grid-data:/data \
  -e STARTNG_GAME=echo-grid-dan \
  -e GAME_ORIGIN=https://echo-grid-dan.start.ng echo-grid-rankings
```

Use one service instance with a persistent local volume, an HTTPS reverse proxy, synchronized server time, and outbound HTTPS access to `api.start.ng`. Ephemeral/serverless disks are unsuitable. Do not scale separate instances onto independent SQLite files. Back up consistently: stop the service before copying the database, or use a SQLite-aware backup including WAL state. Keep backups private. Define retention/deletion procedures before inviting public traffic.

Once hosted, set `config.js` to the service's public HTTPS origin. Local development also accepts `http://localhost:PORT` and `http://127.0.0.1:PORT`. The production executable has **no authentication bypass**.

## Authentication

The browser obtains a game session through start.ng sign-in. `rankings.js` removes the `startng_session` fragment from the URL and keeps it in tab-scoped session storage, falling back to memory. Tokens are sent only to the configured backend as bearer headers, never to public board requests.

For every authenticated request, the backend calls `GET https://api.start.ng/games/{STARTNG_GAME}/player` with the bearer token and uses the returned identity. It never accepts a client-provided player ID, name, score, or date. Provider expiry produces 401; upstream failures produce 503. Tokens are neither persisted nor logged.

This follows the [start.ng game-session/player contract](https://start.ng/docs.md). Real published-origin login, token validation and proxy CORS must still be checked after hosting. Automated tests mock this external provider; they do not establish production authentication.

## HTTP contract, version 2

Responses are JSON, with errors shaped as `{"error":"message"}`. POST requires `Content-Type: application/json`. Authenticated routes require `Authorization: Bearer <game-session>`. The configured browser origin receives CORS headers; other supplied origins receive 403. Public endpoints need no token.

| Method and route | Authentication | Request and response |
| --- | --- | --- |
| `GET /health` | No | `{ok:true,version:2}` |
| `GET /v2/daily` | Yes | `{day,seed,attempt:null}` or `attempt:{id,status:"started"|"complete",stats?:{score,rounds,streak}}`. Date is server UTC. |
| `POST /v2/runs` | Yes | `{mode,requestId}` → 201 `{id,mode,day,seed,version:2}`. Mode is `standard`, `relaxed`, `fast`, or `daily`. Request ID is 8–100 ASCII letters/digits/hyphens. Day is null for Classic. |
| `POST /v2/runs/{id}/finish` | Yes | `{events:[0,1,"replay",...]}` → `{id,stats:{score,rounds,streak},version:2}`. Tiles are integers 0–8; maximum 50,000 events. |
| `GET /v2/leaderboard?mode=standard` | No | `{mode,day,version:2,entries:[{rank,player_id,name,stats:{score,rounds,streak}}]}`. Up to 50 rows. Mode defaults to Standard. |
| `GET /v2/leaderboard?mode=daily&day=2026-10-20` | No | Same response; omitted day defaults to current server UTC day. Invalid calendar dates rejected. |

Use a fresh request ID per intended run. Repeating the same start request returns the original reservation with 200. Reusing it with another mode returns 409. Daily reservation is consumed immediately, even if the client loses the response; a unique database index prevents a second reservation for that account/date. Practice uses no reservation.

Finish is account-owned and final: identical retries return 200 with the same result; different moves after finalization return 409. Zero-event finishes are valid zero-score results. The server derives pattern and score from moves, rejects repeated Replay/invalid tiles/moves after death, and enforces cumulative minimum playback time with 500 ms scheduling tolerance. A run spanning midnight stays on its original Daily board.

Errors: 400 invalid input/timing, 401 missing/expired identity, 403 wrong Origin, 404 missing route or another account's run, 409 consumed attempt/conflicting retry, 413 body over 300 KB, 415 wrong content type, 429 request limit, 503 identity-provider failure, 500 unexpected service error. Request limits are 90 authenticated calls/account/minute and 600 calls/socket IP/minute. Forwarded IP headers are not trusted; a proxy shares the socket limit, so configure edge rate limiting and tune capacity before a larger launch.

The frontend retains failed finish payloads in tab-scoped session storage for manual retry. It never submits a retry as a new attempt. Closing a tab may lose the payload; its reservation stays used.

## Validation and limits

`node scripts/check-release.cjs` runs real local HTTP/SQLite tests covering auth failures, CORS, account isolation, concurrent Daily reservations, UTC rollover, idempotency, score reconstruction, invalid events, timing, separate boards, and restart persistence. External identity responses and test time are mocked. Speech and browser adapters have independent tests.

These are casual rankings. Deterministic patterns and an inspectable client allow scripting; elapsed-time validation cannot prove human play. No prize-grade anti-cheat, distributed rate limiting, moderation UI, or account deletion UI is claimed. Stored records contain player ID/name, seed, mode/date, timestamps, totals and a move-log hash; raw moves and bearer tokens are not stored by the server.

Before connecting a public game: deploy with persistent storage and HTTPS, verify real sign-in/expiry, finish each mode, test two devices against one Daily account, verify next-day rollover and restart persistence, and confirm backup/restore. Hosting is intentionally deferred.
