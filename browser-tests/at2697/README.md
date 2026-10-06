# AT-2697: visible caret beside inline task tags

The fixture uses the real `NoteQuill`, `TaskTagFormat`, `TaskTagWrapper`, `TaskTag`,
responsive popup shell, and note-editor CSS. Backend/navigation calls, secondary
tag controls and task-popup contents are isolated; no account or network access
is needed.

The default Chromium run checks **painted native caret pixels** at the expected
boundary, with `caret: 'initial'` screenshots. The fixture colors only the caret
red for detection and loads the repository's fonts. It covers both sides of a
standalone tag, tags beside text, adjacent tags, and tags on separate lines at
1280px and 390px widths. Real mouse clicks, left/right arrows, Shift selection,
typing on either side/between tags, Enter, Backspace/Delete, undo, opening/closing the
task popup, deferred embed activation and read-only inheritance are also checked.
Selections alone must not change the saved Delta or task metadata.

```bash
nvm use
# Existing dependency trees can be reused. Install missing tooling only.
(cd web-bundler && npm install)
npm install --prefix /tmp/at2697-tools --no-audit --no-fund playwright pngjs
/tmp/at2697-tools/node_modules/.bin/playwright install chromium firefox

PLAYWRIGHT_MODULE=/tmp/at2697-tools/node_modules/playwright \
PNGJS_MODULE=/tmp/at2697-tools/node_modules/pngjs \
node browser-tests/at2697/run.js

BROWSERS=firefox \
PLAYWRIGHT_MODULE=/tmp/at2697-tools/node_modules/playwright \
PNGJS_MODULE=/tmp/at2697-tools/node_modules/pngjs \
node browser-tests/at2697/run.js --skip-build --geometry-only
```

Use Playwright's `install-deps` if browser system libraries/fonts are missing;
the repository's `replacement_node_modules` overlay must be applied, as for
other browser harnesses. Generated bundles and screenshots are in `.build/`
(gitignored). These browser tests are run manually, outside the Jest CI jobs.

`--geometry-only` explicitly omits pixel checks: this VM's headless Firefox
captures no caret even in a plain HTML input. It still checks native selection
editability, measured caret geometry and every editing/interaction assertion.
Firefox caret paint, Safari/WebKit, actual touch keyboards and installed mobile
apps require a device/browser check. Mobile cases here are viewport tests.

Example Chromium captures (the red caret is fixture-only):

| Viewport     | Before the tag                            | After the tag                           |
| ------------ | ----------------------------------------- | --------------------------------------- |
| Desktop      | ![Before](screenshots/desktop-before.png) | ![After](screenshots/desktop-after.png) |
| Mobile width | ![Before](screenshots/mobile-before.png)  | ![After](screenshots/mobile-after.png)  |

The original blot fails the visibility regression: its outer
`contenteditable="false"` disables Quill's cursor guards. Simply removing that
attribute is insufficient between adjacent tags; the inner content must also
have a stable inline box and space separating its background from the caret.
