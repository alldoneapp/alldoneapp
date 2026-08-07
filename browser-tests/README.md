# browser-tests

Browser-level regression tests for defects that **cannot** be reproduced in the repo's Jest
setup.

Why this directory exists: this repo's Jest runs on jsdom 15, which has no `Range`,
`document.createRange` or `document.getSelection`. Quill's constructor calls
`document.getSelection()`, so **a real Quill editor cannot be instantiated in a Jest test at
all** — every editor-behaviour test is therefore necessarily a test against a double. AT-2178
is the cautionary tale: two fixes (!244, !247) shipped with green unit tests against editor
doubles, and both were inert in production because the doubles never modelled the layer that
was actually broken.

A test here bundles the **real** app modules with the app's own build pipeline
(`web-bundler/webpack.config.js`, only the entry/output overridden — see
`webpack.harness.js`) and drives them in real Chromium through Playwright, asserting on what
the user sees in the DOM.

## Running

Not part of CI's `test:web:changed` / `test:web:full` jobs (those run Jest on Node 14).
Run locally:

```bash
nvm use 22
(cd web-bundler && npm install)      # build tooling, once
npx playwright install chromium      # once
node browser-tests/at2178/run.js
```

Exit code 0 = pass. Build output goes to `browser-tests/<case>/.build/` (gitignored).

## Cases

### `at2178/` — note selection must pre-fill the create-task popup

Select text in a note, press the toolbar **Task** button: the create-task popup must be
pre-filled with the selected text **and stay pre-filled**.

The harness wires the real chain:

```
ReactQuill (note)  +  mentionsHelper.onChangeSelection
  -> EditorToolbarButton                     (real mousedown/click)
  -> mentionsHelper.captureSelectionFromEditor   (as NotesEditorView.renderTask calls it)
  -> react-tiny-popover -> ManageTaskModal -> TaskArea -> TaskEditionMode
  -> CustomTextInput3
```

Three details are load-bearing and were the difference between "reproduces" and "doesn't":

- **`ManageTaskModal` must be in the tree.** Its `CustomScrollView` performs a layout
  measurement that forces a synchronous re-render; that is the re-render that interleaves
  with the pending state update and lets react-quill wipe the pre-filled editor. A harness
  that renders `TaskEditionMode` directly passes even on broken code.
- **The popup text must be sampled over time** (`SAMPLES_MS`), not once. The bug fills the
  editor correctly and empties it a tick later.
- **Assert on every create-task input on the page**, not `querySelector`'s first match. The
  visible popup is the last one mounted; asserting on the first one passes while the visible
  one is empty.

Harness modes (query string): `?modal` (production-shaped tree), `?modal&churn` (same, with
redux dispatching throughout), plus `?popover`, `?full`, `?textinput`, `?nopopup`, `?yjs`
for narrowing a failure to a layer.
