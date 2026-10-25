# AT-2700: Save every mission and hangar purchase before the next flight

MR !641 is merged on `origin/master` as `f7b66c4929ec8911dbe9c49a08d881c4d9f73a97` (also verified through GitLab's MR API). Its diff changes preflight loading, not the renderer's per-frame workload, pixel ratio, shadows, enemy density or controls.

## Findings and lifecycle

Before this change, completing a mission and every credit purchase in the hangar called `storeProgress`: synchronous localStorage write followed by `saveRageModeProgress`. Mission completion also submitted a non-final score and loaded the leaderboard. A pending local save was launched from profile reconciliation without awaiting it; it could overlap the flight. These paths predate !641. This is evidence of unnecessary work and possible overlap, **not a proven explanation of real-phone frame drops**.

The audit covers `RageModeButton`, `rageModeBackend`, all `raidArena` call sites, local storage in `raidProgress`, and the server profile/leaderboard handlers. There are no Rage progress `onSnapshot` subscriptions, storage-event listeners or periodic progress polling. `runHttpsCallableFunction` performs one callable request and does not subscribe. The underlying app retains its unrelated listeners; existing live task-count/Gold getters do not read game checkpoints. Explicit Gold weapon purchases remain available in the paused shop; returned progress is never adopted into a running game.

- Initial preflight fetches the authoritative server profile. A newer pending local save retains the existing reconciliation policy, but delivery finishes before takeoff. Read and save failures have separate retry/exit states.
- **Every mission completion and every successful hangar credit purchase saves locally and to the cloud.** Each checkpoint is queued separately; rapid purchases are sent in order, without overlapping requests or coalescing purchases. An older acknowledgement cannot replace the newest local checkpoint. Invalid/failed acknowledgements retain the queue and latest pending state for explicit retry.
- **Active flight performs no progress reads, saves or localStorage writes.** Launching the next mission, replaying or resetting waits for the entire save queue. A save failure keeps Anna grounded with retry/exit. Score writes and leaderboard reads occur only at game end.
- Death banks only the current mission's earned credits into the latest completed checkpoint. Quit/navigation retain completed checkpoints and purchases; unfinished mission credits are not banked, preserving the existing quit policy. Reset persists a null checkpoint so other devices reset too.
- `raidPersistence` keeps requests visible across arena teardown. Leaving/navigation does not cancel outstanding saves: all queued checkpoints finish before a reopened arena reads its authoritative profile. Failed delivery retains the latest checkpoint locally for the next preflight. Late responses cannot replace an active run.
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

- Corrected boundary-save Web/Rage/translation tests: **227/227 tests**, 19 suites passed, including delayed saves, a failed purchase within a queue, and navigation/reopening with queued saves.
- Functions profile/leaderboard: **27/27 tests**, 2 suites passed, using mocked Firestore/Gold.
- The corrected `--sync` browser suite covers immediate mission saves, two sequential purchases, delayed saves before Mission 2, zero additional progress I/O in flight, leaving/reopening with a pending save queue, failed saves/retry, page restoration and 28px loading gutters. Final counts and pipeline evidence are recorded in the MR.
- Previously verified unchanged UI/control behaviour: **33/33** preflight checks and **7/7** touch checks. The previous 44 sync checks described the superseded end-only-save design; they are replaced by the boundary-save checks above.
- Browser checks use fake services and software WebGL. No authenticated Firebase or real-device FPS result is claimed.

## Screenshots

| View        | Loading                                    | Failure                                        |
| ----------- | ------------------------------------------ | ---------------------------------------------- |
| Desktop     | [Loading](screenshots/desktop-loading.png) | [Read failure](screenshots/desktop-error.png)  |
| Phone 390px | [Loading](screenshots/390-844-loading.png) | [Save failure](screenshots/390-save-error.png) |
| Phone 320px | [Loading](screenshots/320-844-loading.png) | [Save failure](screenshots/320-save-error.png) |
| Landscape   | [Loading](screenshots/568-320-loading.png) |                                                |

## Remaining real-device checks

Check phone Safari/PWA and Mac with the same account: authoritative mission/upgrades before takeoff; mission/hangar/next mission smoothness; Game Over, exit and reset cross-device progress; slow/offline boundary save, retry, then replay/reopen. Profile frame timing and network traffic in the full app on the affected phone, including unrelated app listeners. Validate notched safe areas and keyboard focus in Safari. No real-phone performance improvement is claimed from software Chromium emulation. Merge is explicitly authorized in the task; require passing CI for the corrected MR head before merging.

The sanitizer correction also requires the updated `saveRageModeProgress` callable when this MR is eventually deployed. No environment variables or data migration are needed.
