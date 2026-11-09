# Task rows: swipe, completion animation, gold coins

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## A swipeable row is left permanently unopenable by its own swipe (AT-2449)

**`Swipeable` can deliver `onSwipeableClose` BEFORE `onSwipeableWillClose`, and every swipeable row
in the app assumed it could not.** Task, goal, contact, note and chat-message rows all carried the
same pair — `onSwipeableWillClose → setBlockOpen(true)`, `onSwipeableClose → setBlockOpen(false)` —
so that the tap which closes an open swipe row is not also read as a tap that opens it. But
`react-native-gesture-handler@1.5.6`'s `_animateRow` (Swipeable.js:203-242) starts the spring
**first** and calls the `will*` callbacks afterwards, and react-native-web's `SpringAnimation`
runs its first frame **inside `.start()`** — so a close with no distance to travel completes before
`start()` returns and the pair arrives inverted. `blockOpen` is then stuck `true` with no further
event to clear it, and `SocialText`'s press gate (`shouldOnPressInput`) rejects every tap on the
title from then on.

A zero-distance close is not exotic here: it is what **every** one of those rows does on a swipe.
They all call `itemSwipe.current.close()` synchronously from inside their own
`onSwipeableRightWillOpen`, and at that moment the `setState({ rowState: -1 })` issued a few
statements earlier in the outer `_animateRow` has not flushed (React 18 batches updates from native
event handlers), so `_currentOffset()` still answers `0` and `close()` animates 0 → 0. The reported
symptom — "after swiping a task and dismissing the postpone popup I can no longer click into the
task" — is misleading in both halves: the swipe alone wedges the row, and the popup is merely what
hides it, because `TaskItem.toggleModal` gates the whole list on `showSwipeDueDatePopup.visible`
while it is up. Redux is clean afterwards; the dead state is per-row.

`hooks/useSwipeCloseGuard.js` owns the pair for all five rows, and the two orderings are told apart
by the **microtask checkpoint** — both callbacks of an inverted pair are emitted inside the same
synchronous `_animateRow` call, while a real animation resolves in a later task. A genuinely
animated close therefore still blocks from `willClose` to `close`, exactly as before. It also
handles `onSwipeableWillOpen`, because a close whose animation is interrupted by a new open gesture
never delivers its completion callback at all. Class rows (`ContactItem`, `GoalItemPresentation`)
use the exported `createSwipeCloseGuard(setBlockOpen)` factory — the closure is the whole state
machine, so it must be created **once per row**, never per render.

**A settled close still has a GESTURE to see out, and reading "settled" as "nothing to block" broke
the goal row (AT-2449 follow-up).** The first version of this guard left `blockOpen` false for the
inverted pair. That is right about the ANIMATION and wrong about the INTERACTION: a mouse drag ends
with `mouseup` **and a trailing `click`, dispatched in the same task**, at the release point — i.e.
on the row that was just swiped. Every row here turns that click into a press on its title, so the
flag being stuck `true` had also, by accident, been the only thing stopping a swipe from being read
as a tap on the row it swiped. With it gone, **swiping a goal in the task list opened the goal's
edit mode instead of the postpone popup** — and then made the popup impossible, because
`GoalItemPresentation.onRightSwipe` defers its `showSwipeDueDatePopup` dispatch to a `setTimeout`
and `componentWillUnmount` clears `this.timeouts`, so opening edit mode **cancels the popup it was
supposed to show**. Same shape is latent on the contact and note rows (deferred popup, press target
navigates to a detailed view). The task row is the one that never showed it, for a reason worth
copying: `TaskPresentation.onRightSwipe` dispatches **synchronously**, and `TaskItem.toggleModal`
refuses to open edit mode while `showSwipeDueDatePopup.visible` — so by the time its trailing click
lands there is already a reason to ignore it.

