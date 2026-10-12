# AT-2728 — Stop inside the live-activity card

Run with Node 22, root and `web-bundler` dependencies, and Playwright Chromium:

```sh
node browser-tests/at2728/run.js
```

Set `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_BROWSERS_PATH` for a separate Playwright
installation. Chromium also needs its Linux system libraries.

The fixture renders the real Anna message header, popup comment header, activity card
and Stop button with German translations and application fonts. Author data and the
cancellation backend are replaced, along with unrelated tag/media renderers; it never
connects to Firebase or cancels a real run. It checks light/dark cards at 1280px, 390px and
320px, avatar placement and alignment, different assistants, long names, missing-photo
fallbacks, button containment, 44px touch targets, keyboard activation, and one shared
pending state/request across both surfaces. Screenshots go to the ignored `.build/`
directory. Reduced motion keeps the spinner; this fixture does not validate WebGL.

The colocated Jest suites also verify placement in the real chat and popup containers,
unchanged cancellation context, retry on errors, requester permissions, stale runs,
and standalone VM controls. Anna conversation tests verify that English/German working
text disappears only while a live card is rendered (including an earlier visible thread),
while sending, errors, offline feedback and VM interaction text remain visible. The
browser fixture checks the headers and card; it does not boot the full authenticated app.

Verified fixture screenshots: [mobile](screenshots/mobile.png),
[desktop](screenshots/desktop.png).
