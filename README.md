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

Run `node scripts/check-release.cjs` before pushing. It checks required publishing files, local asset references, HTML label targets, script order, the existing leaderboard fields, the cover image header, JavaScript syntax, and all gameplay regression tests. It needs Node.js but no package installation, and does not publish or contact start.ng.

For gameplay tests alone, run `node --test tests/game.test.cjs`. These tests use a simulated DOM and clock; they do not verify browser rendering or live start.ng services.

See [browser verification](BROWSER_VERIFICATION.md) for the local browser checks, responsive layout correction, and remaining device and integration checks.

## Difficulty and motion preferences

- Before a Classic run, choose **Relaxed**, **Standard**, or **Fast**. These scale sequence flash and gap durations to 150%, 100%, or 75% of the original timing, respectively. Fast retains the original minimum flash and gap durations, reaching that limit sooner. Scoring, lives, and Replay rules stay the same. Speed is locked until the run ends or you switch modes.
- **Standard** preserves the original personal best and is the only Classic speed eligible for the shared leaderboard. Relaxed and Fast each have a separate local best, and their shared result text names the speed. Choose the same speed when comparing results.
- Daily Challenge and Daily Practice always use Standard timing. Returning to Classic restores your chosen speed.
- **Reduce Motion** removes decorative animation, transitions, and tile scaling while retaining the sequence flashes needed to play. The operating system’s reduced-motion preference is respected even when the game switch is off. This option does not make the visual sequence available to a screen reader.
- In forced-colors/high-contrast mode, active tiles use the system highlight color, an outline, and a filled-circle marker so playback remains visible with reduced motion. Selected mode buttons also use a double border.
- Speed, sound, and motion preferences are remembered in this browser using `echo-grid-preferences-v1`. If storage is blocked, the controls still work for the current page. Standard records retain `echo-grid-best`; other Classic records use `echo-grid-best-relaxed` and `echo-grid-best-fast`.
- Completed Classic runs re-read the stored best before saving so a higher score already written by another tab is preserved. Idle tabs refresh their displayed records. If storage is blocked, each speed retains its best for the current page session and completion messages explain that it could not be saved. These browser records are not server-authoritative, and simultaneous writes across tabs are not transactional.

## Sharing a result

- After a run ends, the **Challenge a Friend** card shows the final score, rounds cleared, and longest streak. **Copy Result** copies that text for you to paste into a message. Nothing is posted automatically.
- Daily results include the run’s original UTC date; practice results are explicitly labelled **Daily Practice**. Results do not claim a verified rank or include the tile pattern.
- When hosted on start.ng, the result includes a clean game link, without incoming query parameters or sign-in fragments. Daily links use `?mode=daily` to open today’s challenge without starting or reserving an attempt; old patterns are not replayed from shared links.
- Local previews copy the result without a localhost or file link. If the browser cannot write to the clipboard, the text is selected for manual copying.

## Personal progress and achievements

The **Your Progress** panel tracks new completed runs in this browser. Use its selector to view Standard, Relaxed, Fast, Daily Challenge, or Daily Practice separately. Each view shows runs finished, total rounds cleared, the most rounds cleared in one run, and the longest correct-tap streak. Viewing stats does not change the game mode or speed.

A run counts when it reaches the game-over screen. Ending a saved Daily attempt with **End Daily Run** or by switching to Classic also counts, including a zero-round result. Restarting or abandoning unfinished Classic and practice runs does not count. Existing personal bests are preserved; earlier play history is not reconstructed from those scores.

Expand **Achievements** to see the six milestones and their progress:

| Achievement | Requirement |
| --- | --- |
| First Signal | Finish one run. |
| Finding Rhythm | Clear five rounds in a single run. |
| Pattern Master | Clear ten rounds in a single run. |
| In the Zone | Reach a streak of 20 correct taps. |
| One More Run | Finish ten runs across any modes. |
| Daily Explorer | Finish three Daily attempts; practice does not count. |

All speeds and modes can earn the first five badges. New unlocks appear when a run finishes. Badges do not add points or affect rankings.

Progress is stored under `echo-grid-progress-v1` and is not synced to an account or server. Clearing browser data removes it. If storage is blocked or the saved data is unreadable, the panel explains that new progress lasts for the current page session; unreadable stored data is preserved. Completed writes from other tabs are re-read before recording a run, but simultaneous writes are not transactional.

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

Source: <https://start.ng/docs.md>

### Quick GitHub upload (no command line)

In GitHub, create a new repository called **echo-grid-dan**, mark it **Public**, then use **Add file → Upload files** to upload `index.html`, `styles.css`, `daily.js`, `progress.js`, `game.js`, `startng.json`, `cover.png`, `favicon.svg`, and this README. Keep the `scripts` and `tests` folders in the source repository to retain local checks. Commit the upload to `main`. Do **not** upload the ZIP itself; upload the files inside it.

Then, on Windows PowerShell, run:

```powershell
$payload = @{ repo_url = "https://github.com/Lorddan212/echo-grid-dan"; name = "echo-grid-dan" } | ConvertTo-Json
Invoke-RestMethod -Uri "https://api.start.ng/games/check" -Method Post -ContentType "application/json" -Body $payload
$publication = Invoke-RestMethod -Uri "https://api.start.ng/games/publish" -Method Post -ContentType "application/json" -Body $payload
$publication.approve_url
```

Only publish after the check returns `ok: true`. Open the approval link shown by PowerShell, sign in with start.ng, and confirm the publication. If `echo-grid-dan` is already taken, choose a unique game name and replace it in the request. After approval, the game address is `https://echo-grid-dan.start.ng` (or the unique name you selected).
