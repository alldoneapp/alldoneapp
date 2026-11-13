# Web shell scrolling, safe areas, modals and popovers

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## App shell scrolling (sidebar vs. main content)

The web shell must keep a **definite** height: `html, body, #root { height: 100% }` in
`web-bundler/index.html` (deployed) and `web/index.html` (legacy template). react-navigation
used to supply that height — every screen lived in an absolutely-positioned card — and
migration Stage 2 deleted it, so for a while the shell only had `min-height: 100%`. With no
definite height every `flex: 1` box grows to its content, the inner `CustomScrollView`s
(sidebar body, `MainViewsContainer`, each DetailedView) stop scrolling internally, and the
**document becomes the only scroller**: scrolling the main content then drags the sidebar
navigation and the top bar off-screen (AT-2177), and popovers need scroll-offset hacks
(`getScrollOffsets` in `utils/HelperFunctions.js` is a leftover of that era). Keep
`body { overflow-y: auto }` as the safety valve for a screen with no inner scroller, and keep
`box-sizing: border-box` so the safe-area padding cannot push the shell past 100%.
`__tests__/WebShellScrollContainers.test.js` guards the rule in both templates.

**iOS standalone PWA safe areas (AT-2314)**: both HTML templates keep
`viewport-fit=cover`, the Apple standalone metadata and a light/default status bar, and
pad all four body edges with `env(safe-area-inset-*)`. Never reintroduce the old iOS-only
black `body` background: it was exactly what painted the top and bottom PWA bars black.
Fixed portal content does not inherit body padding. `hooks/useModalSizing.js` therefore
subtracts the measured safe-area rectangle as well as the keyboard, the bottom sheet
paints through the home-indicator region while padding its content above it, and the
vendored `react-tiny-popover` clamps anchored/fixed portals inside the safe rectangle.
The sheet's upward handle over-drag is limited by its remaining top clearance, so a
full-height sheet cannot be pulled into the status/header safe area.
Browsers without safe-area insets resolve every value to zero, preserving desktop,
Android and ordinary mobile-browser geometry. Keep the deployed `web-bundler/` and legacy
`web/` templates/manifests aligned; `__tests__/WebShellScrollContainers.test.js`,
`utils/safeAreaInsets.test.js`, `hooks/useModalSizing.test.js`, and the modal/popover suites
pin the contract.

**Every other popup sizes itself through `utils/modalSafeArea.js` (AT-2339).** AT-2314
above only reached the two surfaces built on `useModalSizing` — the bottom sheet and the
comment popup — because it fixed **position**, not **height**. The vendored popover patch
nudges a portal into the safe rectangle, but a card taller than that rectangle simply
overflows the opposite edge once its top is clamped, and **~10 call sites pass
`disableReposition`, which skips that nudge entirely** (the comment popup is one; it reads
correctly only because `popoverToTop` pins it at a hard 80px). Everything else measured
against the raw window: ~75 popover-content modals capped at `windowHeight -
MODAL_MAX_HEIGHT_GAP`, and the centred `position: fixed` overlay family capped in percent
— `maxHeight: '90%'` is a ~42px top gap on an 844pt iPhone against a 47px inset, which is
how the "new day" popup (`EndDayStatisticsModal`) ended up under the Dynamic Island.

The module is the single authority for popup geometry: `getSafeAreaModalMaxHeight`
(the drop-in for `height - MODAL_MAX_HEIGHT_GAP`), `getSafeAreaModalMaxWidth` (now behind
`applyPopoverWidth`, so the landscape cutout no longer makes a "full width" card overhang),
`getSafeAreaModalMaxHeightBelow` (the mentions dropdown — its top offset is **already** a
clamped viewport coordinate, so subtracting the top inset again would double-count it) and
`getSafeAreaOverlayPadding` via `hooks/useSafeAreaOverlayPadding.js`.

Two rules that are easy to get wrong. **Overlay padding goes on the overlay, never on the
card** — a percentage `max-height` resolves against the containing block's CONTENT box, so
padding the inset-0 centring parent is exactly what makes the family's existing
`'90%'`/`'94%'` caps correct with no per-modal retuning; padding the card would instead
shrink its content. And the padding uses **minimum semantics, `max(existingGap, inset)`,
not additive** — that is what makes the sweep provably non-regressive: a dialog whose gap
already clears the system UI does not move a pixel, so the comment popup's 80px offset is
byte-identical to before and only gains a horizontal clamp. Additive would have shoved the
one surface that was signed off as correct 47px down the screen.

**Minimum semantics are for gaps measured from the SCREEN edge; an offset measured from
the CONTENT area is additive instead.** The two header project switchers pin themselves at
a literal `{ top: 60, left: 16 }` _and_ pass `disableReposition`, so nothing clamps them at
all. But `60` was measured against the app header, and the shell already pads `body` with
`env(safe-area-inset-*)` — so the header starts at `insets.top` while a `position: fixed`
portal does not inherit that padding. `max(60, 59)` would leave one pixel of clearance
under a Dynamic Island; `offsetPopoverInsideSafeArea` (`utils/popoverPositioning.js`)
therefore ADDS the inset and then clamps, so the offset cannot push a tall popover off the
bottom. Getting this backwards is silent — it looks fixed and is still one pixel wrong.

A second sweep covered the spellings the first codemod could not see, and each needed its
own ratchet: a cap re-derived from a local constant (`windowHeight - MODAL_VERTICAL_MARGIN

- 2`, where that constant is exactly the 32 of `MODAL_SAFE_AREA_GAP`—`ConnectRepoModal`even called the inset-aware`useModalSizing`and then discarded its`maxHeight`), a raw
`vh`unit (a fraction of the RAW viewport, blind to the insets — use`getSafeAreaViewportHeightCap`), and a literal `contentLocation` coordinate pair. Treat
  "the guardrail is green" as meaning only "no file matches the idioms we already know";
  the misses were found by auditing for the geometry, not by grepping for the pattern.

