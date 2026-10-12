# AT-2728 / AT-2734 — Stop in the live-activity header

Run with Node 22, root and `web-bundler` dependencies, and Playwright Chromium:

```sh
node browser-tests/at2728/run.js
node browser-tests/at2728/run.js --animated
```

Set `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_BROWSERS_PATH` for a separate Playwright
installation. Chromium also needs its Linux system libraries.

The fixture renders the real Anna message header, popup comment header, activity card
and Stop button with German translations and application fonts. Author data and the
cancellation backend are replaced, along with unrelated tag/media renderers; it never
connects to Firebase or cancels a real run. It checks light/dark cards at 1280px, 390px,
320px and 240px, avatar placement and alignment, different assistants, long names, missing-photo
fallbacks, button containment, 44px touch targets, keyboard activation, and one shared
pending state/request across both surfaces. Screenshots go to the ignored `.build/`
directory. Both reduced motion (spinner) and normal motion (real WebGL canvas) are checked.
The compact 28px button outline retains a 44px touch target, sits immediately left of the
animation in the header, and stays aligned in the pending state. Narrow headers wrap the
controls below the title when needed; title, controls and activity steps never overlap.

The colocated Jest suites also verify placement in the real chat and popup containers,
unchanged cancellation context, retry on errors, requester permissions, stale runs,
and standalone VM controls. Anna conversation tests verify that English/German working
text disappears only while a live card is rendered (including an earlier visible thread),
while sending, errors, offline feedback and VM interaction text remain visible. The
browser fixture checks the headers and card; it does not boot the full authenticated app.

Verified fixture screenshots: [mobile](screenshots/mobile.png),
[desktop](screenshots/desktop.png), [mobile while stopping](screenshots/mobile-stopping.png).
