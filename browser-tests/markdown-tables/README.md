# Markdown tables / AT-2683

The harness renders the real Quill note table blot, editing module and editor CSS.
It checks desktop editing and mobile touch interaction, including native vertical
page scrolling and horizontal table scrolling through Chromium's touch recognizer.
Neither swipe may open a cell editor or table controls, change note content or add
an undo entry. Intentional taps must still edit, commit a draft when switching cells
and activate table controls. Existing typing, clipboard, multiline, history and
keyboard checks also run.

Run with Node 22, the repository and `web-bundler/` dependencies installed, and
Playwright with its Chromium browser available:

```bash
node browser-tests/markdown-tables/run.js
```

If Playwright is installed outside the repository, set `PLAYWRIGHT_MODULE` to its
module path and `PLAYWRIGHT_BROWSERS_PATH` to the browser installation directory.
Build output and screenshots are saved in the ignored `.build/` directory.
The harness uses placeholder environment values when the checkout has no `.env`.

For the DOM regression tests (gesture movement/cancellation, jitter, multiple
fingers, compatibility clicks, desktop/keyboard editing and listener cleanup):

```bash
npm test -- --runInBand --watch=false --runTestsByPath components/NotesView/NotesDV/EditorView/markdownTableEditing.test.js components/NotesView/NotesDV/EditorView/markdownTableFormat.test.js
```

Before merging, verify on an iPhone with Safari and an Android device (Chrome/app
WebView): scroll a note vertically starting on a table cell, pan a wide table
horizontally, then tap a cell. Only the tap should open editing and the software
keyboard. Also check switching cells with a draft, typing, table controls and
scrolling while another cell is already being edited. Chromium touch emulation
cannot verify the platform keyboard or Safari's touch event ordering.