The hook exists rather than a bare function call because these dialogs subscribe to redux,
not to the viewport: without its `useWindowSize()` a rotation would leave a landscape
overlay padded with the portrait insets. `__tests__/PopupSafeAreaGuardrails.test.js`
ratchets the whole thing — no component may subtract the raw gap from a window height
again, and every overlay-family member must apply the shared padding **last** in its style
array (first would let the static `paddingTop` it is meant to override win). Note the
`react-tiny-popover` ratchet in `__tests__/ModalSystemGuardrails.test.js` is a **substring**
match over file sources, so even naming the package in a comment counts as a new importer.

**"Open view in new window" cannot reach a browser tab from an installed PWA without an
out-of-scope hop (AT-2345).** The top-right button in every detailed view
(`OpenInNewWindowButton`, plus `OpenInNewWindowModalItem` in the more-menus) was a bare
`window.open(window.location, '_blank')`. That is correct in a browser tab and wrong in an
installed app window: Chromium and WebKit both keep a navigation whose target falls inside
the app's **manifest scope** inside the app, so the click spawns a second PWA window. Neither
manifest declares a `scope`, so it defaults to the `start_url` directory (`/`) — the whole
origin — and every Alldone URL is in scope. Nothing changed in the button; the app only
recently became a _genuinely installable_ desktop PWA (the web-bundler manifest became the
deployed pipeline on 2026-08-04, then the workbox service worker landed with offline support),
and before that a macOS "app" was a plain shortcut window that delegated `_blank` to the
browser. **No web API overrides the scope decision** — the only lever the page has is making
the destination out-of-scope. `utils/openInNewWindow.js` therefore opens the
`openInBrowserTab` Cloud Function (`functions/WebApp/openInBrowserTab.js`, on
`*.cloudfunctions.net`, a different origin and so unambiguously out of scope), which 302s to
the real URL; the browser opens the out-of-scope target in a normal tab and follows the
redirect there. Three carve-outs are deliberate and load-bearing: an ordinary browser tab
keeps the direct `window.open` (no hop, no dependency on the redirector being reachable);
**iOS/iPadOS home-screen apps keep it too** (`navigator.standalone === true` — there `_blank`
already hands the URL to the browser, so the bounce would only add a failure mode); and every
way of failing to build the bounce falls back to the direct call, so the button can never
become a no-op. The redirector is an open-redirect by construction, hence the explicit host
allowlist (`isAllowedRedirectTarget`) — anything not an Alldone origin is 400, never
redirected to. `window.open` must stay **synchronous** in the click handler on every path or
desktop popup blockers eat it. Pinned by `utils/openInNewWindow.test.js` and
`functions/WebApp/openInBrowserTab.test.js`. Note the browser, not the app, has the last
word: if a future Chromium re-captures redirect chains back into the app window, the result
degrades to today's behaviour rather than breaking.

## Modals and Popups

Handle event propagation carefully. Set proper z-index and container `<div>` elements.