So the rule is not "settled ⇒ do not block" but **"settled ⇒ block only for as long as the gesture
lasts"**, and that end is an observed boundary rather than a grace period: the trailing click rides
in the same task as the `mouseup`, so the **first macrotask** after it is already past the click.
It is the same boundary the rows themselves use — their deferred `setTimeout(...)` popups run in
that turn too, scheduled just after the guard's, so the row unblocks and its popup opens in a fixed
order rather than a raced one. `onSwipeableWillOpen` must not clear a block established in the
current tick (it fires later in the very same `_animateRow`), which is what `gestureBlockActive`
is for. This is a **mouse-only** hazard, which is why the release can be that tight: a browser only
synthesises a `click` for a touch sequence it judges a tap, and a swipe past `rightThreshold` (80px)
is an order of magnitude past the tap slop. Note the direction of the risk if that were ever wrong —
the block is held strictly longer than the first version of the guard and strictly shorter than the
behaviour that shipped for years before AT-2449, so it cannot be worse than either.

Pinned by `hooks/useSwipeCloseGuard.test.js` (the rule, both halves),
`components/TaskListView/TaskItem/TaskPresentation/TaskPresentationSwipeGuard.test.js` and
`components/GoalsView/GoalItemPresentationSwipeGuard.test.js` (the wiring — their `Swipeable` double
in `__swipeableAnimateRowDouble.js` reproduces `_animateRow`'s emission order and the batched
`rowState` write, which is the only reason the defect is expressible in jsdom at all) and
`browser-tests/at2449` (a real mouse swipe, a real popover dismiss and a real click, in real
Chromium, on a task row **and** a goal row — jsdom has no Hammer recogniser, so the gesture itself
cannot happen there and any jsdom-only test of this path would have to call the handlers by hand,
which is exactly the step that hides the bug; the goal regression was found by adding that row to
the harness and A/B-ing it against the pre-fix commit).

## Task completion animation (AT-2404)

Ticking a task's checkbox punches the checkbox, bursts a ring and six sparks out of it, fills a slim
bright-green **progress bar** left-to-right across the title with a green row wash following the same
edge, confirms with a small pulse at 100%, and — **only for a row that is about to leave its list** —
collapses the row upward out of the way. The state lives in
`components/TaskListView/TaskItem/TaskPresentation/taskCompletionMotion.js` (owned by
`TaskPresentation`, the row) and is triggered from `CheckBoxWrapper` (the checkbox, several levels
down) through a `beginCompletionMotion` prop — **not** redux: a slice keyed by task id would
re-render every mounted row on every completion, the exact fan-out AT-2336 exists to prevent, for
state that concerns one row for under a second. Because it is implemented once in the shared row it
applies everywhere `TaskPresentation` renders — open lists, MyDay, Goal DV, pending, done, the
inline subtask list, the TDV Subtasks tab, backlinks, drag mode, the comment popup — on mobile and
desktop alike. There is no second/mobile task-row component.

**A SUBTASK MUST NEVER COLLAPSE.** The collapse is only ever a cover for a removal that is about to
happen anyway: a completed top-level task disappears because the `inDone == false` query stops
matching it, not because anything here removes it. That premise is **false for a subtask**.
`setTaskStatus` keeps a subtask's `inDone` at its parent's value and never stamps `completed`
(`tasksFirestore.js` — `inDone: task.parentId ? task.inDone : isDone`), and **no** subtask query
filters on `done` (`watchSubtasksList`, `watchSubtasks`, the open/MyDay/Goal-DV lists that bucket by
`parentId`). A checked-off subtask therefore stays exactly where it is, greyed
(`TitleContainer` already styles `task.isSubtask && task.done`), ready to be reopened. The first
pass of this feature collapsed it anyway and never restored `collapsing`, so a completed subtask was
left as an invisible zero-height row that only came back on a remount — it looked deleted and was
still there. The gate is `rowRemainsAfterCompletion(task, { inCommentPopup })`, a pure exported
function resolved **in `TaskPresentation`** and passed to the hook as `retainRow`, never decided at
the checkbox: expressing it at the one shared row is what makes it impossible for a subtask context
to forget. It answers true for `isSubtask`, for a bare `parentId` (legacy/partial docs — `DragHelper`
derives one from the other) and for the comment-popup header, which is a row inside a modal with no
list to leave. A retained row plays every other beat and then **releases** — the bar, its head and
the wash fade out and the state clears — leaving the ordinary done-subtask appearance, which is also
what a reload renders, so a subtask you just completed and one that was already done look
identical.

