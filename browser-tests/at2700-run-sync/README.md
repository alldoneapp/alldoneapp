# AT-2700: Rage Mode keeps progress in memory until game end

MR !641 is merged on `origin/master` as `f7b66c4929ec8911dbe9c49a08d881c4d9f73a97` (also verified through GitLab's MR API). Its diff changes preflight loading, not the renderer's per-frame workload, pixel ratio, shadows, enemy density or controls.

## Findings and lifecycle

Before this change, completing a mission and every credit purchase in the hangar called `storeProgress`: synchronous localStorage write followed by `saveRageModeProgress`. Mission completion also submitted a non-final score and loaded the leaderboard. A pending local save was launched from profile reconciliation without awaiting it; it could overlap the flight. These paths predate !641. This is evidence of unnecessary work and possible overlap, **not a proven explanation of real-phone frame drops**.

The audit covers `RageModeButton`, `rageModeBackend`, all `raidArena` call sites, local storage in `raidProgress`, and the server profile/leaderboard handlers. There are no Rage progress `onSnapshot` subscriptions, storage-event listeners or periodic progress polling. `runHttpsCallableFunction` performs one callable request and does not subscribe. The underlying app retains its unrelated listeners; existing live task-count/Gold getters do not read game checkpoints. Explicit Gold weapon purchases remain available in the paused shop; returned progress is never adopted into a running game.

- Initial preflight still fetches the authoritative server profile. A newer pending final save retains the existing reconciliation policy, but delivery finishes before takeoff. Read and save failures have separate retry/exit states.
- Completed checkpoints and hangar credit purchases stay in memory, including across missions. No localStorage progress writes, score writes, leaderboard reads or progress cloud saves run during gameplay.
- Existing terminal lifecycle defines game end: shield death (`gameOver`), explicit exit, immediate navigation teardown, or confirmed start-over. A hangar between missions is part of the same run. A retry hangar after death belongs to the ended game, with its purchases flushed before replay or exit.
- Death banks only the current mission's earned credits into the latest completed checkpoint. Quit/navigation retain completed checkpoints and purchases; unfinished mission credits are not banked, preserving the existing quit policy. Reset persists a null checkpoint so other devices reset too.
- Final progress is written locally as pending, then sent asynchronously. Failed/invalid acknowledgements retain pending data for explicit retry or next preflight. Saves remain ordered; the newest state follows an outstanding older save. `raidPersistence` keeps end requests visible across arena teardown, and gates the next profile read/flight until they settle. Late responses cannot replace an active run.
- Initial loading and save waiting park the animation callback instead of polling requestAnimationFrame. Gameplay never awaits a network promise in its frame loop.
- The loading card uses a static pixel Anna badge, existing navy/gold colours, no downloads/animations, and 28px minimum outer **and** inner horizontal padding (safe-area aware; inner padding is 40px on desktop).
- Client/server sanitizers now retain extra bombs purchased with the last banked credits before clearing mission 1. Previously that valid final state could be rejected as an empty checkpoint and prevent save retry from succeeding.

## Run and verification

Use Node 22 / npm 10. For the app: `npm run dev`, then open Rage Mode from Anna's crosshair.

```sh
npm test -- --runInBand components/RageMode i18n/translationKeyCoverage.test.js
npm test -- --config ci/jest.functions.config.js --runInBand --runTestsByPath functions/RageMode/rageModeProfile.test.js functions/RageMode/rageModeLeaderboard.test.js
PLAYWRIGHT_HOME=/path/to/playwright node browser-tests/rage-mode/run.js --progress
PLAYWRIGHT_HOME=/path/to/playwright RAGE_TEST_WIDTHS=320 node browser-tests/rage-mode/run.js --sync
PLAYWRIGHT_HOME=/path/to/playwright RAGE_TEST_WIDTHS=390 node browser-tests/rage-mode/run.js --sync
PLAYWRIGHT_HOME=/path/to/playwright RAGE_TEST_WIDTHS=1280 node browser-tests/rage-mode/run.js --sync
```

The Functions command needs `functions/node_modules`. This VM had only web dependencies: firebase-admin 13.10.0 was installed in `/tmp/at2700-functions` with npm, and `/tmp/at2700-functions/jest.config.cjs` extends the repository Functions config with only the admin resolver redirected there. Exact VM command:

```sh
npm test -- --config /tmp/at2700-functions/jest.config.cjs --runInBand --runTestsByPath functions/RageMode/rageModeProfile.test.js functions/RageMode/rageModeLeaderboard.test.js
```

Browser commands in this VM additionally use:

```sh
LD_LIBRARY_PATH=/tmp/at2700-browser/libs/usr/lib/x86_64-linux-gnu \
FONTCONFIG_FILE=/tmp/at2700-browser/fonts.conf \
PLAYWRIGHT_HOME=/tmp/at2700-browser \
PLAYWRIGHT_BROWSERS_PATH=/tmp/at2700-browser/browsers \
RAGE_TEST_WIDTHS=320 node browser-tests/rage-mode/run.js --sync
```

Chromium renders the real Three.js arena via software WebGL over a stand-in page with fake callable services. The tests advance arena timestamps in 50ms steps; they validate calls/lifecycle/layout, **not real-device FPS**. Widths can be split to bound software-rendering runtime. The initial combined run exposed a harness sampling error (purchase HUD was read before its next render); the harness now waits for the updated bomb count. A later combined run was terminated with exit 143; split runs complete the same checks.

- Web/Rage/translation: **220/220 tests**, 19 suites passed.
- Functions profile/leaderboard: **27/27 tests**, 2 suites passed, using mocked Firestore/Gold.
- Preflight Chromium checks: **33/33**, desktop 1280×800 and phone 390×844; slow response, failure/retry, keyboard trapping, no stale start, wider padding, clean page restoration.
- Sync Chromium checks: **44/44** across split runs (320px: 16/16; 390px: 16/16; 1280px: 12/12), plus loading layout 568×320. Zero cloud/local progress writes through Mission 1 → hangar purchases → Mission 2; correct final save and failure/retry, including reopening while a previous save is pending.
- Chromium touch regression: **7/7**, relative touch drag, bomb button, exit/page restoration.
- Webpack harness compilation and `git diff --check` passed. No full app production build or authenticated Firebase/production-device run is claimed.

## Screenshots

| View        | Loading                                    | Failure                                        |
| ----------- | ------------------------------------------ | ---------------------------------------------- |
| Desktop     | [Loading](screenshots/desktop-loading.png) | [Read failure](screenshots/desktop-error.png)  |
| Phone 390px | [Loading](screenshots/390-844-loading.png) | [Save failure](screenshots/390-save-error.png) |
| Phone 320px | [Loading](screenshots/320-844-loading.png) | [Save failure](screenshots/320-save-error.png) |
| Landscape   | [Loading](screenshots/568-320-loading.png) |                                                |

## Remaining real-device checks

Check phone Safari/PWA and Mac with the same account: authoritative mission/upgrades before takeoff; mission/hangar/next mission smoothness; Game Over, exit and reset cross-device progress; slow/offline final save, retry, then replay/reopen. Profile frame timing and network traffic in the full app on the affected phone, including unrelated app listeners. Validate notched safe areas and keyboard focus in Safari. No real-phone performance improvement is claimed from software Chromium emulation. No merge or deployment is authorized by this MR.

The sanitizer correction also requires the updated `saveRageModeProgress` callable when this MR is eventually deployed. No environment variables or data migration are needed.
