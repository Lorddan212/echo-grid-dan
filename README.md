# Echo Grid — memory arcade for start.ng

A responsive nine-tile memory game with Classic difficulty choices, Daily Challenge, result sharing, local achievements, accessible practice playback, and an optional shared-leaderboard service.

**Shared rankings are not live yet.** The portable service is implemented; hosting will be chosen later. `config.js` intentionally leaves `leaderboardUrl` empty. See [service setup and API contract](server/README.md).

## Run and check locally

Run `node scripts/serve.cjs`, then open `http://127.0.0.1:8767`. The static game has no dependencies or build step. An already-loaded game remains playable offline; offline reload/install support is not provided.

Run `node scripts/check-release.cjs` before pushing. Node.js 24 or newer is required for SQLite backend checks; no package installation is needed. It checks assets, HTML labels, script order, syntax, gameplay, speech/session adapters, and the HTTP service with SQLite. External start.ng identity responses are mocked. Nothing is published.

See [browser verification](BROWSER_VERIFICATION.md) for browser evidence and remaining live/device checks.

## Play and accessibility

- Watch the flashes, then tap the tiles or press number keys 1–9 in order. Correct taps register immediately.
- Three mistakes end the run. A wrong tile shows × and the expected tile shows ✓, followed by the sequence again.
- Replay is available once per run. It deducts 60 points or the remaining score if lower, and resets the current streak. The button shows its actual cost.
- Classic offers Relaxed, Standard, and Fast playback, with separate local bests and shared boards. Timing multipliers are 150%, 100%, and 75%; Fast retains minimum flash/gap durations. Speed locks during a run.
- Saved Daily attempts use Standard speed. Select **Practice without using my Daily attempt** to choose a practice speed before using the attempt. Practice is unlimited.
- **Spoken Tiles** speaks tile numbers during playback and waits for each utterance. Errors or a four-second timeout release playback; leaving a run cancels speech. Voice availability and audible quality depend on the browser/OS.
- Spoken runs are unranked practice, do not reserve Daily attempts, and use separate Classic local records because voice duration varies by device. Tile tones are suppressed during narrated flashes.
- **Strong Outlines** adds heavier borders and an active outline. **Reduce Motion** removes decorative motion while retaining flashes. OS reduced-motion and forced-colors preferences remain supported.
- Playback preferences persist when browser storage is available. Blocked storage leaves controls usable for the current page.

## Scoring season 2 and results

Each sequence position earns points once per round. Repeating a correct prefix after a mistake or Replay earns no extra points. Round bonuses and speed-independent point values remain unchanged.

Current Classic records use `echo-grid-best-v2-{standard|relaxed|fast}`, with a `-spoken` suffix for narrated practice. Old keys remain untouched; previous-rule Classic bests display separately. Daily generation and records also use version 2. New scores never go to the legacy start.ng board.

The end screen shows final score, rounds cleared, longest streak, and distance from a personal best, celebrating new records. Only completed Classic runs update local bests. Records are re-read before saving, but simultaneous localStorage writes are not transactional.

**Copy Result** includes scoring season, difficulty or Daily date, and practice labels. Hosted games include a clean play link without incoming queries or sign-in fragments. Daily links open today's challenge without reserving it. Clipboard failure selects text for manual copying. Nothing is posted automatically.

## Daily and shared rankings

- Everyone on Season 2 receives the same date-seeded Daily pattern. It resets at **00:00 UTC** (01:00 in Lagos); active runs keep their starting date.
- With a configured backend and valid sign-in session, the server reserves **one attempt per account per UTC day** before playback. SQLite enforces this across tabs/devices; the server supplies the date and seed.
- **End Daily Run** or switching to Classic saves the current result. Closing or abandoning an unfinished attempt consumes its reservation.
- Failed uploads can be retried in the same tab, including reload/sign-in when session storage works. Closing the tab can lose an unsent result but does not restore the attempt.
- Without a configured backend, one browser-local saved attempt uses `echo-grid-daily-v2:YYYY-MM-DD`. Browser clock/storage are not authoritative.
- With a configured but unreachable backend, or without sign-in, Daily becomes unranked practice. Classic can still save a local best. These runs do not submit shared scores.
- Daily has its own date-scoped board. Standard, Relaxed and Fast each have a Classic board. Each keeps one best completed run per account, comparing score, rounds, streak, then earlier completion.
- The server validates moves and minimum playback duration rather than trusting submitted totals. It cannot prove a human played; clients can inspect/script deterministic patterns. These are casual rankings, not cheat-proof competition.

The [start.ng contract](https://start.ng/docs.md) provides static hosting and one native best-run board per game. The [portable backend](server/README.md) implements the extra boards and Daily rule. Deployment and real start.ng session verification remain outstanding.

## Personal progress

**Your Progress** tracks completed runs, total rounds, best run length, and longest streak separately for Standard, Relaxed, Fast, Daily and practice. Spoken Classic counts as practice. Viewing stats does not change gameplay.

Finishing a run counts once. Ending saved Daily via its button or switching to Classic counts, including zero-round results. Restarting unfinished Classic/practice does not count. Historical progress and achievements remain; they are not ranking scores.

| Achievement | Requirement |
| --- | --- |
| First Signal | Finish one run |
| Finding Rhythm | Clear five rounds in one run |
| Pattern Master | Clear ten rounds in one run |
| In the Zone | Reach a streak of 20 correct taps |
| One More Run | Finish ten runs |
| Daily Explorer | Finish three Daily attempts; practice excluded |

Progress uses `echo-grid-progress-v1`, stays on the device, and is not reconstructed from old best scores. Blocked/corrupt storage falls back to session progress and preserves unreadable data. Cross-tab writes are re-read but not transactional.

## Publishing later

Static assets: `index.html`, `styles.css`, `config.js`, `rules.js`, `rankings.js`, `speech.js`, `daily.js`, `progress.js`, `game.js`, `favicon.svg`, `cover.png`, and `startng.json`. Keep `scripts`, `tests`, and `server` in source control for checks and backend setup.

For a new start.ng game, push the public repository, submit its URL/name to `POST https://api.start.ng/games/check`, resolve errors, then use `/games/publish` and its approval link. For an existing published game, future pushes update it automatically. See [official publishing instructions](https://start.ng/docs.md).

The original `startng.json` leaderboard declaration remains for compatibility/history. Deploying the new backend is separate. Its public HTTPS origin goes in `config.js` after a host is selected; never put tokens or secrets there.
