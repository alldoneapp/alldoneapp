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

**Anna composer toolbar order (AT-3029).** Like the assistant line's composer: `.anna-composer-tools`
(left) holds + then the project chip; `.anna-composer-actions` (right, `flex: none`) holds mic,
call, send. With an empty draft the small mic hides and the AT-3025 send-slot mic takes Send's
place, so the right group reads call, mic (`voice-and-dictation.md`). On narrow panes the chip is
the only item that shrinks, so the right group never wraps. Offline hides the mic only. Pinned by
the AT-3029 case in `AnnaConversation.test.js` and the order/alignment geometry (empty and typed
draft) in `browser-tests/anna-workspace` (`PROJECT_SWITCH_ONLY=1`).

**The chat shows the view open NOW, not a list of visited views (AT-2914).**
`useAnnaContextNotices` returns one notice ("Looking at: …"), or `null` while no view is open
(chat-only mode). `AnnaConversation` renders it as the last entry of the current thread, after
newer messages. Re-opening the same view keeps its original time. A project picked in the
composer's switcher becomes a local "Switched to project: …" entry
(`useAnnaProjectSwitchNotices`). It is placed by time in the thread that choice resolves to, and
re-picking the active project adds nothing. Neither is written to Firestore or seen by the
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
