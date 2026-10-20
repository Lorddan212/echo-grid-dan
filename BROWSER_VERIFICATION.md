# Browser and release verification

## Final local QA — 2026-10-20

Status: local QA passed; publishing and live verification remain. No new feature phases are planned. The earlier entries below retain evidence from each implementation phase.

- Blocked both Google Fonts hosts in a fresh Chromium context and checked the header, mode controls, stats, board, and progress panel at 320 × 568, 360 × 800, 390 × 844, 414 × 896, 600 × 800, 844 × 390, 1024 × 768, and 1440 × 900. No measured component overflow occurred.
- Reproduced a playback failure with forced colors and reduced motion together: the active and inactive tiles had identical computed backgrounds, borders, and transforms. Fixed the forced-colors presentation with system highlight colors, an outline, and a filled-circle marker; selected mode buttons now use a double border in forced colors. Inspected a screenshot of an actual playback flash after the fix.
- In a fresh touch-emulated context with forced colors and reduced motion, tapped the observed sequence for 195 points. Resizing from 390 × 844 to 844 × 390 preserved the run and kept the board within the viewport. No uncaught page errors occurred.
- Loaded the game in a fresh 320 × 568 touch-emulated context, then disconnected the network. Completed one Daily round, ended the run, and confirmed 195 points, one tracked run, First Signal unlocked, and a visible sharing card. This verifies an already-loaded game; it does not establish offline reload/install support.
- The final `node scripts/check-release.cjs` run passed all 54 tests, asset/configuration checks, and JavaScript syntax checks. `git diff --check` also passed.

### Checks still outstanding for release

- Real-phone interaction, sound quality, Safari/Firefox, and assistive-technology testing are unverified. Mobile viewport, touch, forced-color, and reduced-motion results above are Chromium emulation.
- Publishing the reviewed source and verifying the deployed files, sign-in, Standard Classic leaderboard submissions, and Daily/Practice exclusion against start.ng remain outstanding.
- Changes are local and uncommitted at the time of this QA entry; this report is not evidence of a deployment.

## Personal progress and achievements — 2026-10-20

Added local progress for all three Classic speeds, Daily attempts, and Daily Practice, plus six milestones. The local release command now includes `progress.js` in asset-order and syntax checks. All 54 regression tests and `git diff --check` passed. New coverage includes completion-only counting, separate mode totals, milestone thresholds, reloads, storage/quota failures, malformed records, and completed writes from another tab.

In the Chromium HTTP preview, completed one Daily round and ended the run. The panel displayed one finished run, one cleared round, a best run of one round, and a streak of two. First Signal unlocked; the other milestones displayed their remaining progress. Reload preserved the stats and unlock without repeating the notice. Daily Practice remained at zero.

Checked panel, stats, selector, and expanded achievement bounds at 320, 390, 768, and 1440 CSS pixels, with no measured overflow. Visually inspected the expanded panel at 320 pixels. Browser testing revealed that Enter on the new disclosure summary also triggered the game's global start shortcut; the shortcut now leaves interactive controls to their native behavior. Rechecked that Enter expands achievements while the game stays at SYSTEM READY with a visible focus outline. No uncaught page errors were observed during the progress flow.

Progress is browser-local and starts with new completed runs; earlier scores are not converted into invented history. Physical-device, assistive-technology, and live-service verification remain separate.

## Local release checks — 2026-10-20

Added `node scripts/check-release.cjs` as a dependency-free local check. It passed the publishing-file, asset-reference, label-target, script-order, leaderboard-field, cover-header, syntax, and 43 gameplay regression checks. It does not invoke the hosting service or publish the game.

Four new tests first reproduced record-storage failures: an older tab overwrote a higher saved best, malformed values were accepted as scores, blocked storage produced a misleading saved message, and idle tabs did not refresh displayed bests. All four pass after the fixes. Each Classic speed now retains a session best when storage is unavailable.

Verified the fix using two pages in a fresh Chromium context. The first page updated to a 600-point best written by the second page. During a subsequent 195-point run, the second page wrote 1000; finishing the run preserved 1000 and correctly displayed 806 points needed for a new record, without a false record celebration. This checks a completed write from another tab, not atomic simultaneous writes.

The same run used Enter to start and number keys to play. The motion control showed a keyboard focus outline, completion focused Play Again, and Tab moved onward to New Run. HTML labels and descriptions had no missing targets, and buttons had accessible names. No uncaught page errors occurred in this two-page check. This is keyboard and DOM evidence, not a screen-reader audit.

