# AT-2728 — Stop inside the live-activity card

Run with Node 22, root and `web-bundler` dependencies, and Playwright Chromium:

```sh
node browser-tests/at2728/run.js
```

Set `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_BROWSERS_PATH` for a separate Playwright
installation. Chromium also needs its Linux system libraries.

The fixture renders the real activity card and Stop button with German translations
and application fonts. Only the cancellation backend is replaced; it never connects
to Firebase or cancels a real run. It checks light/dark cards at 1280px, 390px and
320px, button containment, 44px touch targets, keyboard activation, and one shared
pending state/request across both surfaces. Screenshots go to the ignored `.build/`
directory. Reduced motion keeps the spinner; this fixture does not validate WebGL.

The colocated Jest suites also verify placement in the real chat and popup containers,
unchanged cancellation context, retry on errors, requester permissions, stale runs,
and standalone VM controls.

Verified fixture screenshots: [mobile](screenshots/mobile.png),
[desktop](screenshots/desktop.png).