**A `document`-level keydown listener never sees a key while a react-native-web `TextInput` has focus (AT-2257).** `TextInput.handleKeyDown` opens with an unconditional `e.stopPropagation()` ("Prevent key events bubbling", upstream react-native-web #612), and React 18 attaches its synthetic listeners at the **root container**, not at `document` — so stopping propagation there kills the **native** event while it is still inside the app tree. Every Escape-to-close handler in this codebase was registered on `document` or `window` in the **bubble** phase: ~116 hand-rolled `document.addEventListener('keydown', …)` sites, `react-dismissible`'s `escape` prop (`keyCode === 27`), `react-tiny-popover`'s `onKeyDown` (window) and `react-hot-keys`/hotkeys-js. All of them were dead whenever a field had focus, which for a modal that autofocuses its input is **always** — the global search modal's `if (key === 'Escape') hidePopup()` was written in 2021 and had never once run in production. The failure is invisible rather than loud: the code reads correctly, and it works the moment you blur the field, which is exactly what you do when you go looking for the bug.

The fix is the **phase**, not the handler. `utils/escapeStack.js` installs ONE `keydown` listener on `document` in the **capture** phase (installed from `AppNavigator`'s `AppContainer`, the one component that mounts once for the whole app and already owns the app's document-level listeners). Capture runs on the way down, before the event reaches the input, so nothing downstream can swallow it. Two things sit on top: a **LIFO stack** for components that opt in via `hooks/useEscapeKey.js` — the most recently mounted layer gets the key, which is what makes a picker opened inside a modal close itself and leave the modal up, and what a bubble-phase `document` listener structurally cannot do (`stopPropagation` does not stop a **sibling** listener on the same node, so the picker and the modal underneath both closed on one keypress) — and a **legacy bridge** for the ~116 popups that are not on the stack: if the event never completes its trip to `document`, it was swallowed, so an equivalent Escape is re-emitted there. Detection is behavioural (a second listener on the document **bubble** phase records arrival), not a guess about which widget swallows what, so the bridge is self-limiting: the day react-native-web stops calling `stopPropagation` it goes quiet on its own, and it never double-fires. Three things it deliberately keeps its hands off, because they own Escape themselves: an in-progress IME composition, a native `<select>`, and Quill's open toolbar picker (`.ql-expanded` — the same selector `GeneralAppShortcuts.openGloablSearchModal` already gates on). It also never calls `preventDefault()`; Escape has real browser-level meaning and the popups only ever wanted to close themselves. **Do not fix this by re-vendoring react-native-web** — that patch was retired on purpose in migration Stage 2. Pinned by `utils/escapeStack.test.js`, `hooks/useEscapeKey.test.js` and `browser-tests/at2257` (a real browser is required: in jsdom every layer involved would be a double, and the defect lives in how they compose).

**Chat message edit dismiss race**: In `components/ChatsView/ChatDV/EditorView/MessageItem.js`, opening the per-message edit `DismissibleItem` directly from the timestamp/pencil click can mount `react-dismissible` early enough that the same click is interpreted as an outside-dismiss click. Symptoms: the edit handler fires, `openModal()` runs, `onToggleModal(true)` is immediately followed by `onToggleModal(false)`, and nothing appears on screen. Defer the `openModal(true)` call with `setTimeout(..., 0)` after dispatching `setActiveChatMessageId(message.id)`, and clear the timeout on unmount. If diagnosing this path, use scoped logs around `MessageItemHeader` click handling, `enableEditMode`, and `MessageItemContent`'s `onToggleModal`.

**Modal system (target state — MODAL_IMPROVEMENT_PLAN.md)**: new/migrated popups size
themselves through `hooks/useModalSizing.js` + the tokens in `components/styles/modals.js`
(width scale S/M/L/XL, `MODAL_EDGE_GAP` 16/side, `MODAL_SHEET_BREAKPOINT` 640 — a **pure
window-width** mobile check, unlike `smallScreenNavigation` which flips at 818/611 depending
on `loggedUser.sidebarExpanded`). The hook is reactive (resize + visualViewport) and
**keyboard-aware**: it subtracts the visual-viewport keyboard inset from `maxHeight`,
because popover portals are `position: fixed` and the app shell's `--app-keyboard-inset`
shrink cannot move them (iOS never resizes the layout viewport for the keyboard). The
`contentLocation={mobile ? null : undefined}` idiom has a named home:
`nudgeIntoViewportWhen` in `utils/popoverPositioning.js` (`null` is `typeof 'object'`, which
makes the vendored react-tiny-popover skip its position-flip search — pinned by
`__tests__/ModalSystemGuardrails.test.js`, which also ratchets direct `react-tiny-popover`
imports: the count may only go down; build new popups on the shared system instead).

**ModalShell (Phase 2)**: `components/UIComponents/ModalShell/AppPopover.js` is the drop-in
replacement for a direct `<Popover>` — desktop renders the vendored react-tiny-popover
unchanged (all props pass through); below `MODAL_SHEET_BREAKPOINT` the content renders as
`BottomSheet.js`: a full-width bottom sheet portal with scrim, bounded bidirectional handle
dragging, distance/velocity swipe-down dismissal, snap-back motion (reduced-motion aware),
document scroll lock (`utils/bodyScrollLock.js`), safe-area padding
(`utils/safeAreaInsets.js` — env() measured via probe, CSS can't reach fixed portals),
keyboard-riding (`bottom: keyboardInset`), Escape via `useEscapeKey` (LIFO — a nested sheet
closes first), and the AT-2236 mount-grace + dismiss-replay guards baked in. **Sheet
dismissal is its own backdrop element, not a window click listener**, so taps in nested
portals can structurally never dismiss the parent (the EmailLabelChip/RichCommentModal bug
class). Sheet close is synchronous by design — wrappers unmount the subtree on close, so an
exit animation could never play (and RNW Animated completion callbacks don't fire under
jsdom); slide-out polish is Phase 5. The sheet card is `colors.Secondary400`, matching the
FloatModals card color, so existing modal contents render seamlessly inside it without
relinquishing their own chrome (that migration comes per-modal via `ModalShellContext`).
Migrated so far: DueDateButton, EstimationButton, TaskPriorityWrapper, TaskDetailedView
Assignee + ProjectPicker, MorePopupsOfEditModals MoreButtonWrapper.
**The breakpoint may change while a popup is open, but its content tree must not (AT-2607).**
`AppPopover` owns one stable `display: contents` portal container and its desktop/sheet
hosts only move that container in the DOM. This preserves component state, uncontrolled
form state and editor instances while rotation still switches presentation responsively;
the stable portal also provides the current `ModalShellContext`, since a React portal
inherits context from its logical owner rather than its physical DOM parent. Do not put
the content back under the conditional `<Popover>` / `<BottomSheet>` branches. Pinned by
the form-state rotation case in `ModalShell.test.js` and `browser-tests/modalsheet`.
**`PopupDismissSurface` must stand down inside a sheet (AT-2287)**: the surface's
window-capture outside-gesture guard treats the sheet's own chrome (handle strip,
backdrop) as "outside" — it swallowed the handle's `touchstart` at capture (so the
drag never started; "dragging does nothing") and dismissed the popup on release
(so a partial drag closed instead of springing back). The surface now skips
installing the guard when `useModalShellPresentation() === 'sheet'`; the
BottomSheet owns dismissal there (backdrop, Escape, handle drag). Desktop popover
mode is unchanged — there the guard IS the outside-click dismissal. Pinned by
`RichCommentDismissSurface.test.js` ("stands down inside a bottom sheet"). Pinned by
`components/UIComponents/ModalShell/ModalShell.test.js` (jsdom, real guard + escape stack)
and `browser-tests/modalsheet` (real Chromium: touch grace timing, focused-input Escape,
nested LIFO, scroll lock).

**The assistant line (2026-11-13 layout).** `AssistantOptions` is a compact header (32px avatar,
the assistant's name, "How can I help?") above ONE composer box: a multi-line field (two lines at
rest, six before it scrolls, `assistantInputLayout.js`) with a toolbar under it — + and **Templates**
("Vorlagen", the all-projects pre-configured task picker, current assistant listed first) on the
left; mic, call and send on the right. The per-assistant task chips, the Search pill, More, the
measuring copies, the side-by-side send/call stacking and the round switch button are gone: the
name is the switcher (`AssistantSwitchControl` with `label`). The + and mic still belong to
`CustomTextInput3` (dictation and push-to-talk live there) and are portalled into the toolbar slots
through `inlineControlTargets`; with it set the field reserves no strip for them. The skeleton
reserves `ASSISTANT_COMPOSER_BOX_RESTING_HEIGHT`. The Last comment header reads "Last comment in ● Project"
… "All chats": the comment's project as caption text with its coloured dot (a ProjectTag pill there
looked heavy), shown only on the All projects line, since inside a project it is always that
project. The card's title line is the topic name alone. "All chats" (`openChatsList.js`) opens the line's project, or all projects
on the All projects line. The rage
mode crosshair moved to the Empty inbox card (`rage-mode.md`). Pinned by `AssistantOptions.test.js`,
`AssistantLineSkeleton.test.js`, `openChatsList.test.js` and `AssistantTaskSearchButtonWrapper.test.js`.
AT-3020: the popover a Last comment card opens (real comment or pending send) shows "All chats" next
to "open chat" (`CommentPopupFooter`), with the same target as the header link. `RichCommentModal`
shows it only when the caller passes `onOpenAllChats`; no other comment popup does.

