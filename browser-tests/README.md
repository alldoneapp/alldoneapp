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

### `at2257/` — Escape must close the Search popup (and every other popup)

> "Search Popup: I should be able to press ESC on this popup (and all others) to close it
> again."

The Escape branch in `GlobalSearchModal.onKeyDown` was written in 2021 and had never once
run. The cause is one line in a dependency:

```js
// react-native-web/dist/exports/TextInput/index.js
function handleKeyDown(e) {
    // Prevent key events bubbling (see #612)
    e.stopPropagation()
```

react-native-web's `TextInput` stops propagation of **every** keydown, and React 18 attaches
its synthetic listeners at the **root container** rather than at `document` — so the native
event dies inside the app tree. Every Escape-to-close listener in this codebase sits on
`document` or `window` in the **bubble** phase (~116 hand-rolled sites, `react-dismissible`'s
`escape` prop, `react-tiny-popover`'s `onKeyDown`, `react-hot-keys`), so all of them are dead
whenever a field has focus — which, for a modal that autofocuses its input, is always.

Why a browser test: this is a DOM event-propagation defect. Reproducing it needs a real key
event travelling through a real React root at real focus. In jsdom every layer involved
(react-native-web, React's root delegation, the browser's capture/bubble phases) would have
to be a double, and the bug lives precisely in how those layers compose — the AT-2178
cautionary tale in reverse. The unit suites (`utils/escapeStack.test.js`,
`hooks/useEscapeKey.test.js`) pin the dispatcher's _logic_; this pins that it fires at all.

`run.js` renders the real `GlobalSearchModal` the way `GlobalModalsContainerApp` mounts it —
gated on the real `showGlobalSearchPopup` redux flag, so "closed" means the component
genuinely unmounted — and presses Escape with the real keyboard, on desktop and mobile
viewports:

- Escape closes the popup **while the search field has focus** (the reported bug);
- Escape still closes it with focus outside the field (the one case that already worked);
- Escape after typing is not eaten by `SearchForm`'s early-keystroke buffer;
- nested: the first Escape closes **only** the project picker and leaves the search popup up,
  the second closes the popup;
- the `ModalsManager` registry is left clean, so the next popup is not blocked by a ghost.

Three details are load-bearing:

- **`initFirebase()` must run.** Without it `watchUserProjects` / `getAllUserProjects` throw
  inside the modal's mount effects and React unwinds the tree before it renders — the popup
  never exists and every case fails for the wrong reason.
- **Wait out `SearchForm`'s focus retry.** It re-focuses the field on a 50ms interval for
  500ms after mount; pressing Escape earlier can land while focus is still on `body`, which
  is the one state where the bug does _not_ reproduce.
- **The nested picker is mounted directly**, not opened through the scope row: that row is
  `disabled` until `getAllUserProjects` returns and the harness has no backend. Both
  components are still the real ones and register on the real stack in the real order, which
  is the whole contract under test.

Verified against three builds: with no fix, 10 of the 16 cases fail (the only behavioural
case that passes is "focus outside the field" — exactly the diagnosis). With the dispatcher
installed but no component converted, the untouched 2021 handler works again and only the
nested cases fail, which is what demonstrates the legacy bridge repairs the other ~116 popups
without editing them. With the full fix, all 16 pass.

### `at2397/` — the @-mention popup must paint above the popup that hosts its input

> "If I do at-mention in the 'Add task' popup, the at-mention popup is rendered below the
> 'Add task' popup but should be rendered above it"

Why a browser test: this is a CSS **stacking-order** defect, and jsdom has no paint order at
all — it will report two overlapping elements and has no opinion about which one the user can
see. A Jest test can assert the z-index _values_ and reason about the rest, but it cannot
verify the claim the fix actually makes, which is "the mention list is the element under the
cursor". Only a real browser answers that.

The vendored popover library portals every popover to `document.body`, so the mention list and
the popup hosting its input are **siblings in the root stacking context** — being nested
inside that popup's React tree decides nothing. `createContainer` sets only
overflow/position/top/left, so a popover that passes no `containerStyle` is left at
`z-index: auto` and loses to any sibling that sets one. The "Add task" popup sets
`zIndex: 9999` (`components/Tags/AddTaskTag.js`), so the list opened behind the card:
correctly positioned, fully painted, and invisible.

`run.js` renders a popover host carrying AddTaskTag's **real** container style together with
the real `WrapperMentionsModal`, overlapping, and then asks the browser
`document.elementFromPoint()` over the overlap. It asserts the two really do overlap (else the
run proves nothing), that the hit lands inside the mention portal, and that the mention portal's
z-index is strictly above the host's — the last one so a pass can never be an accident of DOM
order. Desktop and mobile viewports both run.

The host popup is deliberately a plain popover carrying AddTaskTag's container style rather
than AddTaskTag itself: the harness must run against the **pre-fix** code to prove it catches
the defect, and mounting the whole create-task popup would drag in project/user fixtures that
have nothing to do with stacking. Verified both ways — against the pre-fix code both viewports
fail on the reported symptom (`hit HOST popup`, `mention z-index=""`), and both pass with the
fix.

### `offline/` — offline support end-to-end machinery (OFFLINE_SUPPORT_PLAN.md Stage 8)

Drives the real offline composition through Playwright's `context.setOffline()`, which
flips `navigator.onLine` and fires the real window online/offline events — the layer
every jest test necessarily stubs:

- the connectionState listener (real events → debounce → real redux store), including
  the `''` boot state and the `'online'` recovery transition;
- the cached-snapshot gate's **default store-backed** offline check delivering a cached
  snapshot immediately while offline, and the grace timer flushing cache-only snapshots
  with real timers while online;
- the y-indexeddb note round trip with **real IndexedDB** (jsdom has none, so the jest
  suites inject stubs): content written with only the local persistence survives a full
  teardown, reopens through `prepareSyncedNoteDocument` with no Storage and no
  collaboration server, and is flagged for the Storage catch-up upload; a note with
  nothing anywhere still rejects (locked-and-retry).

The full-app service-worker boot (precache → offline reload) is deliberately NOT here:
it needs real Firebase auth/env and is covered by the `ServiceWorkerPrecache` jest
guards plus preview-channel QA. If `playwright` is not resolvable from the repo root,
point `PLAYWRIGHT_HOME` at a directory whose `node_modules` contains it.

### `at2426/` — the connection chip must not be pinned in a header that cannot hold it

"On Tablet Sizes we should also show the 'Slow Connection' etc. chip below the header like on
mobile .. otherwise it doesnt fit"

The defect is a **width**, which is the one thing jsdom can never answer: every box there
measures 0x0, so "it doesn't fit" is structurally unassertable in Jest. The Jest suites
(`connectionChipPlacement.test.js`, `TopBar.test.js`, `MainViewsContainer.test.js`) pin the
_decision_; this harness pins that the decision is the _right_ one, by mounting the REAL
`TopBarContainer` — and through it the real `TopBar`, `TopBarStatisticArea`, `XpBar`,
`GoldArea`, `TasksStatisticsArea`, `QuotaBar` and `NotificationArea` — in the app's real
shell geometry and measuring `getBoundingClientRect()`s in Chromium.

10 viewports x 4 connection states x 3 languages. Two details are load-bearing:

- **Every measurement is against a chip-absent baseline** at the same viewport (the `live`
  state renders no chip at all), so what is asserted is the chip's _own_ contribution. The
  header has pre-existing problems of its own — at 820-834px the sidebar plus the desktop top
  bar already exceed the viewport with or without a chip — and this change must be neither
  blamed for nor credited with those.
- **Language is part of the geometry, not a detail.** German's "Langsame Verbindung" is
  182.7px against "Slow connection"'s 149.7px, and at 1180/1194px the header's slack is
  154.4px — so an English-only measurement calls that a comfortable fit and ships a bug. This
  is exactly why the breakpoint is `smallScreen` and not the narrower `isMiddleScreen`.

`KNOWN_HEADER_OVERFLOW_WIDTHS` records the 1234-1500px band, where `smallScreen` has switched
off (full-size XP bar and wide pills return while the margins stay at 104px a side) and the row
has ~23px of slack at 1280px. That is pre-existing and deliberately out of scope. It is
ratcheted **both** ways: an overflow at an unlisted width fails, and a listed width that has
stopped overflowing in every state and language also fails, so the list cannot outlive the
defect it documents. It is keyed on width alone on purpose — keying on (width, language,
state) would encode today's exact translations and break on any copy edit.

### `at2460/` — the empty-inbox celebration must be visible, and the new green dot must be findable

"The celebration of empty inbox in All Projects > Tasks should be much more celebratory /
longer. Also the new placement of the green dot should be a bigger deal."

This case exists because of how the two previous passes at this feature failed. AT-2418 moved the
celebration onto the one element that genuinely changes — an 11px cell in a 371-square grid — and
nobody could find it; AT-2445 found that a loading flash had been spending the day's once-per-day
marker before the animation was ever painted. Both were green throughout. The reason is
structural: jsdom has no layout and jest never advances `requestAnimationFrame`, so in a Jest test
every `Animated.Value` sits at whatever it was last `setValue`d to and every element is 0×0. A
suite there can prove a layer is MOUNTED. It cannot prove the dot grows, that the confetti covers
the page, or that the badge stays inside the card.

The harness mounts the REAL `AllProjectsEmptyInbox` — real congrats block, real `EmptyInboxConfetti`,
real `EmptyInboxOverview` with the real `EmptyInboxTodayDot` and the real motion hooks — against the
real redux store, with today already in `emptyInboxDays` so that mounting IS the trigger.

Two details are load-bearing:

- **The frames are captured in the PAGE, not from the runner.** `waitForTimeout` + `evaluate`
  drifts by a round trip per step and drifts cumulatively: marks of 300/950/1450ms were measured
  here at 538/1204/1718ms. That is the difference between landing inside the dot's hold and
  landing after it, so the assertions would silently describe a different beat than the one they
  name — and would do it differently on a slower machine. The page schedules its own
  `setTimeout`s from mount; the runner only reads the result.
- **The pass that decides pass/fail never screenshots.** A `page.screenshot()` costs a few hundred
  milliseconds, which is a large fraction of a beat. Pictures are taken on a second page load, so
  they can be looked at without perturbing anything. `HARNESS_SHOT_DIR=<dir>` collects them.

The reduced-motion half is run as a second context with `reducedMotion: 'reduce'`, where the rule
inverts: the congratulation and the green dot are simply already there, and not one decorative
layer is rendered.

### `at2492/` — a cleared project's line must actually sweep

"I don't see the animation on the project lines." AT-2492 shipped with 43 green Jest tests and was
invisible in production, and the reason it _could_ be is structural: `__mocks__/react-native.js`
replaces `Animated.timing` with a no-op `{ start }` stub, so **no Jest test in this repo can watch
an animation advance**, and jsdom computes no layout, so `onLayout` never fires and the sweep's
leading edge — gated on a measured row width — never renders at all. Both are exactly the parts
under test.

The harness renders the real `ProjectCompletedSweep` driven by the real `useProjectCompletedSweep`
inside a row reproducing `ProjectHeader`'s own box, and reads the wash's **painted width** frame by
frame. That is what separated the two candidate diagnoses: the animation was never broken (96 →
900px across the row, edge travelling with it, correct colour and geometry), the trigger simply
never fired.

It then reproduces the actual defect end to end — All Projects drops a cleared project's block, and
the count proving it was cleared arrives from a _different_ Firestore listener, so it routinely
lands after the row has gone. Run it against the pre-fix commit and "a late clearing still sweeps"
fails while every other check passes.

`--reduce-motion` runs the second contract: nothing is rendered, and (checked in the Jest suites)
the once-per-day marker is not spent either.

### `at2495/` — a cleared project's line must come apart, right to left, in 1.2s

The line's exit is a CSS **mask** sliding across it, and jest cannot see one thing about that.
jsdom's `CSSStyleDeclaration` silently drops properties it does not implement, so `mask-image`
reads back as `''` there whether the code is right or completely wrong; `__mocks__/react-native.js`
stubs `Animated.timing`, so nothing advances; and a style object is not a paint in any case.

So the harness renders the real `useProjectCompletedSweepMotion` driving the real
`useProjectLineExit` on a row node with the real `ProjectLineDisintegration` beside it, then
**screenshots the row every ~50ms and counts surviving pixels per column**. That is the only
measurement that can tell "a mask is applied" from "the mask erases the correct half, in the correct
order, over the right amount of time". The screenshot is decoded back inside the page through a
canvas, so no PNG dependency is needed. A row pixel is identified by its signature — pure red
thinning toward white, so green and blue stay equal — because the particle layer paints over the
same scanline and a gold spark would otherwise be counted as surviving row.

**The first pass of this aimed at the wrong row.** The disintegration originally replaced the
completed TASK row's 320ms collapse, and the ask turned out to be about the project line: a task is
completed dozens of times an hour, so its exit has to be short, quiet and repeatable, while a
project's line leaves at most once per project per day and only ever because something worth marking
happened. The task row has its AT-2404 exit back; the harness moved with the effect.

It caught two things a green Jest suite could not. The row node must be an `Animated.View`: handed
the same style, a plain `View` renders the interpolations once through `toString()` and then never
updates — the mask lands on the DOM correctly and is frozen at `0%` forever while the dust, which
is animated properly, keeps moving. And the first grain generator jittered its alphas around a
smooth ramp, which makes a band that takes a pixel, gives it back and takes it again as it slides:
flicker, not dust.

Four modes, and the last two exist for one bug each:

- default — the board's verdict ("this line is leaving") lands before the celebration starts.
- `--late` — it lands 900ms **after**, which is the ordinary production order: the celebration runs
  off the `sidebarNumbers` snapshot and the hide comes through `thereAreNotTasksInFirstDay`. Stage 4
  is therefore chosen 2.1s in, from a ref, and not at `start()`. Getting that wrong is invisible in
  production — the line settles instead, which is a perfectly plausible-looking animation.
- `--stay` — the selected-project board, where the header never leaves: no mask, no particles, no
  collapse, and the row still fully painted at the end.
- `--reduce-motion` — the inverted contract: no run at all, so the line leaves exactly as it always
  did.

Both leaving modes also sample past the run to watch the **abandoned-exit backstop**: the harness
never unmounts the line, so an exit the board never finished has to put the row back rather than
leave an erased, zero-height hole that a user can neither see nor click.

### `at2503/` — the Undo notification's show/hide animation

The Undo banner used to appear and vanish on a single frame. AT-2503 gave it four entry animations
(drop, pop, glide, tilt), picked at random with a no-repeat rule, an exit that mirrors whichever one
arrived, a small beat when its content changes in place, and a line along its bottom edge that
drains over the ten seconds before it hides itself.

Jest covers the two halves it can: `undoActionBarMotion.test.js` checks the keyframe geometry
exhaustively (every entry lands at rest, every exit starts there, every entry overshoots, and no
displacement exceeds the card's own height), and `UndoActionBar.motion.test.js` drives the real
component through its real animated branch to check the lifecycle an exit animation needs — that a
dismissed banner stays mounted long enough to animate, leaves as the variant it arrived as, and is
then actually gone.

Neither can see it move. `__mocks__/react-native.js` stubs `Animated.timing` to a no-op, so no Jest
test in this repo has ever watched one of these variants advance by a frame; jsdom computes no
layout, so the countdown line — whose entire behaviour is a painted width shrinking — has no
observable width there; and `transformOrigin` is a react-native-web passthrough, so if RNW stopped
forwarding it the line would silently start collapsing towards its own middle with every Jest
assertion still green.

So this harness drives the real `useUndoActionBarMotion` on a real banner node and reads what the
browser painted: the computed transform matrix decomposed into travel, scale and rotation per frame,
and the countdown's transformed bounding box. It forces each variant in turn by patching
`Math.random` — which exercises the real picker, including the no-repeat rule, since the fraction has
to be computed against the reduced pool.

`--reduce-motion` asserts the **inverted** contract: no transform at all, no countdown line, and an
instant unmount. CLAUDE.md records a harness that asserted the animated expectations under reduced
motion and therefore reported the correct behaviour as a failure; this one does not repeat that.
