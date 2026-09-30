# AT-2657 background loader

This Chromium harness renders the real `LoadingData`, `Spinner`, and
`CustomScrollView` through the app's webpack configuration. It checks the 16 px
icon in a 24 px circle, a 24 px gap from the measured main-content edge,
alignment with the shared add-task button geometry, click-through behavior,
and fixed positioning during scrolling across ten responsive layouts.

From the repository root, with Node 22 and the existing app dependencies:

```sh
npm install --prefix /tmp/at2657-browser playwright
PLAYWRIGHT_BROWSERS_PATH=/tmp/at2657-browser/browsers /tmp/at2657-browser/node_modules/.bin/playwright install chromium
PLAYWRIGHT_HOME=/tmp/at2657-browser PLAYWRIGHT_BROWSERS_PATH=/tmp/at2657-browser/browsers node browser-tests/at2657/run.js
```

Chromium's system libraries must be available. If they are installed in a
custom directory, pass its library directory through `LD_LIBRARY_PATH`.
Screenshots and the compiled harness are written to the ignored `.build/`
directory beside this file. The add-task action is a reference using the real
shared geometry; this harness does not authenticate against Firebase or
exercise task creation. Safe-area values are simulated before the first render.