**Simple sidebar Wiki and Chats rows** (AT-3020): under the people list of the selected project, the
simple sidebar has a Wiki row and, directly below it, a Chats row (`SidebarMenu/Items/WikiItem.js`,
`ChatsItem.js`, both drawn by `SidebarLinkItem`). Neither hides behind "show more", and neither shows
for a guest of a shared project. Chats opens the same tab as the advanced sidebar's Chats header
(`SidebarMenu/openSidebarChats.js`): Followed, unless only unfollowed chats have unread comments.
Pinned by `ChatsItem.test.js`, `openSidebarChats.test.js` and `TasksBoards.test.js`.

**The whole two-line field takes a click (AT-3028).** Auto-expand sets Quill's container and
editor to `height: auto`, so the contenteditable was one line tall inside the 56px field and the
blank line under "Start a new chat" was dead frame. `assistantInput.css` gives the composer's
`.ql-editor` a 48px `min-height` (the two resting lines; the Anna composer does the same in
`anna.css`), which leaves the measured resting height at 48 + 8 = 56. The field's few pixels of
padding go through `assistantComposerFocus.js`: a `mousedown` on the `assistant-composer-field`
wrapper (the field only, never the toolbar) focuses the editor at the end of its text. It must
check `field.contains(target)`: the + and the mic are portalled out of the field, and React
bubbles their presses through it. Pinned by `assistantComposerFocus.test.js` (also the CSS value
against `assistantInputLayout.js`), `AssistantOptionsFocus.test.js` and `browser-tests/at3028`
(real Chromium: click, tap, padding, toolbar controls, and a control run with the old CSS).

**The composer box outline (AT-3031).** The assistant line's composer box rests on a 1px
`colors.UtilityBlue150` border (adaptive: light pastel blue / blue mixed into the dark surface;
`Grey300` vanished on the `Grey200` card). While the editor has focus, `assistantInput.css` turns
it `#0C66FF` with a 3px `rgba(12,102,255,0.18)` box-shadow glow, via
`[data-testid='assistant-composer-row']:has(.ql-editor:focus)`. Only the editor counts, so the
toolbar's + / Templates / mic keep their own focus ring. The border width never changes (no layout
shift); the `!important` on the colour beats react-native-web's atomic class. Pinned by
`assistantComposerOutline.test.js`.

**Assistant mode is entered from the assistant line (AT-3034).** The panel button
(`components/Anna/AssistantModeButton.js`, moved from `TopBar/`) sits at the top left of the
assistant line's header (`AssistantOptions`, before the assistant-board edit pencil). The desktop
top bar and the mobile header no longer carry it. The app sidebar's `DefaultAssistantButton` stays,
so screens without an assistant line still have an entry. The line passes its project
(`assistantModeProjectId`: the line's project, null for `AllProjectsAssistantLine`), and
`AnnaShell.openChat({ projectId })` selects that project's daily chat in the sidebar, so whoever
answers there takes over. null or the default project means "Automatic", and an explicit pick of
the default project stays. It does not switch during a call, while offline, or to a project that
`isAnnaProjectSelectable` refuses. This is per project and frontend-only (decided with the
product owner): a second assistant picked in the line's switcher inside the same project is NOT
carried over, because the server's daily chat answers with the project's assistant
(`findProjectAssistantId`). `AnnaSidebarProjectContext` publishes the sidebar's project. The
button closes the desktop sidebar only when the sidebar already shows its line's project;
otherwise it moves the sidebar there. Next to the assistant's name at the top left of the sidebar,
a chevron (`AnnaProjectSwitcher variant="assistant"`) picks another assistant. It shares state
with the composer's project chip. It lists "Automatic", each project with an assistant of its own
and the active choice (`getAnnaAssistantChoices`), and loads every project's assistants only
while open. Rage mode is back at the top right of the line (`rage-mode.md`). Pinned by
`AssistantModeButton.test.js`, the AT-3034 cases in `AnnaShell.test.js`,
`AnnaProjectSwitcher.test.js`, `AssistantOptions.test.js` and `AssistantLine.test.js`.

**The sidebar header's assistant name is one line (AT-3040).** `.anna-brand` never wraps (it used to
clamp to two lines, "Anna / Alld…"); it ends in an ellipsis and the button's `title` carries the
full name. `.anna-header` is the `anna-header` size container: at 360px content width and less
(sidebar chat ≤ 408px, the minimum is 340) `.anna-header-sidebar` tightens its gaps and the
workspace picker (98 → 80px) so the name keeps ~72px instead of ~40px. Chosen with the product
owner over a bare ellipsis. Geometry is checked by `browser-tests/anna-workspace/run.js`
(`ACTIVITY_ONLY`), which asserts the name does not overlap the picker.

**The header closes with the panel icon, fullscreen sits beside it (AT-3042).** The close
control at the far right of the Anna header is `AssistantModeIcon expanded` (panel, chevron
pointing right), the counterpart to the assistant line's open button, not an X. It is the same
`closeChat` and label ("Close assistant chat") on every device, mobile included (decided with the
product owner). The fullscreen toggle (`maximize-2` / `minimize-2`, desktop only) moved from after
the assistant chevron on the left to directly left of it; "Open app in new tab" comes before both.
The left group is now only avatar, name and assistant chevron. Pinned by "puts the fullscreen
action directly left of the right-pointing collapse action" and the AT-2954 new-tab case in
`AnnaShell.test.js`.