**`begin()` returns the number of ms the caller must wait before writing.** That is the whole
contract, and it is what keeps `CheckBoxWrapper` from having to know what kind of row it is in or
whether motion is enabled. Three answers: **1070ms** for a collapsing row (~990ms of motion — burst
560, sweep 70+450, pulse 150, collapse 670+320 — plus an 80ms buffer so the row is flat and invisible
before the write, and the snapshot that removes it can never interrupt the animation halfway),
**690ms** for a retained row (nothing is racing, so the buffer would be dead time), and **300ms**
under reduced motion. Undo is untouched — a 10s bar over 7-day retention, independent of this
timing.

**The checkbox is where the delight goes, because it is bounded.** The row wash stays deliberately
quiet (`UtilityGreen125` at 0.55) — completing a task happens constantly, including in bursts when a
list is cleared, so a full-row colour has to sit low in the attention order or it strobes. A 24px
box cannot strobe a list, so that is where the saturated `UtilityGreen200`, the expanding ring and
the six sparks live (`CheckBoxContainer/TaskCompletionCelebration.js`). Two things about it are
load-bearing: the green check is an **overlay**, not a restyle of `CheckBox` (the persistent done
state is grey `Text03` everywhere in the app and is not this animation's to change — an overlay
means there is nothing to unwind), and the punch scale is applied to the **real checkbox**, so what
squashes and springs back is the element the finger landed on. It stands down over the `pending`
clock and the AI-step control, which are different affordances that a green "done" tile would lie
about. Spark travel is ~11px: the predecessor here was a random 300px Giphy GIF portalled over the
middle of the screen on **every** tick, plus a `giphyRandomGif` cloud-function round trip, which is
exactly the gimmick to avoid. That overlay is still wired to the deliberate one-off paths that
dispatch `showTaskCompletionAnimation()` (WorkflowModal, FollowUpModal, comment-popup workflow
controls) through `GlobalModalsContainerApp`, and to nothing else.

**One `Animated.Value` drives the title bar AND the wash** (`scaleX`, both with
`transformOrigin: 'left center'`), so the wash's leading edge IS the bar's leading edge — two values,
however carefully tuned, read as two animations that happen to overlap. A second shared value
(`flourish`) fades in everything green together and is what the retained-row release winds back
down. A third, `pulse`, is the confirmation at 100% and is a **normalised clock, not an amplitude**:
it is sequenced strictly _after_ the fill in the same `Animated.sequence` (a confirmation that can
overlap the thing it confirms is a wobble), and the bump shape — thicken, settle, bloom the head out
— lives in the interpolations in `TaskCompletionProgress`, so the confirmation can be re-shaped
without touching the sequence. The release itself is a **timer**, not the `Animated` completion
callback: it has to fire identically on the animated path, the reduced-motion path and any renderer
whose composite never reports finishing, and a subtask that kept its progress bar because one
callback never arrived is the exact failure this exists to remove. A `done → open` effect resets
everything as a second guarantee, so reopening a subtask can never leave completion styling
behind.

**Only a genuine completion is celebrated.** `scheduleMoveTasksFromOpen` is also how ticking a
_workflow_ task hands it to the next reviewer — `stepToMoveId` is a step id, not `DONE_STEP`. That
row still fades and collapses (it is leaving the list) but gets no sweep, no green and no checkbox
burst, because the task is not done — it would otherwise be congratulated for finishing something it
has only handed on. The flag is `begin({ isCompletion })`; it was called `strikeThrough` while the
title beat was a strike-through.

**A progress bar, not a strike-through — the geometry is the same, the message is not.** The first
two passes drew a dark `Text02` line through the middle of the title. It was accurate and it read as
_deletion_: a struck-out row is the visual language of "this was removed". `TaskCompletionProgress`
therefore keeps the measurement and inverts the metaphor — a 3px `UtilityGreen200` bar filling
0→100% with a lighter `UtilityGreen150` glowing head at the leading edge. Deliberately **not** a
track-plus-fill and deliberately **no percentage numbers**: a grey track announces a UI control in a
list of prose, and a `0% → 100%` badge is unreadable at this speed while adding a second thing to
look at.

