# Echo Grid — memory arcade for start.ng

A free, responsive nine-tile pattern-memory game. Watch the glowing sequence, repeat it with taps or number keys, and survive for as many rounds as possible. Includes Classic and Daily Challenge modes, synth sounds (optional), a single replay power-up, three lives, local records, start.ng character-profile integration and a shared Classic leaderboard.

## Run locally

Open `index.html` in any modern browser, or run `python -m http.server 8000` from this directory and visit `http://localhost:8000`. No build step or dependencies are required. The game works offline; start.ng sign-in and leaderboards are only available when hosted under `*.start.ng`.

## Controls

- Tap / click tiles in the order they flash. Desktop players can press 1–9 for the numbered tiles.
- **NEW RUN** starts over. **REPLAY** replays the whole sequence once per run at a 60-point cost (or your remaining score if lower). The button shows the current cost. **SOUND ON/OFF** toggles synthesized notes.
- Correct taps register immediately, including quick repeated taps on the same tile.
- A mistake uses one life. An × marks your tile and a ✓ marks the expected tile, with a text explanation. The sequence is then replayed so you can try that round again. The run ends after three mistakes.
- The end screen shows your final score, rounds cleared, longest streak of correct taps, and progress toward a new personal best. Personal bests are saved when a run ends; restarting an unfinished run does not save its score. Existing saved records are retained.

## Local checks

Run `node --check game.js` and `node --test tests/game.test.cjs`. The regression tests exercise gameplay with a simulated DOM and clock; they do not verify browser rendering or live start.ng services.

## Daily Challenge

- Select **Daily Challenge** above the board. Everyone using this version gets the same date-seeded pattern. Rounds, speed, lives, Replay cost, and scoring follow the Classic rules.
- A new challenge starts at **00:00 UTC** (01:00 in Lagos). A run keeps its starting date and pattern if it crosses midnight.
- The first run is your saved attempt for that UTC date in this browser. The attempt is reserved before playback. **End Daily Run** or switching to Classic saves your current result. Reloading or closing an unfinished run uses the attempt without saving its score.
- Further attempts are labelled **Daily Practice**. Practice cannot replace the daily result or the Classic personal best. If browser storage is unavailable, daily play is practice only.
- Daily results are local to the browser, under `echo-grid-daily-v1:YYYY-MM-DD`. They do not sync across devices or accounts. The browser clock sets the date; clearing storage, changing the clock, or simultaneous starts in separate tabs can bypass the local attempt rule. This is a casual daily challenge, not server-enforced competition.
- The stable generator in `daily.js` uses a versioned seed. Changing its algorithm or daily scoring rules requires a new challenge version so different builds are not presented as comparable.
- Daily and practice scores are never submitted to the Classic leaderboard. The [start.ng leaderboard contract](https://start.ng/docs.md) documents one best-run board per game, with no date-scoped board parameter. A shared daily leaderboard remains deferred until a supported separate backend is selected.

## Publishing

1. Put these files at the root of a **public GitHub repository** (or a separate branch containing these files) and push.
2. Call `POST https://api.start.ng/games/check` with `{"repo_url":"https://github.com/YOUR-USER/YOUR-REPO","name":"echo-grid-dan"}` (include `"branch":"your-branch"` if not on the default branch).
3. Fix any checker errors, then send the same body to `POST https://api.start.ng/games/publish`.
4. Visit the `approve_url` returned by the API, sign in and approve to make your game live. Future pushes update it automatically.

The leaderboard is defined in `startng.json`: score first, rounds cleared second, best streak third. There are no API keys, passwords, or server components.

Source: https://start.ng/docs.md

### Quick GitHub upload (no command line)

In GitHub, create a new repository called **echo-grid-dan**, mark it **Public**, then use **Add file → Upload files** to upload `index.html`, `styles.css`, `daily.js`, `game.js`, `startng.json`, `cover.png`, `favicon.svg`, and this README. Commit the upload to `main`. Do **not** upload the ZIP itself; upload the files inside it.

Then, on Windows PowerShell, run:

```powershell
$payload = @{ repo_url = "https://github.com/Lorddan212/echo-grid-dan"; name = "echo-grid-dan" } | ConvertTo-Json
Invoke-RestMethod -Uri "https://api.start.ng/games/check" -Method Post -ContentType "application/json" -Body $payload
$publication = Invoke-RestMethod -Uri "https://api.start.ng/games/publish" -Method Post -ContentType "application/json" -Body $payload
$publication.approve_url
```

Only publish after the check returns `ok: true`. Open the approval link shown by PowerShell, sign in with start.ng, and confirm the publication. If `echo-grid-dan` is already taken, choose a unique game name and replace it in the request. After approval, the game address is `https://echo-grid-dan.start.ng` (or the unique name you selected).
