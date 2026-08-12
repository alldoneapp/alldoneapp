# Modal & Popup System Improvement Plan

Audit date: 2026-08-12. Scope: every popup/modal/popover on web (desktop + mobile web).
Goal: mobile popups use the full available width and feel native (sheet-like), desktop
popups stay contextual but get one consistent sizing/spacing/motion system.

---

## 1. Audit summary — what exists today

### Scale

| Metric                                                                       | Count                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Distinct popup components (`*Modal/*Popup/*Picker/*Overlay`)                 | **174** (93 under `components/UIComponents/FloatModals/`)                |
| `react-tiny-popover` render sites                                            | **233** in 226 files (vendored + patched in `replacement_node_modules/`) |
| Fixed-overlay dialogs (`fixedModalOverlayStyle` or bespoke `position:fixed`) | ~24                                                                      |
| React Native `<Modal>`                                                       | 2                                                                        |
| Modal IDs registered in `ModalsManager`                                      | 59 of 174 (~1/3)                                                         |
| Files using `applyPopoverWidth`                                              | 124 (vs **2** on the newer `applyPopoverWidthV2`)                        |

Three rendering families coexist (anchored popover portal / fixed overlay in-tree /
RN Modal) with no shared container, no shared panel styles (`components/styles/global.js`
has zero modal style keys), and `ModalHeader` (69 users) as the only shared chrome.

### The mobile experience (the core complaint, confirmed)

- `applyPopoverWidth()` (`utils/HelperFunctions.js:439`) returns an **exact fixed width**:
  304px mobile / 368 tablet / 432 desktop, clamped to `windowWidth − 32`. On a 390px phone
  nearly every popup is a **304px card floating mid-screen** with ~43px of live app on each
  side. `applyPopoverWidthV2` (mobile = `windowWidth − 50`) was the fix, added Nov 2024
  (`9d589120c`) — but only ever adopted by `RichCommentModal` and `AutoPostponeTasksModal`.
- **No backdrop on ~240 of ~260 popups.** Only 13 overlay dialogs dim the background
  (shared token `hexColorToRGBa(colors.Text03, 0.24)`); 4 outliers use raw
  `rgba(0,0,0,.5/.7)`. Behind an open picker the app stays fully visible, scrollable and
  tappable.
- **No body scroll lock.** `isMainViewScrollEnabled` gates only the root task list; every
  DetailedView scroller and the document scroll freely behind open modals.
- **No mobile presentation mode.** Zero bottom-sheet/slide-up/swipe-dismiss code in the
  repo. Mobile adaptation today = same desktop card at 304px, minus the shortcut chips
  (~30 sites hide `<Shortcut/>`).
- **No animation** beyond the library's 0.35s opacity fade; fixed-overlay dialogs pop in
  with no transition at all. No `prefers-reduced-motion` handling.
- **Close button is a 24px icon with no padding** (`components/FollowUp/CloseButton.js`)
  — under half the 44px touch minimum, and it has already been un-clickable once due to
  RNW stacking (comment at `CloseButton.js:41-53`).
- **Keyboard**: the AT-2248 `virtualKeyboard.js` system shrinks the app shell via
  `--app-keyboard-inset`, but popover portals are `position:fixed` against the viewport,
  so **modals do not move or shrink when the keyboard opens** (iOS especially — no window
  `resize` fires). No modal is keyboard-aware; `RichCommentModal` is the only one with
  bespoke focus logic (AT-2269).
- **Safe area**: `env(safe-area-inset-bottom)` is used nowhere; modal styles have zero
  safe-area handling.
- **Android/browser back button**: not intercepted; back exits the view instead of closing
  the popup.