**The bar goes THROUGH the text, and the intermediate pass that put it under the text was wrong.**
Having argued that "a bar through the glyphs is a strike-through however green it is", that pass
centred the bar on the **bottom edge** of each line's ink. It shipped, and the immediate dogfooding
verdict was _"der grüne Strich ist nicht mittig zum Text"_ — because an underline is exactly what it
had become: a mark detached from the text, sitting visibly low. The argument confused the POSITION
with the MESSAGE. What says "completed" rather than "deleted" is the colour, the direction and the
moving head; the strike-through's **place** is simply where a line across a title belongs. Both
paths now aim the bar's **centre** at the line's centre and subtract half the bar's thickness to get
the `top` they set — `(line.top + line.bottom) / 2` on the measured path, `lineHeight * 0.5` on the
fallback, so a row that fails to measure cannot quietly keep drawing the underline. Related: the
per-line union takes `min(top)` as well as `max(bottom)`. That is sub-pixel (the grouping key rounds
`top`, so a group spans under a pixel) but the midpoint is now load-bearing, and half a union is a
bias with nothing behind it.

**On top of that geometric centre sits exactly one pixel of optical correction, `OPTICAL_OFFSET_Y`.**
The centring pass shipped with none and argued none was wanted — a range's client rect spans the line
box, CSS splits half-leading evenly, so the em box is concentric with it, and the x-height centre of
lowercase and the cap-height centre of mixed case sit ~1px off that midpoint in **opposite**
directions, making any constant nudge look like font-specific guesswork. That reasoning is right
about which direction a _font-fitting_ correction would take, and it is why this is not one. But the
geometrically centred bar still read as slightly high in production (_"now the strikethrough is a
little too high"_): the line box is symmetric about the em box, the **ink inside it is not** — a
Latin face hangs descenders below the baseline while most of a lowercase word's mass sits above it,
so a line of text has its visual centre of gravity marginally below the centre of the box holding it.
The fix is a flat `+1` applied to **both** paths, never to one, and never as a per-line term: it
shifts the whole sweep and must not change the spacing between wrapped lines, or the last line of a
three-line title drifts off its text. The glowing head needs no separate handling and must not get
one — it derives its `top` from the bar's, so it stays concentric for free. One pixel is the smallest
correction available; anything larger starts walking back toward the underline this replaced.

**A wrapped title is ONE bar's worth of progress, not three filling at once.**
`buildSweepSegments` gives each measured line the share of 0→1 that matches its own ink width, so
the head runs off the end of line one exactly as line two starts and travels at a constant speed
through the title. Three simultaneous fills read as three progress bars, which is exactly the
"UI widget" feel being avoided. It is still ONE `Animated.Value` — each line interpolates its own
window of it with `extrapolate: 'clamp'` — so the lines can never drift apart. The last segment's
`end` is pinned to exactly `1` rather than computed, because floating-point drift there leaves a
hairline of unfilled title precisely where the confirmation pulse fires.

**The sweep measures the text, not the column.** `TaskCompletionProgress` runs a
`Range.getClientRects()` over the rendered title and groups the resulting per-word rects into one
span per wrapped line. Without this the bar spans the title column, which
is `flex: 1` and stretches to the trailing tags — "Buy milk" on a desktop row would show a
several-hundred-pixel bar under empty space, which reads as a row-level loading indicator rather
than as the title being completed. Any failure (no DOM, missing marker, empty measurement) falls
back to full-width bars sized off the title's `onLayout` height, capped at the three lines
`numberOfLines={3}` allows, centred in the line box like the measured path and still filled
**sequentially** (equal shares).

**There is no element that contains a task title, so the range is drawn between two markers
(AT-2404 follow-up).** `SocialText` lays a title out as ONE `flexWrap` row whose children are, in
order: the leading chips from `LeftTagsAndIcons` (priority, Gmail, calendar, VM status, milestone
date), then one `<Text>` per word/inline tag from `WordsList`, then a hidden marker. Nothing wraps
"the text" — `LeftTagsAndIcons` renders a **fragment**, so its chips are plain siblings of the
words — and the chip count varies per row. `Content` therefore renders a **pair** of empty,
`visibility: hidden`, zero-size markers around the words (`textRangeMarkers.js` derives the start
id from the end id), and `measureTitleLines` ranges `setStartAfter(start)` → `setEndBefore(end)`:
exactly the words and inline tags, never the chips and never the markers.

The obvious-looking shortcut is the trap that shipped: `elementId` **is** that end marker, and it is
an end-of-text **position probe** for `TasksHelper.showWrappedTaskEllipsis` (which reads its
`bottom`/`left`), not a container. It is deliberately empty, so `selectNodeContents` on it selected
nothing, `getClientRects()` came back empty, and `measureTitleLines` returned null on **every**
completion — the measured path never once ran in production. It read as working because the whole
suite stubbed `document.createRange` and the stub answered for whichever element it was handed. Keep
that marker last and zero-size; it has the other consumer.

**A wrapped line is `lineHeight + 6` tall, not `lineHeight` — this is what drew three bars across a
two-line title.** Every per-word `<Text>` carries `marginTop: 3`/`marginBottom: 3` (`WordsList`'s
`wrappedText`), and a flex line's cross size is the tallest **margin** box on it, so the real pitch
is 30px (task) / 28px (subtask). The fallback — which, per the above, was the only path ever
running — divided the measured height by the bare line height: `round(60 / 24)` is `round(2.5)`,
which JS rounds **up** to 3. It hid on both neighbours, which is why only dogfooding found it: one
line was `round(30 / 24)` = 1 and correct, three lines was `round(90 / 24)` = 4 clamped back to the
3-line maximum and correct. Two lines was the only visible arity that was wrong. The same wrong
pitch also walked each bar 6px further up its own line than the last. Use `resolveLinePitch`;
`descriptionText`'s `maxHeight: 90` and `TitleContainer`'s `lineHeight + wrappedTextVerticalMargins`
multiline check are the two independent confirmations that 6 is the number.

Grouping rects into lines is by **vertical overlap** (`> half the shorter height`), not by rounded
`top`. Per CSSOM-View a range reports both the border box of each selected element **and** the rects
of the text inside it, so one word arrives twice with tops that can straddle a `.5` boundary and
split one line into two bars; and an inline tag is a different height from the words beside it. Real
lines are a clean 6px apart with zero overlap, so the threshold has enormous margin either side.

Three things that are load-bearing and easy to break: each bar needs
`transformOrigin: 'left center'` (RNW 0.21 passes it through `preprocess` to CSS `transform-origin`)
or it expands from its own middle and stops reading as progress at all — the same origin is what
keeps the pulse's `scaleY` centred; the rects must be measured against an **untransformed** wrapper,
since measuring a scaled node reads a box already squashed to `scaleX(0)`; and the glowing **head**
must sit OUTSIDE the scaled bar and travel by `translateX` instead, or it is squashed to nothing
along with everything else — the point of a head is that it keeps its shape while the bar behind it
grows. No head is drawn on the fallback path, which does not know where a line ends and would park
it in empty space.

`textDecorationLine` (`'underline'` or `'line-through'`) is deliberately not used — it cannot be
animated, and `SocialText` renders hashtags, mentions, links and the leading priority/Gmail chips as
separate nested elements, so a decoration on the parent `<Text>` is at the mercy of each child's
styling.

**Reduced motion keeps the information and drops the motion** — the bar appears statically at 100%,
the checkbox is green, `pulse` stays at rest (its resting frame IS the static statement), the ring
and sparks are not rendered at all (they carry nothing), the row never collapses, and the hold
shortens to 300ms so it does not read as lag. Zero would mean no completion feedback at all. Same `useReducedMotion()` from `Ghosts/ghostAnimation.js` and the same
`animationsAreDisabled()` jest convention as every other animation here — which means a suite that
wants to see the real branch must opt out of it, or an inert row makes every collapse assertion pass
vacuously. Pinned by `taskCompletionMotion.test.js` (the rule and the hook),
`TaskPresentationCompletion.test.js` (the REAL row, real checkbox press, subtask vs top-level vs
comment popup vs reopen — the wiring, which is where the subtask bug actually lived),
`CheckBoxContainer/TaskCompletionCelebration.test.js`, `CheckBoxContainer/CheckBoxContainer.test.js`,
`TitleContainer/TaskCompletionProgress.test.js` (segment geometry, wrapped-title hand-over and the
DOM measurement path through react-dom), `TitleContainer/TitleContainer.test.js` and the
`completion motion handshake` block in `CheckBoxContainer/CheckBoxWrapper.test.js`. Note
`findAllByProps` must pass `{ deep: false }` when counting bars: an `Animated.View` matches both as
the composite element and as the host `View` it renders, which silently doubles every count.

Its `measuring the title SocialText actually renders` block is the one that would have caught the
above, and the reason it can is that it renders the **real** `Content` and synthesises the layout
from the nodes the range genuinely contains — so "the chips are excluded" and "a two-line title
yields two bars" are assertions about the code rather than restatements of a stub. A rect stub that
answers for whatever element it is handed cannot tell that the wrong element is being measured;
that is exactly how the empty-marker defect passed a green suite.

## Gold earned for a task flies into the counter as 3D coins

`earnGold` dispatches `setTriggerGoldAnimation(goldEarned, checkBoxId)` as before; what plays is
decided by `GoldAnimationsContainer`. Where WebGL is available and motion is welcome, `GoldCoinFlight`
launches that many metallic coins from the checkbox on the shared full-app overlay
(`RootView/GoldCoins/goldCoinsOverlay.js` — one fixed, transparent, `pointer-events: none` canvas,
created on first use, whose loop runs only while coins are in the air), along the burst-and-arc path
in the pure `coinFlight.js`, into the top bar's Gold icon. The Gold counter counts up one coin per
landing through `goldCounterBridge.js`: it shows `base + landed` while coins fly, then the higher of
that and the real balance until the server's reward arrives (or `SETTLE_MS` passes, if it never
does). Everywhere else — no WebGL, reduced motion, or the overlay failing to load
(`goldCoinsUnavailable`) — the original Lottie pair (`GoldEarnedAnimation` + `GoldChain`) plays. The
container is mounted by the root view AND every detailed view, so each trigger object is launched
exactly once (a `WeakSet` in `GoldCoinFlight`). The overlay runs in parallel to the completion
motion and never delays the task write.