In a separate 320-pixel browser context with storage writes deliberately blocked, completing a run displayed the session-only storage explanation. The message, board, and sharing card had no measured overflow.

## Difficulty and preferences follow-up — 2026-10-20

Checked the new controls in the local Chromium preview using a fresh mobile context with touch emulation. Relaxed speed, sound off, and reduced motion on survived reload. The speed selector was disabled during play; Daily showed a disabled Standard selection, and switching back restored Relaxed. With the game motion switch off, emulating the operating system’s reduced-motion preference still produced zero-duration pad transitions.

Checked the new options, player card, stats, and board bounds at 320, 390, 414, 768, and 1440 CSS pixels: no overflow in these elements. Visually inspected the 320-pixel game column. Keyboard selection changed Classic speed without starting the game, and the controls retained visible focus outlines. No uncaught page errors occurred in the isolated browser check.

All 39 regression tests passed, including separate records and sharing labels, original Standard scoring, Daily and Practice timing, locked speed changes, blocked/malformed storage, and preference persistence. Fast also retains the original minimum flash and gap durations in later rounds. Both JavaScript syntax checks and `git diff --check` passed. The simulated start.ng connection received no score submissions for Relaxed or Fast. This is local integration evidence; production submissions were not exercised.

The earlier checks below describe the preceding sharing phase. Physical-device, other-browser, audio-listening, and live-service limitations still apply. Assistive-technology testing has not been performed; this phase does not establish full screen-reader accessibility.

## Sharing phase — 2026-10-19

Tested the local HTTP preview using Playwright with Chromium 155.0.8059.84. These checks cover the current local changes, including result sharing. They do not establish production or physical-device parity.

## Layout correction

At 320 CSS pixels, the player card extended beyond the viewport and the four-column score strip clipped six-digit scores. At widths up to 400 pixels, the header now wraps, the player card fills its row, and the stats use two columns. Wider layouts retain their existing arrangement.

Checked component bounds and stat content widths at 320, 375, 390, 414, 768, and 1440 pixels. No overflow remained in the checked header, mode picker, score strip, board, or controls. Inspected desktop and mobile screenshots, including the completed Daily result and sharing card.

## Browser checks

| Check | Observed result |
| --- | --- |
| Classic keyboard play | Two correct inputs cleared round one for 195 points. Three subsequent mistakes ended the run. |
| Classic record and restart | The completed 195-point record survived reload. Starting another run hid the previous share result. |
| Daily play | Two rapid correct inputs scored 195. Replay deducted 60, leaving 135, and became unavailable. |
| Mistake feedback | One wrong marker and one expected marker appeared with explanatory text; a life was deducted. |
| End Daily Run during feedback | Saved 135 points, one cleared round, and a streak of two; delayed playback did not resume the ended run. |
| Daily persistence and deep link | Reloading `?mode=daily` opened Daily idle. Starting again used Daily Practice. The Daily result did not create a Classic record. |
| Clipboard success | Copy Result reported success; pasting into a temporary textarea exactly matched the displayed result. |
| Clipboard failure | A simulated denied write selected the entire result and displayed manual-copy instructions. Enter in that textarea did not restart the game. |
| Touch emulation | A fresh 390 × 844 mobile context accepted actual tile taps, scored 195, and ended the Daily run. |
| Keyboard navigation | Tab reached the Daily mode button with a visible outline; Enter activated it. |
| Narrow Classic stats and reduced motion | At 320 pixels, a saved personal best of 999999 fit without stat overflow. Emulated reduced motion set the pad transition duration to zero. |
| Local sign-in | Displayed the expected hosting requirement without navigating away. |
| Console | No browser console errors or warnings observed; no uncaught page errors in the isolated Classic run. |

## Repeat locally

Serve the project over HTTP and repeat the flows above in fresh browser storage. For responsive checks, include a 320-pixel viewport and a six-digit Classic personal best. For the clipboard check, copy the game result before pasting it into a scratch field.

Run `node --check game.js`, `node --check daily.js`, and `node --test tests/game.test.cjs` for the separate syntax and simulated gameplay checks.

Final local validation: both syntax checks passed, all 33 regression tests passed, and `git diff --check` passed.

## Remaining verification

- Physical phones, Safari, and Firefox have not been tested.
- Sound toggle state was checked; audio quality was not assessed by listening.
- Authenticated start.ng sign-in, live leaderboard reads, and score submission were not tested against production.
- Touch emulation and automated geometry checks do not replace device usability testing.
