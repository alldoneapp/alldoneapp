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

`web-bundler/babel.config.js` runs react-native-dotenv with `allowUndefined: false`, so the
build needs every `react-native-dotenv` name to exist somewhere. `browser-tests/babel.harness.js`
uses the repository's real `.env` when there is one and falls back to the committed
placeholder `browser-tests/env.harness` otherwise, so a fresh checkout needs no secrets.

The app source must have the `replacement_node_modules/` overlay applied
(`cp -R -f replacement_node_modules/* node_modules/`) — without the
`react-native-gesture-handler` patch the bundle throws on module eval and nothing renders.

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

### `at2202/` — assistant composer: send + call buttons must stay aligned when the field expands

Type into the assistant line: the field expands, and the voice-call button and the send button
must end up **directly below each other** while the field expands into the width the row layout
no longer needs.

Why a browser test: this is a pure flexbox-geometry defect, and Jest runs on jsdom, which
implements **no layout at all** — every box is 0×0. A unit test can only assert on style
objects, so it cannot see that `Button`'s own `buttonMaster.alignSelf: 'flex-start'`
(`components/UIControls/Button.js`) silently overrides the cluster's `alignItems: 'center'`,
which is what pulled the send button off the shared axis in the first place.

`run.js` renders the real `AssistantInputLine` against the real Redux store and asserts on
`getBoundingClientRect()`:

- collapsed: the two controls sit side by side on one row;
- expanded: same centre axis (≤ 1px) and the call button fully above the send button;
- expanded: the field is **wider** than it was collapsed;
- expanded: field and control column are the same height (no overhang);
- stability: reporting a single-line content height again (what happens once the field is
  wider and the text re-wraps) must not flip the layout back — that feedback loop is the
  "wiggle" this composer was fixed for once already.

Both the desktop and the `smallScreenNavigation` states run.

One detail is load-bearing: **headless Chromium paints no glyphs for this bundle** (neither the
field's value nor its placeholder), so the textarea's own `scrollHeight` always reports a single
line and cannot drive the expansion. The harness therefore calls the component's REAL
`onContentSizeChange` prop — located by walking the React fiber tree up from the textarea,
because react-native-web consumes that prop internally — with the height a wrapped line
produces. Everything the test is actually about (the component's state machine, the flex row,
the row/column switch, `alignSelf`, the resulting widths and heights) stays real and is measured
by the real layout engine.

The controls are located by **accessibility label**, not by a `testID` the fix happens to add,
so the harness can be run against the pre-fix code — where it fails on the reported symptom
(buttons 48px off axis, field never widens, height collapsing back on re-wrap).

### `at2220/` — clicking a task line must not make the list jump

> "When I click into a 'new task line' or click into an existing task the app should not
> 'jump around' in scrolling .. currently the input fields almost go out of the screen
> (too much below)"

A scroll position cannot be tested in this repo's Jest setup for two reasons at once: jsdom
has no layout (`scrollHeight`, `clientHeight` and every rect are 0) and Quill cannot even be
constructed there. `run.js` therefore renders the real `CustomScrollView` the task list uses
(exactly as `MainViewsContainer` mounts it) with a real `NewTaskSection` and a real
`TaskItem` inside it, clicks the line with the real mouse, and asserts on real `scrollTop`.

Two independent causes are pinned:

- **Quill 2's ancestor walk.** `focus()` → `scrollSelectionIntoView()` scrolls _every_
  scrollable ancestor up to `document.body`; Quill 1 restored its own container instead and
  touched nothing else. The app focuses the editor on mount and again on every popup
  dismiss, mention insert and assignee pick.
- **The row quadruples in height** when it becomes an editor (~34px title → ~59px input +
  55px action bar), so a line opened near the bottom edge pushes its own input and buttons
  past the fold — and Quill's caret-level scroll does not help, because the caret is at the
  _top_ of the new editor and is already visible.

Asserted for the new-task line and an existing task, on desktop / narrow desktop / mobile,
with the line mid-viewport and at the bottom edge: an already-visible line must not move the
list at all; the whole editor must end up fully visible wherever it was opened; the reveal
must never overshoot; the document must never scroll; the position must settle once and stay;
and re-focusing an open editor must not pull the list back after the user scrolled away.

Three details are load-bearing:

- **Fonts must be installed.** Without them headless Chromium shapes no glyphs, every text
  box collapses to zero height, and the editor reports a 0×0 caret — the layout the whole
  test measures simply does not exist, and every case passes vacuously.
- **The user must be a project member** (`loggedUser.projectIds`), or `SharedHelper.isMember`
  makes every editor read-only (`ql-disabled`) and it never takes focus.
- The editor is measured by **painted boxes**, not by the line's wrapper: the wrapper reports
  16px more because the editor card carries a bottom margin, which is empty spacing the user
  does not need to see. The measurement is derived from the DOM rather than a `testID` the
  fix adds, so the same run works against the pre-fix code — where all 12 cases fail.