**A task that earned real money throws cash as well.** When the project has an hourly rate for the
logged-in user (`project.hourlyRatesData = { currency, hourlyRates }`) and the task has an estimate,
`celebrateTaskEarnings` (`GoldCoins/cashReward.js`, called next to the done-time statistics update in
both completion paths of `tasksFirestore.js`) throws banknotes out of the checkbox on the same overlay
and floats the amount above it (`+37,50 €`, in the user's locale). The sum is `estimate / 60 * rate`
(`getTaskEarnings`) — the same number the Statistics view and revenue OKRs count, so the animation
never claims money the statistics do not. On a DAY-RATE project (`dayRateTimeLog.enabled`) every task
throws cash, estimate or not, but with NO figure: the day is billed as a whole, and the completed-task
count is only the signal that the day counts as worked, so no task earns a share worth showing. The
generated "Time log for day rate" task never throws cash (`generatedTimeLog`). Notes are thrown away from the nearer screen edge, drawn
unlit (lit paper washes out on the white app) with a correctly oriented back, and flutter down like
paper (`cashFlight.js`). Each reward picks one of ten choreographies at random, never the same
one twice in a row: `COIN_STYLES` (arc, fountain, spiral, lineUp, bounce, comet, helix, hover,
slingshot, pinball) and `CASH_STYLES` (fountain, rain, explosion, moneyGun, tornado, cardFan,
geyser, wave, floatUp, stack), chosen by `pickStyle` in `goldCoinsOverlay.js`. Every coin style
must start at the checkbox and land exactly on the counter (the counter ticks on landing), and
every cash style must fade in from 0 and out before `life` ends — `coinFlight.test.js` /
`cashFlight.test.js` run each style against those rules, so a new style only has to pass them. No rate, no estimate, someone else's task, no WebGL or reduced motion: no
cash, and it never throws into the completion path. Both overlays load through
`loadGoldCoinsOverlay` so tests can replace the dynamic `import()`, which Jest's Babel does not
transform.