- Mobile bugs have been fought one at a time, each fixed locally, none generalized:
  AT-2189 (popover that fits nowhere rendered nothing), AT-2236 (tap-through opens then
  instantly closes — guard applied to exactly 1 modal), the EmailLabelChip nested-popover
  dismiss (2 different fixes for the same bug class: `emailLineHelper` stamp vs
  `RichCommentModal`'s `nestedPopupIsOpen`), AT-2210 (sidebar offset inverted on mobile),
  AT-2257 (Escape dead while inputs focused).

### Desktop sizing/positioning drift

- One fixed width (432) for everything from a 3-item picker to a rich form; ~20 unrelated
  `maxWidth` values across modals (700, 560, 548, 520, 480, 460, 432, 400, 360, 320…);
  no shared scale.
- Three edge paddings coexist: 8 (`popoverPositioning.js`), 16 (`popoverToSafePosition`),
  32 (`applyPopoverWidth` gutter, `MODAL_MAX_HEIGHT_GAP`).
- Two mobile breakpoints: `smallScreenNavigation` (≤818 or ≤611 **depending on
  `sidebarExpanded`** — user-state dependent) vs ad-hoc `windowWidth < 600` in 3
  Assistant modals.
- ~15 modals declare `width: 305`-style values that `applyPopoverWidth()` silently
  overrides in the same style array (dead code that misleads readers).
- `applyPopoverWidth` reads the store **imperatively** (`store.getState()` +
  `Dimensions.get`), so modal width does not react to resize/rotation.
- `contentLocation={mobile ? null : undefined}` appears at **136 sites** and IS
  load-bearing (verified): `typeof null === 'object'` at the vendored `Popover.js:309`
  skips the position-flip search on mobile, `undefined` keeps full desktop behavior. A
  real behavior switch hinging on a JS quirk, named nowhere.

### Duplication (consolidation candidates)

| What                          | Copies                                                                                                                                                                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project pickers               | **7** (`SelectProjectModal`, `SelectProjectModalInSearch`, `SelectSimpleProjectListModal`, `SelectProjectFromListModal`, `SelectProjectModalInInvoceGeneration`, `SelectProjectModalInGuideProjectsProperty`, `TaskDetailedView/Properties/ProjectPicker`) |
| Date pickers / calendar grids | 5+ pickers, **3** separate calendar grid implementations (`react-native-calendars` is a dependency with zero consumers)                                                                                                                                    |
| Confirm dialogs               | **8** (`ConfirmPopup` with 22 trigger constants is the intended shared one; 7 bespoke ones exist beside it)                                                                                                                                                |
| Close buttons                 | **4** implementations                                                                                                                                                                                                                                      |
| OAuth connect modals          | **5** near-identical (`ConnectCalendar/Gmail/GitHub/GitLab/GCP`)                                                                                                                                                                                           |
| `MorePopups*` wrappers        | Edit vs MainViews fork; beneath them 5× `FollowingModalItem`, 5× `DeleteModalItem`, 4× `OrganizeModalItem`                                                                                                                                                 |

Also found in passing: `GlobalModalsContainerApp.js:126-127` renders
`<LimitedFeatureModal/>` **twice** (live bug), and `utils/WrapperClickOutside.js` is dead
code (zero consumers, `mousedown`-only so it never worked on touch).

### Good bones — build on these, don't replace them

`ModalHeader` (69 users) · `modalsManager` registry · `utils/escapeStack.js` +
`hooks/useEscapeKey.js` (AT-2257) · `utils/popupDismissGuard.js` (AT-2236/AT-2189 tap
guards) · `utils/virtualKeyboard.js` (AT-2248) · `utils/popoverPositioning.js` (testable
clamp math) · `popoverToSafePosition` (the only anchored-with-flip helper) ·
`CustomScrollView` · the backdrop token `Text03 @ 0.24`.

---

## 2. Target design

### Presentation model — one rule, two worlds

**Mobile (single modal breakpoint):**

- **Bottom sheet** for pickers, menus and forms: full width, rounded top corners, drag
  handle, scrim, slide-up ~220ms, max height ~90% of the **visual** viewport
  (keyboard-aware), `env(safe-area-inset-bottom)` padding, internal scroll, swipe-down to
  dismiss (later phase).
- **Full-screen takeover** for the few large surfaces: global search, rich editors
  (RichCreateTask/Goal, RichComment), revision history, end-of-day statistics.
- Anchored popovers cease to exist on mobile.

**Desktop:**

- **Anchored popover** stays for contextual pickers/menus (no scrim), library-positioned,
  sized from the scale below.
- **Centered dialog** for forms, large content and confirmations (with scrim).

### Tokens (new module, e.g. `components/styles/modals.js`)

- Width scale: `MODAL_S = 320` (pickers/menus), `MODAL_M = 480` (forms),
  `MODAL_L = 640`, `MODAL_XL = 800` (rich content). Mobile ignores the scale (full width).
  V2's 558/758 map to M/L consumers; retire both width helpers at the end.
- One edge gap: **16** (replaces the 8/16/32 trio; `MODAL_MAX_HEIGHT_GAP` folds in).
- One backdrop token: the existing `Text03 @ 0.24` (migrate the 4 rgba outliers).
- Radius + shadow tokens; z-index ladder integrated with `modalsManager`.
- Motion: ~180ms ease-out enter (sheet: translateY; dialog: fade + subtle scale), ~120ms
  exit, `prefers-reduced-motion` → opacity-only.

### One primitive: `ModalShell`

Props sketch: `presentation` (`auto` → sheet on mobile; `anchored` | `centered` | `fullscreen`),
`size` (S/M/L/XL), `title`/`description` (renders `ModalHeader` + shared close), `onClose`.

Baked in once, deleted from ~170 call sites over time:

1. Portal + backdrop + z-order (registers with `modalsManager` automatically — fixes the
   2/3-unregistered problem).
2. Scroll lock: body + `showFloatPopup` via `useFloatPopupLock`.
3. Escape via `useEscapeKey` (LIFO stack — nested picker closes itself, not the parent).
4. The tap guards, generalized: mount-grace (AT-2236), dismiss-replay
   (`registerPopupDismiss`), and **nested-popover awareness** (child shells register with
   the parent shell; parent ignores outside-clicks while a child is open — one mechanism
   replacing the two existing ad-hoc fixes).
5. Keyboard-aware sizing from `visualViewport` (the shell recomputes max height when
   `virtualKeyboard.js` publishes an inset — fixes "modal centered under the keyboard").
6. Safe-area insets; 44px close target; focus trap + focus return (`aria-modal`) — none
   of which exists today.
7. Mobile back-button integration (`history.pushState` on sheet open, `popstate` closes).

Desktop anchored mode keeps wrapping the vendored `react-tiny-popover` (its AT-2189
patches are load-bearing; do **not** swap positioning engines during this migration). The
`contentLocation` null idiom gets a named home inside the shell and disappears from app
code.

---

## 3. Phases

### Phase 0 — Quick wins (~1–2 days, most of the visible mobile fix) — ✅ DONE 2026-08-12

Implemented as planned (plus two extra backdrop outliers found during the sweep:
`MeetingBookingPage`, `WhatsAppOnboarding`). Full Jest suite green, webpack production
build compiles. Snapshot updates in 6 `.snap` files are all the same single change —
the close button's new 44px hit-target classes.

1. **Full width on mobile in one line**: `getPopoverWidth()` mobile branch →
   `windowWidth − 24` (interim; true edge-to-edge arrives with sheets). All 124
   `applyPopoverWidth` consumers change at once. QA the fixed-layout exceptions:
   `ColorPickerModal` (272), `LockedGoalModal` (fixed 304×332), `HighlightColorModal`
   (non-responsive branch 187), `RichCreateTask/GoalModal` `minWidth: 315`, and the 20
   files doing `getPopoverWidth() − 64` arithmetic.
2. Fix the double `<LimitedFeatureModal/>` render (`GlobalModalsContainerApp.js:126-127`).
3. `CloseButton.js`: 44px hit area (padding/hitSlop) — 37 importers benefit instantly.
4. Migrate the 4 backdrop-color outliers to the shared token.
5. Delete `utils/WrapperClickOutside.js`; sweep the ~15 dead hardcoded widths.
6. Mobile-viewport QA sweep (390px) of the top ~20 popups.

### Phase 1 — Foundation (~2–3 days) — ✅ DONE 2026-08-12

Shipped: `components/styles/modals.js` (tokens), `hooks/useModalSizing.js` (reactive +
keyboard-aware via visualViewport), `nudgeIntoViewportWhen` in `utils/popoverPositioning.js`
(the named contentLocation idiom), `__tests__/ModalSystemGuardrails.test.js` (token pins,
vendored-lib semantic pin, react-tiny-popover import ratchet at 226), and the three ad-hoc
`< 600` assistant modals migrated onto the hook (first consumers). `POPOVER_EDGE_GUTTER` and
`MODAL_MAX_HEIGHT_GAP` in HelperFunctions now derive from `MODAL_EDGE_GAP`, so the legacy
and new systems share one gap constant. `getPopoverWidth`/`applyPopoverWidth` behavior
deliberately unchanged — migration to the hook happens per-modal in Phases 2–3.

1. Create the tokens module (widths, edge gap, backdrop, radius, motion, z ladder).
2. **Decide the modal-mobile breakpoint deliberately** (recommendation: a pure
   window-width check, e.g. `< 640`, independent of `sidebarExpanded`; today "mobile"
   flips at 818 or 611 depending on user state). Move the 3 ad-hoc `< 600` modals onto it.
3. `useModalSizing()` hook: reactive (subscribes to resize + breakpoint), returns
   `{ width, maxHeight, isSheet }`, keyboard-aware via `visualViewport`. Replaces the
   imperative `applyPopoverWidth`/`MODAL_MAX_HEIGHT_GAP` recipes as call sites migrate.
4. Name the `contentLocation` idiom (helper with a comment) so the `typeof null` quirk is
   documented at one site instead of implied at 136.
5. Guardrail test in the `__tests__/WebShellScrollContainers.test.js` style: no **new**
   raw `react-tiny-popover` imports outside the shell wrapper once Phase 2 lands.

### Phase 2 — `ModalShell` + bottom sheet (~1–1.5 weeks) — ✅ DONE 2026-08-12

Shipped: `components/UIComponents/ModalShell/` (`AppPopover` drop-in + `BottomSheet` +
`ModalShellContext`), `utils/bodyScrollLock.js`, `utils/safeAreaInsets.js`. The sheet bakes
in scrim, drag handle, slide-up motion (reduced-motion aware), LIFO Escape, document scroll
lock, safe-area + keyboard riding, and the AT-2236/dismiss-replay guards; dismissal is the
backdrop element itself, so nested-portal taps structurally cannot close the parent. Sheet
close is synchronous (wrappers unmount on close; exit-slide polish deferred to Phase 5).
Pilot migrated: DueDateButton, EstimationButton, TaskPriorityWrapper, Assignee,
ProjectPicker, MoreButtonWrapper (Edit). Verified: ModalShell.test.js (9 jsdom tests),
`browser-tests/modalsheet` (16 real-Chromium cases, all passing: full-width sheet, scroll
lock, AT-2236 grace timing, focused-input Escape, nested LIFO, desktop popover unchanged),
full Jest suite, production webpack build. Import ratchet lowered 226 → 222.

1. Build the shell (all seven baked-in behaviors above), sheet + centered + anchored +
   fullscreen presentations.
2. `browser-tests/` coverage (jsdom cannot reproduce these composition bugs — AT-2257
   lesson): sheet open/close/backdrop-tap, nested dismiss, keyboard overlap, AT-2236
   mount-grace, Escape stack order.
3. Pilot on the 6 highest-traffic popups: `DueDateModal`, `AssigneePickerModal`,
   `TaskPriorityModal`, `EstimationModal`, `SelectProjectModal`, one `MoreButton` menu.

### Phase 3 — Migration sweep — ✅ DONE 2026-08-12 (single codemod pass)

196 files codemodded from `<Popover>` to `<AppPopover>` in one deterministic pass —
every direct react-tiny-popover consumer except a 16-file keep-list that needs deliberate
treatment: editor-caret popups (mentions, autoformat tags, notes-editor popups),
drag-coordinate modals, `DueDateSinglePopup`'s centered-overlay pattern,
`RichCommentModal`'s dismiss-surface system, `DismissibleModal`/`withSafePopover`.
Import ratchet 222 → 26. Two jsdom-only fallouts fixed: `BottomSheet` now lazy-requires
`modalsManager` (its top-level import pulls the whole redux store behind every AppPopover
consumer and flipped a pre-existing SharedHelper↔TranslationService import-cycle winner in
14 test suites), and `DescriptionTag.test.js`'s hand-rolled styles/global mock gained
`hexColorToRGBa`. Verified: full Jest suite (2,540 tests), production webpack build,
browser-tests/modalsheet all green. Tier 3 (fixed-overlay dialogs onto a `centered`
presentation) folds into Phase 4/5 alongside consolidation.

- Tier 1: remaining anchored pickers/menus (~70) — swap `<Popover>` for the shell.
- Tier 2: form modals (~40) — centered dialog on desktop, sheet on mobile.
- Tier 3: fixed-overlay dialogs + notifications (~20) — onto `centered`/`fullscreen`.
- Every migration **deletes** local keydown listeners, bespoke backdrops, dismiss hacks
  and `MODAL_MAX_HEIGHT_GAP` math. Good fit for AI-workflow/VM-agent batches: each modal
  is an independent, verifiable unit with a repeating recipe.

### Phase 4 — Consolidation — ✅ PARTIAL 2026-08-12 (judgment-scoped)

Done: the shared `FollowUp/CloseButton` moved onto the LIFO escape stack (`useEscapeKey`),
upgrading all 37 consuming modals at once — nested pickers now take Escape first, and
Escape works while an RNW input has focus; the unimported `DescriptionModal/CloseButton.js`
was deleted (dead code). `FollowingModalItem` 5 → 1
(`MorePopupsOfEditModals/Common/FollowingModalItem.js`; entity knowledge — follower type,
id field, contacts' member/uid switch — stays at the call sites). GitHub + GitLab connect
modals merged into config-driven `ConnectRepo/ConnectRepoModal.js` (2×269 lines → 1 shared

- 2 ~35-line provider configs; import sites unchanged), now reactive via `useModalSizing`.

Deliberately NOT consolidated, after inspection: `RichCommentModal`/`BotLine` close buttons
(different composites that merely share a name); `DeleteModalItem` copies (29–60 diff lines
of entity-specific behavior — merging would only relocate code); the `MorePopups*` wrapper
fork (different modal IDs, lock mechanisms and lifecycle guards — a real state-machine
unification, high popup-lifecycle risk for zero user-visible gain); GCP/Calendar/Gmail
connect modals (structurally different flows). Still open for a future session: project
pickers 7 → 1 and calendar grids 3 → 1 (each is its own careful project), confirm dialogs
8 → 1.

Project pickers 7 → 1 (options-driven) · calendar grids 3 → 1 · confirms 8 → rebuilt
`ConfirmPopup` on the shell · OAuth connect modals 5 → 1 config-driven · merge the
`MorePopups*` fork + its 14 duplicated item components · close buttons 4 → shell-provided.

### Phase 4b/5 — Second consolidation pass + polish — ✅ PARTIAL 2026-08-12

**Swipe-to-dismiss shipped**: drag the sheet handle down >96px (or flick) to dismiss;
short drags spring back. Implemented with raw pointer events + `setPointerCapture` on the
handle's DOM node — react-native-web's responder layer failed to deliver in both jsdom
(presses) and Chromium touch emulation (mouse drags), so the shell now bypasses it for
gestures, same as the backdrop's `onClick`. Covered by two new `browser-tests/modalsheet`
cases (18 total, all green).

**Project pickers, tractable tier shipped**: new
`components/UIComponents/FloatModals/ProjectListModal/ProjectListModal.js` — flat pick-list,
`commitMode: 'click' | 'confirm'`, keyboard nav with arithmetic scroll-follow (the old
`measure()`-based follow silently no-oped: refs on a non-forwardRef row), Escape via
ModalHeader's stack-registered CloseButton. Migrated: DefaultProject settings picker
(duplicated 77-line `ProjectModalItem` fork deleted), invoice-generation picker (also fixes
its never-closing-modal leak), guide-projects picker. `SelectSimpleProjectListModal.js` and
`DefaultProject/SelectProjectFromListModal.js` deleted. Net: 3 picker implementations gone.

**Analysis banked for the remaining pickers** (agent-audited 2026-08-12): the "7 pickers"
are really 4 lists + 2 adapters + 1 trigger + a hidden ninth (`IntegrationsSettings.js:51`
local picker). None has a search field. Remaining work: (1) migrate
`SelectProjectModalInSearch` — closest to being the unified component; carries the
`ALL_PROJECTS_OPTION` sentinel (5 importers) and the AT-2257 harness; (2) split
`SelectProjectModal` into list + a `useMoveObjectToProject` hook — ~120 lines of
cross-entity move engine gated by a dead `onProjectClick` prop; **hazards**:
`MoveNoteOwner.test.js` regex-matches the source file's `else if (type === 'note')` branch
including its indentation (guards AT-2194 — rewrite it against the new location, never
delete), and #1 uses plain `guideProjectIds`-style id sets where #2 uses `real*` ones — a
product decision must pick one before merging their tab logic.

**Confirm-dialog analysis banked** (agent-audited 2026-08-12, implementation deferred):
`ConfirmPopup` is really a global modal multiplexer (5 triggers render entirely different
child components; presentation switch at :311). Tractable moves, in order: promote
`Premium/PremiumTab/ConfirmationModal` (already `{onProceed, closeModal, title,
description}`) to a canonical presentational `ConfirmDialog` and delete its
`left:'58.5%'/width:317/height:162` positioning hack; fold
`ManageTaskModal/ConfirmationModal` into it (copy is byte-identical to ConfirmPopup's
defaults); `NotAllowRemoveUserModal` → the existing `INFO` trigger (needs an i18n-key pass:
callers pass pre-translated strings, INFO translates keys);
`RevisionHistoryConfirmationModal` → shared body + drop its pointless redux funnel (its
switch case is an empty `break`), and add the missing `translate()` calls (it ships raw
English literals today, hardcoded 317×206 will clip de/es). Leave alone:
`KickUserConfirmPopup` (async precondition gates Proceed; note its "Delete user content"
option row is decorative — `selectedUserId` is never read) and `ConfirmDoneMilestoneModal`
(live firestore count in the description, deliberately anchored not centered). ConfirmPopup
debt worth fixing when touched: the standard body has NO width constraint at all (the
`maxWidth: 432` is only on the INFO variant), no maxHeight, and
`document.getElementById('root').click()` inside the DELETE_TASK case.

### Fixes round 2026-08-12 (same day, continued) — ✅

**Global search is a mobile takeover**: below the sheet breakpoint it renders opaque,
edge-to-edge, `bottom: keyboardInset` (rides the software keyboard), no radius; desktop
palette unchanged. Its close X got the 44px hit-target treatment. (It was missed by the
Phase 3 codemod because it is a fixed-overlay dialog, not a react-tiny-popover consumer.)

**Confirm-dialog tier executed**: canonical `components/UIComponents/ConfirmDialog.js`
(presentational card; host owns positioning — desktop centers via `popoverToCenter`,
mobile becomes a sheet through AppPopover; Escape on the LIFO stack). Folded in and
deleted: `Premium/PremiumTab/ConfirmationModal` (with its `left:'58.5%'`/317×162 hack) and
`ManageTaskModal/ConfirmationModal`. `NotAllowRemoveUserModal` deleted — both call sites
now dispatch the existing `CONFIRM_POPUP_TRIGGER_INFO`, so both branches of those
decisions use one dialog system. `RevisionHistoryConfirmationModal`: strings translated
(new key added to en/de/es), hardcoded `#091540`/317×206 box replaced with tokens-friendly
maxWidth and natural height. `ConfirmPopup`'s standard body finally has a width cap
(maxWidth 432 — it previously grew unbounded with long translations).

### Phase 5 — remaining polish (~3–5 days)

Swipe-down-to-dismiss on sheets · back-button close · `prefers-reduced-motion` audit ·
a11y pass (focus trap/return, `aria-modal`, contrast) · theme QA (light/dark) · device
matrix QA: 360 / 375 / 390 / 768 / 1052 / 1440, iOS Safari + Android Chrome keyboard
open/closed.

---

## 4. Risks & watch-outs

- **Phase 0's width change touches 124 modals at once.** It is the point of the change,
  but it needs the viewport QA sweep; inner layouts that assumed 304px (two-column rows,
  fixed-width day grids) may stretch oddly until their Phase 3 migration.
- **The vendored `react-tiny-popover` patches are load-bearing** (AT-2189 "commit the
  last candidate", viewport-coordinate `contentLocation`, ResizeObserver rerender). Keep
  the fork; do not attempt a positioning-engine swap (floating-ui etc.) inside this
  project.
- **`smallScreenNavigation` ≠ a pure width breakpoint** (818/611 by `sidebarExpanded`).
  If the modal breakpoint stays tied to it, a 700px window with collapsed sidebar gets
  desktop popovers; decide once in Phase 1 and write it down.
- **Keyboard sizing must come from `visualViewport`**, not `useWindowSize` (layout
  viewport) — iOS never resizes the layout viewport for the keyboard.
- **jsdom is insufficient** for dismiss/stacking/keyboard behavior; budget the
  `browser-tests/` harnesses (AT-2257 precedent) or regressions will be invisible.
- `EditTask`/Quill focus interplay (AT-2220/AT-2269): sheets hosting Quill editors must
  respect the scroll-confinement boundary and the mount-tap keyboard rules already
  established.

## 5. Sequencing rationale

Phase 0 alone removes most of the "unprofessional on mobile" impression (full width +
real close targets + no double modal) for a day or two of work. Phases 1–2 make it
durable and add the sheet feel; Phase 3 is a long mechanical tail that can run as
batched agent work; Phases 4–5 pay down duplication and finish the polish. Stopping
after any phase leaves the app strictly better than before it.
