# AT-2700: Rage Mode waits for server progress

The previous start path waited at most 4.6 animation seconds and then flew from local progress. A later profile updated local storage but left the running mission unchanged. The retained reproduction was rerun on the original code: mission 2 remained active although the server returned mission 6; the 68 existing focused tests passed.

Anna now stays in her avatar until the profile loads. The loading panel uses the existing raid card and button styles, with German, English and Spanish copy. A failed or incomplete response offers retry and exit. Neither a failed load nor leaving during a pending request submits a score or syncs stale saves. A successful empty profile starts at mission 1; newer unsynced saves retain the existing reconciliation behavior.

## Run

Use Node 22 and npm 10, with the repository and web-bundler dependencies installed.

```sh
npm test -- --runInBand components/RageMode i18n/translationKeyCoverage.test.js
PLAYWRIGHT_HOME=/path/to/playwright-install node browser-tests/rage-mode/run.js --progress
```

Playwright can be installed outside the repository (the root package does not depend on it):

```sh
npm install --prefix /tmp/at2700-browser --no-audit --no-fund playwright
PLAYWRIGHT_BROWSERS_PATH=/tmp/at2700-browser/browsers /tmp/at2700-browser/node_modules/.bin/playwright install chromium
PLAYWRIGHT_HOME=/tmp/at2700-browser PLAYWRIGHT_BROWSERS_PATH=/tmp/at2700-browser/browsers node browser-tests/rage-mode/run.js --progress
```

The browser harness runs the real arena with WebGL in Chromium at 1280×800 and 390×844, using fake profile services. It waits more than 4.6 wall-clock seconds before delivering mission 6, then repeats with a failed first request and a successful retry. It checks page position, absence of shots and writes while waiting, one request per attempt, keyboard retry, viewport fit and complete teardown. Screenshots are saved under `screenshots/`.

For manual inspection: `PLAYWRIGHT_HOME=/path/to/playwright-install node browser-tests/rage-mode/run.js --serve`, then open `http://localhost:5178/?lang=de&profileManual=1&profileFailures=1`. The first load fails; after retry, resolve it from the console with `window.__rage.resolveProfile()`.

## Verified in the VM

- Original focused baseline: 68 tests passed; the retained late-response reproduction failed (mission 2 instead of 6).
- Updated Rage Mode suites and translation coverage: 207 tests passed across 19 suites.
- Chromium desktop and phone harness: 29/29 checks passed. Flights use 50ms animation steps to keep software WebGL practical; waiting is measured against 5.2 seconds of real wall-clock time.
- Read-only production log sample since 2026-10-01: 12 of 84 profile requests exceeded 4.6 seconds; maximum latency 7.061 seconds.

Screenshots use a stand-in page and fake server services:

|         | Loading                                    | Failure                                  |
| ------- | ------------------------------------------ | ---------------------------------------- |
| Desktop | [Loading](screenshots/desktop-loading.png) | [Failure](screenshots/desktop-error.png) |
| Phone   | [Loading](screenshots/phone-loading.png)   | [Failure](screenshots/phone-error.png)   |

## Remaining device verification

On a real phone and Mac using the same account, complete a mission on one device and reopen Rage Mode on the other. Check mission and upgrades, slow-network waiting, offline error/retry, and closing while loading. This harness does not exercise real Firebase authentication or Safari/WebKit.