**Project switch: one project's chat on the left, the same project on the right (AT-3036).**
Every project has its own daily thread (`AnnaChat{YYYYMMDD}{uid}` in that project, reused all day
by `ensureAnnaConversation`). `useAnnaConversation` used to return every recent thread of every
project, so a switch to Steercom appended Steercom's thread under the previous project's messages
and the chat read as one transcript while the backend wrote elsewhere. The hook now splits the
loaded history by the project on screen (`conversation.projectId`): `threads` (that project's days)
and `otherThreads`. `scopeAnnaThreads` (`annaThreadScope.js`) does the same for pending/failed sends,
so another project's failed message is reached through its project, not shown here. The other
projects appear as one row of jump buttons ("Chats in other projects", latest first, only
`isAnnaProjectSelectable` ones) that select the project like the chip does. While a switch
resolves, the previous chat stays and sending waits (`switching`, unchanged). "Earlier days" pages
the shared registry three threads at a time, so `loadEarlier` keeps paging until the visible
project gains an earlier day, bounded at 8 pages per click. A choice made in the chat (composer
chip, assistant picker at the top left, a jump) also moves the Alldone workspace:
`syncAnnaWorkspaceProject` (`annaWorkspaceProjectSync.js`) dispatches the header project picker's
batch (`switchProject`, own board or All goals, active type), keeps the root tab (wiki falls back
to tasks on All projects), leaves an object's detail view of the old project for the root list,
and does nothing when the workspace already shows that project. "Automatic" matches All projects
and the default project; from any other project it opens All projects. Entering assistant mode from
an assistant line (AT-3034) passes `syncWorkspace: false`: the line already sits in the workspace's
project. An app or VM on the right stays on screen; the Alldone view under it moves. Pinned by
`annaThreadScope.test.js`, `annaWorkspaceProjectSync.test.js`, the AT-3036 cases in
`useAnnaConversation.test.js`, `AnnaConversation.test.js` and `AnnaShell.test.js`.

**A project switch loads visibly and ends at the bottom (AT-3036 follow-up).** While `switching`
(the selected project's chat is still resolving, from either side), `AnnaConversation` shows a
`role="status"` loading state ("Opening the chat in …", the name from `AnnaShell`) in place of
the timeline: the previous project's messages, its "Earlier days" button and the project jumps
are not rendered, so nothing of the old project reads as the new chat. The composer stays mounted
(draft kept) and sending stays held exactly as before. Once the switch ends, the current thread
reports through `onLoaded` when its messages are loaded and rendered (a layout effect, so after
this commit's DOM), and the conversation snaps once to the very bottom (`activate`), also for a
cached reused daily thread or a new empty one. The pending snap is keyed to the conversation the
switch ended in, so an overtaken switch's thread never scrolls; a refused or taken-back switch
returns to the bottom of the old chat. After the snap the chat follows like any open chat (later
images/markdown keep it at the bottom through the ResizeObserver), and a reader who scrolls up is
not pulled down again. A new day in the same project is not a switch and does not force a scroll.
Pinned by "project switch loading and scroll (AT-3036)" in `AnnaConversation.test.js` and the
loading-name case in `AnnaShell.test.js`.

**A switch picked in the chat ends with the composer focused (AT-3036 follow-up).** A project
picked in the chat sidebar (composer chip, assistant picker at the top left, "Chats in other
projects") goes through `AnnaShell.selectProjectFromChat`. It remembers the target
(`chatSwitchFocus`), and the composer takes focus when the switch has ended. The conversation reports
that through `onSwitchSettled(projectId)` from the same point as the snap to the bottom (messages
loaded and rendered, cached and empty chats included), right before the snap. A pick that keeps
the chat on screen ("Automatic" to the explicit default project) focuses at once. The draft stays
(the composer never remounts). It applies on desktop only (decided with the product owner): on a
phone the keyboard would cover the chat that just opened. A switch from the workspace or an
assistant line never focuses here; `selectProject` drops the pending focus, and only the chat's
picks set it. The latest pick wins: a switch only ends in the latest selected project, so a report
for another project (refused, fallback to the default) drops it. Any pointer or key press while the
chat loads (in the workspace, the chat or a menu; capture phase, so the press that makes a new pick
re-arms it afterwards) drops it, as do leaving assistant mode and focus already sitting in a field
or modal outside the chat (`isFocusHeldElsewhere`). Not verified in a real browser: iOS opens no
keyboard for a focus this late, which does not matter on desktop. Pinned by "focuses the composer
after a switch picked in the chat" in `AnnaShell.test.js` and "reports the end of a switch" in
`AnnaConversation.test.js`.

**And back: a project opened in the workspace moves the chat (AT-3036 follow-up).** Decided with
the product owner, replacing "nothing on the workspace side changes the chat's project". When the
person opens a project's root view (tasks, notes, goals, …) in the workspace, the chat selects that
project (`resolveAnnaChoiceForWorkspace`), so its daily chat and the assistant that answers there
follow; that assistant comes from the existing rules (`resolveAnnaProjectAssistant` /
`findProjectAssistantId`: flagged default, `project.assistantId`, else the user's default
assistant), never from a new mapping. All projects and the default project mean "Automatic"; an
explicit default pick stays. Archived, template, guide or foreign projects change nothing, nor do
an object's detail view (opening a task from All projects is not entering its project), a call,
offline, or assistant mode being off. Only the person's own navigation counts
(`useAnnaWorkspaceProjectFollow`): a pointer or key press outside the chat pane and the Anna
header (the header's project picker renders in a body portal, so "outside" rather than "inside
the pane") opens a 4s window, and the first root project change in it is theirs. The press is used
up by that change. A press in the chat closes the window; the chat's own sync announces its target
(`expectSync` via `onPlan`) and closes it too. So the assistant's reveal, `show_workspace`, links
and activity rows in the chat, and the left-to-right sync never move the chat, and the latest
side the person touched wins. Known gap: a reveal that lands within 4s of a press in the workspace
counts as the person's (the reveal itself cancels on interaction, so this needs a press without
cancelling it). Browser Back/Forward is not a press and does not move the chat. Pinned by the
`resolveAnnaChoiceForWorkspace` / `getAnnaWorkspaceProjectKey` cases in
`annaWorkspaceProjectSync.test.js` and "the chat follows a project opened in the workspace" in
`AnnaShell.test.js`.

**With the sidebar open, the assistant line is only its Last comment (AT-3034 follow-up).** The
chat box is in the sidebar, so `AssistantLine` hides its whole `AssistantOptions` (header,
assistant-mode button, rage crosshair and composer) and shows only the Last comment card. Decided
with the product owner: header included, desktop only. The signal is `AnnaSidebarCloseContext`
being non-null, which the shell provides only while the desktop split view shows the sidebar. On
mobile (chat and app take turns) and in chat-only mode the line is unchanged. The composer stays
mounted under a `display: none` wrapper and the tree keeps the same shape in both modes, so opening
or closing the sidebar loses no draft and does not reset the Last comment slot. The grey card style
moves onto `LastCommentArea` (`style` prop), so an assistant board without a comment of its own
leaves no empty box. The assistant board's edit pencil stays visible. Loading shows
`AssistantLineSkeleton lastCommentOnly`. Pinned by the sidebar cases in `AssistantLine.test.js`,
`AssistantLineSkeleton.test.js` and the container-style cases in
`LastCommentAreaPendingSend.test.js`.

**Assistant workspace viewport**: `AnnaShell` measures its Alldone content with
`useWorkspaceViewportOwner`. `utils/workspaceViewport.js` publishes browser-relative
bounds and a deduplicated change event for portals, including the vendored popover.
`useWindowSize`, `useModalSizing`, the safe-area helpers and positioning helpers use
this pane while assistant mode is active, and revert to the whole window on zoom-in.
Keep physical browser sizing (`matchMedia` / `window.innerWidth`) for the assistant
shell itself. `WorkspaceOverlayLayer` gives global dialogs and notifications a fixed
containing block matching the pane; inline fixed overlays get that block from the
workspace's transform. Body portals must keep global coordinates and add the pane's
origin exactly once. Use `WorkspaceModal` for standalone dialogs instead of a native
web Modal that creates a browser-wide portal. Never remount popup content when the
pane changes size: drafts must survive desktop/sheet transitions. Browser coverage:
`browser-tests/anna-workspace` (global and anchored dialogs, notifications, divider
resize, mobile and zoom-in). System status-bar paint remains outside this scope.

**The workspace bezel turns blue only while a tool changes the workspace (AT-2926).** The
blue accent on the frame around the Alldone pane (and its "… is working here" notch) used to
follow any live assistant run, so thinking and a plain streamed answer lit it too. It now
follows `assistantRun.activity.phase === 'tool'` with `changesWorkspace === true` on a live,
non-VM run (`isAnnaWorkspaceChangeRunning` in `annaWorkspaceWorkState.js`); a send in flight
no longer counts. The server stamps `changesWorkspace` from an explicit allowlist of tools that
create or change Alldone objects (`functions/shared/assistantWorkspaceChangeTools.js`: tasks,
notes, contacts, comments, artifacts, project description, wiki). Reads, web/email/calendar,
settings, memory, delegation and VM hand-offs stay grey, and an unknown tool stays grey until it
is added there. A flip inside a mixed batch is published at once from `toolCallBatch`'s
`onState` (deferred one macrotask so two consecutive writes do not flicker), instead of on the
7s progress tick. `composing` and any terminal status clear it. Pinned by
`annaWorkspaceWorkState.test.js`, the AT-2911/AT-2926 case in `AnnaShell.test.js`,
`assistantWorkspaceChangeTools.test.js` and the AT-2926 case in `assistantHelper.test.js`.

**Activity rows open their object, checked first (AT-2906).** Each row's first line is
`Project · Actor(s)`, then title/action chips, then the preview. A row links to the object
(`getAnnaActivityTarget`); a chat message whose thread type was never saved links to its chat
object (`/projects/{p}/chats/{id}/chat`), never to the followed chats inbox. On click
(`data-anna-activity-link`) `AnnaShell` runs `resolveAnnaActivityPath` (one read-only `get`):
a chat object is rewritten to its task/goal/note/contact, and a deleted object, a lost access or
a project this session cannot select shows an inline error instead of the router's silent
fallback to "All projects". Offline/transient errors do not block. Navigations are serialised
(the later of two quick clicks lands last), which is why `processUrlAsLoggedIn` now awaits the
route handler. The crash behind the report: `TasksHelper.getUserInProject` answers `undefined`
(not null) for a project whose members are still loading, `processURLProjectsUserChats` tested
`!== null` and stored `undefined` as `currentUser`, and every `currentUser.uid` reader plus the
members-snapshot reducer threw. Never compare that lookup with `null`; the `Store current user`
reducer now falls back to the logged user. Pinned by `annaActivityNavigation.test.js`,
`__tests__/Chats/ProjectsUserChatsColdProject.test.js` and the AT-2906 blocks of the Anna suites.

**A lost callable response is not a failed message (AT-2921).** The Anna composer starts each run
with `askToBotSecondGen`, and a phone drops that connection when the app goes to the background.
The Firebase callable SDK reports any failed `fetch` (status 0) as `FunctionsError('internal',
'internal')`, so the question showed "internal" + Retry while the server, which logged a 200, had
already written the full answer below it. `useAnnaMessageSends` now judges a dispatched request by
the chat first: a persisted reply with `assistantRun.triggerMessageId === messageId` that is not
`failed` settles it, whatever the transport said, and Retry is refused for it. A transport loss
(`isConnectionLoss` in `annaSubmissionReconciliation.js`, which keeps upper-case `INTERNAL` and
other server-sent errors as real failures) enters `confirming`: a waiting indicator, no error and no
Retry, until a reply arrives. If none arrives within the AT-2848 catch-up window of 120s after the
message was saved, and at least 15s while the page is visible, the hook shows a readable "connection
was interrupted" error. A `failed` reply still offers Retry. Pinned by
`annaSubmissionReconciliation.test.js` and the AT-2921 block of `AnnaConversation.test.js`.

**Holding the Anna composer's microphone sends on release (AT-2929).** The shared mic
(`RambleButton`, AT-2405) decides what a release means: a tap keeps toggle mode and leaves the
transcript in the composer for review, a hold of 400ms or more submits, sliding out of the ring or
recording less than 1s discards. `AnnaConversation` passes `onSubmit={sendDictation}`, which sends
the draft (text typed before plus the transcript) through the ordinary `send()`, so the offline,
Gold, project-switch and voice-call guards apply and a refused send leaves the text in place. Two
details: the mic calls `onSubmit` while its phase is still `processing`, so `send` lets exactly this
path past the `dictationBusy` check; and `insertDictation` reports whether the transcript landed,
so an empty or failed take can never send the bare draft. No focus after a voice send, so a phone
keyboard stays closed. Pinned by the AT-2929 block of `AnnaConversation.test.js` and the
hold-to-send step of `browser-tests/anna-workspace` (`DICTATION_ONLY=1`).

**Anna composer toolbar order (AT-3029, AT-3032).** Like the assistant line's composer:
`.anna-composer-tools` (left) holds + then **Templates**; `.anna-composer-actions` (right,
`flex: none`) holds mic, call, send. With an empty draft the small mic hides and the AT-3025
send-slot mic takes Send's place, so the right group reads call, mic (`voice-and-dictation.md`).
Offline hides the mic only. Templates is the assistant line's own `AssistantTaskSearchButtonWrapper`
(same list, same pre-configured task run), not a copy. Below a 360px composer
(`ANNA_TEMPLATES_COMPACT_WIDTH`, measured on the form) it shows only its icon, keeping its accessible
name, so the row fits at 320px. Anna passes it `position` (open upwards) and a window-sized
`getPopoverViewport`. Without a viewport, any popover is clamped to `window.__alldoneWorkspaceViewport`
and the list opened inside the workspace pane, away from its button. The same applies to any other
popup put in the Anna chat pane: pass a viewport.

**Project chip on the field edge (AT-3032).** The project chip is no longer in the toolbar. It is
the first child of `.anna-composer-draft`, in `.anna-composer-project`, absolutely positioned on the
field's top border (centred on it, left-aligned with the +), and first in tab order. The room it
needs (16px slot margin above, 22px field padding below) is reserved through
`:has(.anna-project-chip)`, so a composer without a chip (fewer than two choices) keeps the old
geometry. It has no `z-index` on purpose: with one it painted over the Templates popup. During calls
it stays hidden with the draft. Pinned by `AnnaConversation.test.js`,
`annaProjectChipText.test.js` and the chip/Templates geometry in `browser-tests/anna-workspace`
(`PROJECT_SWITCH_ONLY=1`, 1440/1024/390/320).

**Font sizes on Anna buttons (AT-3032).** `.anna-shell button:not(.anna-workspace-content *)
{ font: inherit }` has specificity (0,2,1), so a `font-size` in a single-class button rule such as
`.anna-project-chip` (0,1,0) never applies; the button inherits the composer's 16px. The project
chip's intended 12px was dead for that reason and "Automatisch" was cut to "Automa…". Put the size on
a child span (`.anna-project-chip-name`, now 13px / 16px line, like the project menu rows) or raise
the selector's specificity. Pinned by `components/Anna/annaProjectChipText.test.js`.

**The chat shows the view open NOW, not a list of visited views (AT-2914).**
`useAnnaContextNotices` returns one notice ("Looking at: …"), or `null` while no view is open
(chat-only mode). `AnnaConversation` renders it as the last entry of the current thread, after
newer messages. Re-opening the same view keeps its original time. A project picked in the
composer's switcher becomes a local "Switched to project: …" entry
(`useAnnaProjectSwitchNotices`). It is placed by time in the thread that choice resolves to (since
AT-3036 that thread is shown alone), and re-picking the active project adds nothing. Neither is written to Firestore or seen by the
assistant. Pinned by the AT-2914 cases in `AnnaConversation.test.js` and `AnnaShell.test.js`.

**The assistant is told what the work pane shows, not the Alldone route behind it (AT-2955).**
`annaPageContext` on the Anna chat used to be only `{ path, title }`, and every non-Alldone surface
wrote `{ path: '/', title: 'Anna' }`. With Story Builder on screen the assistant answered about the
hidden "Open tasks" page, or about an app it had opened earlier. AnnaShell now publishes
`buildAnnaPaneContext` (`components/Anna/annaPaneContext.js`), validated by the dependency-free
`functions/Assistant/annaPaneContext.js` on both sides. It adds `surface` (`alldone`, `app`, `vm`,
`vms`, `browser`, `none`) plus `app` (kind, name, MCP server/tool or iframe origin) or `vm` (run =
correlationId, task, status), and still keeps `path`/`title` for voice calls and older readers. An
app or VM therefore gets its own title, never the page behind it. `formatAnnaPaneContext` keeps three
things apart in the prompt: OBSERVED (Alldone's own metadata), APP-REPORTED and AVAILABLE ACTIONS.
APP-REPORTED is fenced as untrusted, and Alldone never reads a frame's DOM: apps are cross-origin and
sandboxed. It comes from MCP Apps `ui/update-model-context` (`mcpAppHost`, previously accepted and
dropped) or from an iframe tool's `{ type: 'APP_CONTEXT', context: { text?, structuredContent? } }`
(`EmbeddedAppFrame`, only from its own frame and origin and only in the pane). Both land in
`utils/annaAppModelContext.js`, in memory, capped at 2,000 characters and never logged. AVAILABLE
ACTIONS reuse existing tools only. They come from the answering assistant's real configuration
(`annaInstructions(context, { allowedTools, mcpServers })`): that app's MCP server, matched by
server id or same host, when the `mcp_servers` toggle is on. For a VM they are `get_vm_job` and
`execute_task_in_vm` with `continue_in_object_id`. Otherwise the prompt says plainly that no tool
operates the app. Answering a VM's question and stopping it stay UI-only. The shared browser's page
title is third-party text and is deliberately not sent. Pinned by
`functions/Assistant/annaPaneContext.test.js`, `components/Anna/annaPaneContext.test.js`, the
AT-2955 cases in `AnnaShell.test.js` / `mcpAppHost.test.js`, and
`IframeModal/embeddedAppContext.test.js`.

**Assistant mutation feedback**: `annaWorkspaceChanges.js` publishes short-lived,
bounded visual cues after successful native task/note/contact mutations in the
owner's sidebar conversation. Use the final persisted object/project identity
(especially after project moves), never title matching or model-provided selectors.
`AnnaWorkspaceReveal` waits for real DOM anchors, scrolls only the Alldone pane,
and acknowledges only an actually visible frame. It defers during user control or
the hidden mobile workspace, cancels on interaction, and uses `appResume` for page
lifecycle signals. Keep feedback failures separate from mutation success so they
never trigger a repeated write. Rows and detail titles expose `data-anna-object-*`
and `data-anna-project-id`; new supported object views must use those same anchors.
Keep the current view when the saved row is already mounted; otherwise try the cue's
`listPath` before its detail `path`. Task lists use the persisted current reviewer
for open tasks and the original assignee for completed tasks. Notes and contacts
use the project's All list. Allow the list listener to mount the row before falling
back to details, and cancel either navigation when the user interacts.
Coverage: `annaWorkspaceChanges.test.js`, `AnnaWorkspaceReveal.test.js`,
`annaWorkspaceRevealTargets.test.js`, and `browser-tests/anna-workspace`.
React Native Web replaces a ScrollView DOM node's `scrollTo` with its `{ x, y,
animated }` API. Reveal and cancellation must call the browser prototype with
`{ top, left, behavior }`; passing DOM options to the replaced method scrolls to
zero. The browser harness must use a real `ScrollView`, not a plain div stand-in.
After the final reveal, return to Home (`/projects/tasks/open`) only once the
persisted assistant runs for every cue's `triggerMessageId` are completed and no
other work is running. An HTTP response or spinner timeout does not prove success.
User interaction, zoom-in or hiding the workspace cancels the pending return;
manual navigation/surface selection must not be overwritten. Keep assistant mode
and the chat draft intact. Legacy cues without a request identity do not auto-return.

**Popover Width Control (legacy, unmigrated modals)**: Most modals still use
`applyPopoverWidth()` from `utils/HelperFunctions.js`, which applies an exact width per
breakpoint — since Phase 0 that is **full window width minus 32 on mobile**
(`smallScreenNavigation`), 368 tablet / 432 desktop — clamped to the window, read
imperatively from the store (not resize-reactive). It overrides inline styles due to how
it's applied via `style={[localStyles.container, applyPopoverWidth()]}`. Prefer
`useModalSizing` for anything new.

**React Native Dimensions Compatibility**: Do not use `useWindowDimensions()` in this codebase. The current React Native/web setup does not provide it reliably and it causes runtime failures such as `TypeError: useWindowDimensions is not a function`. Use `Dimensions.get('window')` instead when sizing responsive modals or panels.

**Popover Positioning and Viewport Safety**: Popovers using `react-tiny-popover` position content relative to the trigger element by default. Do not override `contentLocation` unless there is a clear reason and the behavior has been checked at narrow and short viewport sizes. The known-good task reminder/postpone date pattern is in `components/UIControls/DueDateButton.js` + `components/UIComponents/FloatModals/DueDateModal/DueDateModal.js`: keep desktop positioning library-managed with `contentLocation={smallScreen ? null : undefined}`, and make the modal itself fit the viewport with `applyPopoverWidth()`, `maxHeight: windowSize[1] - MODAL_MAX_HEIGHT_GAP`, and an internal `CustomScrollView`. For global centered popups such as `DueDateSinglePopup`, use a centered overlay wrapper and only center the popover on small-screen navigation (`contentLocation={smallScreenNavigation ? null : undefined}`). Avoid custom coordinate functions for large modals; they can render the `.react-tiny-popover-container` off-screen or invisibly. Fix size issues in the modal content instead: cap width/height to the available viewport, remove fixed minimums that exceed small screens, and scroll inside the modal.

**A popover that fits nowhere used to render nothing at all (AT-2189)**: `renderPopover` walks the position priority order (`['top','right','left','bottom']` by default) and recurses to the next candidate whenever the current one "violates" the viewport. Upstream, running off the end of that order `return`s without committing anything — but `renderWithPosition` has already written `popoverInfo` to state by then, so `render()` **mounts the portal** (and whatever full-screen overlay the caller wraps it in) while the container keeps its initial `opacity: 0` / `top: 0` / `left: 0`, and an active `contentLocation` **function is never called**. The result is the worst state available: invisible content that still swallows every tap. This is not a corner case on mobile — a popover anchored to a **zero-size target at the centre of the viewport** (the `DueDateSinglePopup` swipe-postpone pattern: `<Text />` inside a centring full-screen overlay) cannot fit left or right of centre if it is wider than ~half the screen, nor above or below it if it is taller than ~half the screen, so a 305×450 modal on a 390×664 phone violated all four candidates 100% of the time. Desktop escaped only because there is room at `'right'`. The patch in `replacement_node_modules/react-tiny-popover/dist/Popover.js` keeps the search but **commits the last candidate once the order is exhausted** (still nudged into the viewport), so coordinates are unchanged for any popover that already found a viable position. When writing jsdom tests against this library, **model the target rect realistically** — mocking every non-container element as `0×0 at (0,0)` parks the target in the top-left corner where `'right'` is always viable, which silently masks this entire class of bug. See `__tests__/UIComponents/ReactTinyPopoverNoFittingPosition.test.js` for the contract and `components/UIComponents/DueDateSinglePopupPositioning.test.js` for the app-level regression.

**Nested `react-tiny-popover` dismisses its parent on tap (mobile tap/click timing)**: `react-tiny-popover` (v4) closes a popover by attaching a `window` `'click'` listener and calling `onClickOutside` whenever the click target is not inside **that** popover's own `document.body` portal. A nested popover (a dropdown/picker opened from inside a popover-based modal) renders in a **separate** portal, so tapping an item in the child is "outside" the parent — the parent's `onClickOutside` fires and the whole modal closes. This reproduces mainly on **mobile web**: a tap emits the touch press (`onPress`, which does the selection) and then a **synthesized `click` shortly after**, and it is that trailing click that reaches the parent's window listener — on desktop the RN-web press typically stops the click from bubbling to `window`, hiding the bug. The ordering is dependable: `onPress` (pointerup/touchend, or the click at the event target during bubbling) always runs before the trailing `click` reaches `window`, so a flag set in `onPress` is readable by the parent's `onClickOutside`. Fix (see `components/TaskListView/EmailLine/EmailLabelChip.js` + `EmailLabelModal/EmailRow.js` + `emailLineHelper.js`): on the child item's `onPress`, stamp a module-level interaction (`markEmailLabelPickerInteraction`); in the parent's `onClickOutside`, swallow the dismiss **once** (`shouldIgnoreEmailLabelModalDismiss` clears the stamp and returns true). Prefer this **consume-once** guard over a fixed time window so it does not depend on how far apart the tap and click land; keep a generous sanity cap (~2s) so a stamp whose dismiss never arrives (the desktop case) can't later swallow a genuine outside tap. Do not reach for `contentDestination` to re-parent the child into the modal DOM — it breaks the library's viewport-relative positioning math — and avoid an in-flow inline dropdown (it expands the modal) or an absolute in-modal overlay (it gets clipped by the modal's `CustomScrollView`).
