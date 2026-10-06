# AT-2699 — assistant attachment menu

This offline fixture renders the real `CustomTextInput3`, Quill, shared chat attachment
button/selector, and responsive popup shell. Backend/navigation dependencies and visual
embeds are replaced; it does not connect to Firebase or record media.

Run with Node 22, root and `web-bundler` dependencies, and Playwright Chromium installed:

```sh
node browser-tests/at2699/run.js
```

If Playwright is installed elsewhere, set `PLAYWRIGHT_MODULE` to its module path and
`PLAYWRIGHT_BROWSERS_PATH` to its browser cache. The runner checks desktop (1280px),
phone (390px), and narrow phone (320px) layouts, text padding, shared menu actions,
file insertion at the retained caret, and read-only/default input gating. Screenshots
are written to the ignored `.build/` directory.

Offline fixture screenshots: [desktop](screenshots/desktop.png), [mobile](screenshots/mobile.png).
