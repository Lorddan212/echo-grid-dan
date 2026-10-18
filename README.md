# Echo Grid — memory arcade for start.ng

A free, responsive nine-tile pattern-memory game. Watch the glowing sequence, repeat it with taps or number keys, and survive for as many rounds as possible. Includes synth sounds (optional), a single replay power-up, three lives, local personal-best storage, start.ng character-profile integration and a shared leaderboard.

## Run locally

Open `index.html` in any modern browser, or run `python -m http.server 8000` from this directory and visit `http://localhost:8000`. No build step or dependencies are required. The game works offline; start.ng sign-in and leaderboards are only available when hosted under `*.start.ng`.

## Controls

- Tap / click tiles in the order they flash. Desktop players can press 1–9 for the numbered tiles.
- **NEW RUN** starts over. **REPLAY** replays the sequence once per run at a 60-point cost. **SOUND ON/OFF** toggles synthesized notes.
- A mistake uses one life. The sequence is then replayed so you can try that round again. The run ends after three mistakes.

## Publishing

1. Put these files at the root of a **public GitHub repository** (or a separate branch containing these files) and push.
2. Call `POST https://api.start.ng/games/check` with `{"repo_url":"https://github.com/YOUR-USER/YOUR-REPO","name":"echo-grid-dan"}` (include `"branch":"your-branch"` if not on the default branch).
3. Fix any checker errors, then send the same body to `POST https://api.start.ng/games/publish`.
4. Visit the `approve_url` returned by the API, sign in and approve to make your game live. Future pushes update it automatically.

The leaderboard is defined in `startng.json`: score first, rounds cleared second, best streak third. There are no API keys, passwords, or server components.

Source: https://start.ng/docs.md

### Quick GitHub upload (no command line)

In GitHub, create a new repository called **echo-grid-dan**, mark it **Public**, then use **Add file → Upload files** to upload `index.html`, `styles.css`, `game.js`, `startng.json`, `cover.png`, `favicon.svg`, and this README. Commit the upload to `main`. Do **not** upload the ZIP itself; upload the files inside it.

Then, on Windows PowerShell, run:

```powershell
$payload = @{ repo_url = "https://github.com/Lorddan212/echo-grid-dan"; name = "echo-grid-dan" } | ConvertTo-Json
Invoke-RestMethod -Uri "https://api.start.ng/games/check" -Method Post -ContentType "application/json" -Body $payload
$publication = Invoke-RestMethod -Uri "https://api.start.ng/games/publish" -Method Post -ContentType "application/json" -Body $payload
$publication.approve_url
```

Only publish after the check returns `ok: true`. Open the approval link shown by PowerShell, sign in with start.ng, and confirm the publication. If `echo-grid-dan` is already taken, choose a unique game name and replace it in the request. After approval, the game address is `https://echo-grid-dan.start.ng` (or the unique name you selected).
