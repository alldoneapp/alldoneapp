# Empty-inbox and per-project celebrations

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## Empty-inbox celebration (AT-2445)

**A count of 0 does not mean "empty" — it also means "not counted yet", and telling them apart is
the whole bug.** `openTasksAmount` is a running total accumulated across one Firestore listener per
project (`watchOpenTasksAmount` and its observed/workstream siblings in `taskNumbers.js`), it starts
at 0, and `unwatchOpenTasksAmount` forces it back to 0 whenever those listeners are rebuilt — which
happens on **every** mount of the all-projects board, because `TasksAmountContainers` registers an
empty project list for one pass before the real one arrives, and again on every Later/Someday
toggle. `OpenTasksViewAllProjects` nonetheless decided with a bare `!openTasksAmount`, so it rendered
the empty-inbox congrats through the whole loading window of every visit. My Day never had this
problem (`tasksLoaded && …` in `MyDayOpenTasks`); the all-projects board was the outlier.

That flash is not cosmetic, and this is why three previous tasks about the animation all "worked"
and were never seen. The block mounts `EmptyInboxOverview`, whose `useTodayEmptyInboxCelebration`
claims the **once-per-day** celebration marker in a `useLayoutEffect` — before paint, deliberately
(AT-2418: a passive effect would paint the finished green dot and then jump it back to scale 0). So
the day was routinely spent by a frame nobody saw, and the genuine empty-inbox moment later that day
animated nothing. `openTasksAmountLoaded` is the missing half: every count listener reports its
first snapshot (**and its error branch**) through a per-query token, `OpenTasksAmountContainer`
announces readiness once that generation's listeners have all reported, and it **fails open** after
`OPEN_TASKS_AMOUNT_READY_TIMEOUT_MS` — "the congrats never appears again" is far worse than "it
appears a few seconds late". The token is per QUERY, not per project: the workstream watcher opens
one listener per workstream id under a single watcher key. Second line of defence in the hook
itself: a day claimed but torn down before its run has been on screen for
`CELEBRATION_CLAIM_SETTLE_MS` is **handed back** (`releaseEmptyInboxDayCelebration`), and only a
marker this session claimed can be refunded — one restored from localStorage means the animation
demonstrably ran.

**The celebration is staged where the eye already is.** AT-2418 put it on the one element that
genuinely changes — an 11px square in the streak grid — which is correct and invisible: the grid is
inside a card several blocks down the page and today's cell is at the far right of a 53-column year.
The congratulation headline now pops in with a confetti burst thrown from behind it
(`emptyInboxCongratsMotion.js` + `EmptyInboxConfetti.js`), and the dot keeps its beat as the detail
you find when you look down. **One** run id drives both, so they are one event; the decision
therefore moved up to `AllProjectsEmptyInbox`, which owns it and passes `celebrationRunId` down to
`EmptyInboxOverview` (the card falls back to deciding for itself when no run id is passed, which is
what keeps the Settings → Profile copy unable to spend the day). Owning it there is also what lets
**My Day** celebrate at all — it renders this block without the achievement card, and clearing your
last task there is where it usually happens.

`celebrateNewDay` means "this surface may SPEND the day" and defaults to **off**; only the two
open-task boards opt in. The Done, Pending and Workflow all-projects boards render the same block
and must not — an empty Done list means you completed nothing today — and if they could celebrate
they could also spend the day out from under the board that should have. Confetti trajectories are
hashed from the piece index, never `Math.random()`: this board is subscribed to the task counts and
re-renders constantly, and a random value read during render would teleport every piece onto a new
trajectory mid-flight. The layer is an absolutely-positioned `pointerEvents: none` overlay so it can
never move the Add task button or intercept a tap on it. Reduced motion renders no decorative layer
at all. Pinned by `OpenTasksAmountContainer.test.js`, the AT-2445 blocks in
`OpenTasksViewAllProjects.test.js` / `AllProjectsEmptyInbox.test.js` /
`useTodayEmptyInboxCelebration.test.js`, and `EmptyInboxCongratsCelebration.test.js` — which, like
AT-2418's flow suite, opts out of BOTH jest's inert-animation convention and reduced motion, because
the predecessor's only test mocked `isReduceMotionEnabled` to `true` and therefore exercised the
static branch forever.

## Per-project empty inbox — the completed sweep (AT-2492)

**Clearing one project is celebrated too, and the difference from the all-projects moment is one of
KIND, not of degree.** When a project's today/overdue list goes to zero, that project's own header
row — the 56px `ProjectHeader` line — plays a **completed sweep** in the project's own colour. On
the selected-project board the Anna "tasks done" picture pops in on the same run id, so the two read
as one event. There is no headline, no achievement card, no green dot, no streak, and — the absolute
rule — **no confetti of any kind**. That layer is what makes the all-projects moment visible from
across a room, so withholding it entirely is what keeps the ranking legible; the first pass of
AT-2492 threw a smaller confetti burst here instead, and tuning piece counts alone left the two
reading as "the same celebration, slightly weaker". Trigger is today's list per project, so N small
flourishes compose on the way to the one big achievement. A settled row is byte-identical to before.

**The run is FOUR sequential stages over ~2.8s, and the extra time buys stages rather than a slower
sweep.** The version that first reached production was one 860ms pass (620 travel + 240 fade) and
Karsten's verdict was that it works but is over before it registers — "make it more celebratory and
maybe up to 3 seconds long". A single gesture cannot be stretched to three seconds: a 2.5s fill
across a 900px row reads as a stuck progress bar. So `projectCompletedSweepMotion.js` runs
`Animated.sequence` over four values, one per beat — **FILL 820ms** (the wash's `scaleX` behind a
full-strength 3px leading edge, with a 2px accent bar drawing in along the bottom of the band),
**SHIMMER 760ms** (a wide soft band of the same colour gliding over the now-filled row — light over
coloured glass, which is what makes the row read as _finished_ rather than merely tinted), **PULSE
540ms** (the whole band brightens once and eases back while the accent thickens 2px→4px — the
confirmation), **SETTLE 660ms** (everything fades; the old 240ms exit is what made the whole thing
feel clipped). Sequential, never parallel: the edge has to reach the end of the row before anything
else starts, or the user sees a highlight fading in the middle of the line and the "it got all the
way there" statement is lost — and a confirmation that overlaps the thing it confirms is a wobble.
Within a stage everything derives from ONE value (the AT-2404 rule), and `pulse` is a normalised
**clock**, not an amplitude, so the breath's shape lives in the interpolations and can be re-tuned
without touching the sequence.

**Two of the layers are gated by GEOMETRY, not by opacity, and that is deliberate.** The leading edge
and the shimmer band each travel from fully off the left of the row to fully off the right of it, and
the overlay clips (`overflow: 'hidden'`) — so each is invisible before and after its own stage with
no per-stage bookkeeping that could get out of step with the sequence. The pulse glow gates itself
the same way, by amplitude: both ends of `pulse` map to 0, which is also what leaves no residue.
The accent bar exists because the **edge leaves the row** at the end of stage 1: without it a pale
project colour would spend the shimmer and the breath as an almost invisible 20% tint, so the row
keeps one full-strength element throughout.

**Duration no longer ranks the two celebrations — KIND does, and that reversal is the point.** The
previous pass encoded the ranking as "half or less" (860ms against the all-projects 3000ms);
`ProjectEmptyInboxCelebration.test.js` now asserts only that the sweep never _outlasts_ the big one
plus the 2.5–3.0s window Karsten asked for, and the ranking is carried entirely by the structural
assertions that were always there: no confetti of any sort, `position: absolute` bounded to one 56px
row, no viewport-derived dimension anywhere (the all-projects fall is `position: fixed` and escapes
to the viewport). Consequence worth knowing: `PROJECT_LINE_EXIT_HOLD_MS` is derived from the run, so
in All Projects a cleared project now lingers **~2.9s** instead of ~1s before its block is dropped.
That is the deliberate cost of putting a three-second celebration ON the row — the row has to survive
its own celebration — and every bound below still holds, so the worst case for a bug is a line that
leaves three seconds late rather than never.

**The project line, not the picture, because the picture does not exist where this usually happens.**
`SelectedProjectEmptyInbox` only renders on the selected-project board, so a celebration living on
it could never fire in **All Projects** — which is where a project is normally cleared. The header
row exists in both views and is the same component in each, so moving the celebration onto it is
what makes one implementation serve both boards. Colour is the **project's own**, not the app's
green "done": a task turning green is a statement about that task, while a project line is an
identity, and the two land within a second of each other so they must stay distinguishable.
Pale project colours survive because the wash carries the fill and the full-strength edge carries
the motion.

**The hard part is that All Projects DROPS a cleared project from the board** (`hideProjectData` in
`OpenTasksByProject`), header included, in the same commit that empties it — so "celebrate the
project you just cleared" and "remove the project you just cleared" are in direct conflict.
`useProjectCompletedSweep` returns a `holdProjectLine` that keeps the line for one sweep and then
lets it go, the same grammar AT-2404 uses for a completing task row (sweep, then leave). The settled
layout is unchanged; only the moment of departure moves, by under a second. The hold is bounded
three ways because a project stranded on a board it should have left is a visible bug where a missed
sweep is merely a missed flourish: it always expires on a timer, it is never taken when there will
be no visible sweep (reduced motion, jest), and it is never taken for a line leaving for any other
reason — applying a priority filter hides projects through the same code path and is not delayed at
all.

**Two store slices say "today is empty" and they race, which is what the probe is for.**
`sidebarNumbers` (the unfiltered today+overdue count the marker records are keyed on) and
`thereAreNotTasksInFirstDay` (which actually drives the hide) are written by two different Firestore
listeners and land in whatever order the network gives them. When the hide wins, the line would be
gone before we knew the project had been cleared. So a line that is both leaving **and** otherwise
eligible gets a provisional `PROJECT_SWEEP_PROBE_MS` hold while we find out. It is armed by
a **render-phase state update** (React's documented "adjust state when a prop changes" pattern), not
from an effect — an effect runs after the commit that already removed the block, so the user would
see the project vanish and reappear.

**That probe shipped at 120ms and made the sweep effectively invisible ("I don't see the animation
on the project lines").** Two things were wrong and they compounded. The window was far too tight:
the two slices are not merely two listeners, they also arrive through different amounts of React
work (`thereAreNotTasksInFirstDay` is derived up through `OpenTasksByProjectHandler` and the
parent's state, `sidebarNumbers` through a store dispatch), so a skew of several hundred
milliseconds is ordinary. And losing the race did not delay the celebration, it **deleted** it —
which is the part worth remembering. `lineOnScreen` was treated as a PRECONDITION for celebrating,
but in All Projects it is also a CONSEQUENCE of the celebration being declined: once the probe gave
up, the board dropped the row, and the same **still-mounted** hook (it lives in `OpenTasksByProject`,
not in the block it animates) then refused the very clearing it had been waiting for, forever —
that project never renders a line again that day. So "not on screen" had to be split into its two
meanings: a project that never had a line this session (an All Projects block for a project cleared
earlier — correctly skipped, so its own board still celebrates it), and a line that has **just left
because of the clearing we are being told about**. A clearing this hook WATCHED
(`didProjectReachEmptyInbox` true here) is proof the line was there a moment ago, so it still plays
and the hold puts the row back for it, bounded by `PROJECT_LATE_CLEARING_GRACE_MS`; past that the
run is declined and the reached-record is left **unspent**, so the project's own board still gets
it. The probe is now the prevention (raised to 700ms — it is only ever opened for a line that is
both leaving AND fully eligible, i.e. exactly the moment a project empties in front of you, so
nothing else on the board is delayed by a frame) and the grace is the cure for the tail.

**Two more ways the same feature could show nothing, both fixed with it.** A run was marked "played"
BEFORE the motion check, so a run arriving while motion was unavailable was consumed permanently and
could never play once it became available — and that is reachable without touching a setting,
because react-native-web's `isReduceMotionEnabled()` resolves to **`true`** whenever
`window.matchMedia` is missing (it fails _closed_). Related: `useReducedMotion` seeded its state
`false` and corrected a microtask later, so the first commit always assumed motion — harmless for a
ghost, but this celebration claims its once-per-day marker in a layout effect on exactly that
commit, i.e. it spent the day believing it was about to animate. It now reads the media query
synchronously on first render (falling back to `false`, the safe direction), and the claim itself
stands down when there will be nothing to see rather than being handed back afterwards — a day spent
on a frame nobody saw is the AT-2445 failure.

**Only a real browser can check any of this.** `__mocks__/react-native.js` replaces `Animated.timing`
with a no-op `{start}` stub, so no jest test can observe this animation advancing, and jsdom computes
no layout, so `onLayout` never fires and the leading edge (gated on a measured row width) never
renders. Every test the feature shipped with was therefore green while the sweep was invisible in
production. `browser-tests/at2492` drives the real component in real Chromium and asserts on painted
width across the run; it also reproduces the All Projects late-count case end to end, and is the A/B
that separated "the animation is broken" (it never was — wash 96→900px, edge travelling, correct
colour and geometry) from "the trigger never fires". It now samples the whole ~2.8s run every 60ms
and checks **each stage where it is visible** — the wash growing, the edge crossing and leaving, the
shimmer band travelling **over an already-full wash** (moving it during the fill would be a second
wipe chasing the first), the breath rising and returning to zero, the accent thickening and
returning, and every layer sharing one exit opacity. Run the same harness against `master` for the
A/B: the shipped single-pass sweep scores 13/21 there, failing every stage-2/3 check and reporting
`still painting at 840ms`. Its `--reduce-motion` mode asserts the **inverted** contract — no run, no
paint, and the day left **unspent** — which is what it should always have done; it previously
asserted the animated expectations and therefore reported the correct behaviour as a failure.

**"The list is empty" is not "the project was cleared", and conflating them is the whole bug this
design avoids.** The reporting account has 78 projects, 64 of them guides, and most are empty on most
days — so celebrating whenever an empty list is seen would throw confetti for work nobody did, every
time one is opened. The all-projects feature already solves this in two parts: `useReachEmptyInbox`
detects the `>0 → 0` **transition** and persists an achievement day, and the celebration hook keys off
that record rather than off the live count (which is what lets it fire when you open the board hours
later). AT-2492 copies that shape one level down with **localStorage in place of Firestore** — it is
purely visual, and a write on the task-completion path is what AT-2340 exists to avoid.
`projectEmptyInboxCelebrationMarker.js` therefore holds **two** stores over the shared
`dayCelebrationMarker` factory (`reached` and `celebrated`), in their own namespace: a user routinely
earns the small and the big celebration within a second of each other, when the last task of the last
project falls, and a shared namespace would let either silently spend the other.

Three things are load-bearing. The transition rule is **strict** (`didProjectReachEmptyInbox`: both
sides finite, the new one exactly `0`) because a count that becomes `undefined` is an absent answer,
not a cleared project — `clearSidebarTasksAmount` wipes the whole map on an account switch, and a
project with nothing due today never gets a key for that user at all; the celebration gate is
deliberately **looser** (`projectTodayListLooksClear`, "not a positive count") because after a reload
that same project reads `undefined` rather than `0`, which is the ordinary shape of the "cleared this
morning, opened this afternoon" case. The decision lives in **`OpenTasksByProject`**, the one
component that stays mounted for every project whether or not that project has anything to show —
not in `OpenTasksByDate` (where the first pass put it), which unmounts with the block it is trying to
animate, and not in the empty block itself, which only mounts once the list is already clear and so
could never see the transition. And `useProjectCompletedSweep` does its **own** transition detection
as well as reading the record: effects run child-before-parent, so on the tick the count reaches zero
the app-wide `useReachProjectEmptyInbox` (mounted in `InitLoadView` beside `useReachEmptyInbox`) has
not written its record yet, and a hook that only read it would never fire for the live case.

Gates that decide who may spend the day, each closing a way of celebrating something that did not
happen: **the project line must actually be on screen, or have just left because of this very
clearing** (the AT-2445 lesson — a marker spent by a frame nobody saw is a celebration that silently
never happens; in All Projects a project cleared earlier and arrived at later renders no header at
all, so the day stays unspent and its own board can still celebrate it — but see the probe note
above for why "on screen" alone was too strict), no active task filters (`thereAreNotTasksInFirstDay` and the filtered store both
describe a FILTERED list, so a filter empties a project without it being done), the board is the
logged user's own, and not an assistant profile board. `OpenTasksByDate` keeps exactly one gate of its
own — `dateIsToday` — because it renders once per date section and with Later expanded several can be
empty at once.

One dependency worth not breaking: `PROJECT_LINE_EXIT_HOLD_MS` > `SWEEP_TOTAL_MS`, and
`PROJECT_CELEBRATION_CLAIM_SETTLE_MS` > the hold. The sweep's timer is started from the overlay
inside `ProjectHeader` and the hold's from `OpenTasksByProject`, so nothing guarantees their order;
both are derived rather than hand-tuned, and pinned from both sides.

Known limit, and it degrades in the safe direction: the reached-record is per device, so clearing a
project on your phone and opening it on your laptop shows no celebration. Pinned by
`projectEmptyInboxCelebrationMarker.test.js`, `useProjectCompletedSweep.test.js` (the rules and the
hold, mutation-checked), `ProjectCompletedSweep.test.js` (the visual contract — note the RN animation
driver runs on rAF and does NOT advance under jest fake timers, so runs are driven by hand through
the `Animated.Value` the component interpolates), `OpenTasksByProjectCompletedSweep.test.js` (the
board-level conflict: the line stays for the sweep AND still leaves afterwards),
`hooks/useReachProjectEmptyInbox.test.js`, and `ProjectEmptyInboxCelebration.test.js` — the last of
which renders the real sweep against the real all-projects block and asserts comparatively, so a
future change that quietly hands the small celebration confetti or a viewport-escaping layer fails
the build. Plus `browser-tests/at2492`, which is the only place the sweep is ever seen actually
painting: a suite that stubs reduced motion but not `window.matchMedia` still gets one fully
animated commit, which is enough to hide a swallowed run, so both jest suites now drive the media
query as well.

## The cleared project's line disintegrates, and the task row does not (AT-2495)

**The 1.2s right-to-left dust disintegration belongs to the PROJECT line, and putting it on the task
row first was the mistake worth remembering.** The ask — "make it look like the line disappears the
way Thanos snaps his fingers" — was about the project line; the first pass read it as the completed
task row and shipped it there. It is not a matter of taste which row gets it: a task is completed
dozens of times an hour, often in bursts while a list is cleared, and **every one of those
completions holds its Firestore write for the length of the animation** (`COMPLETION_HOLD_MS`), so
the cinematic version cost 1950ms per row against 1070ms. A project's line leaves the board at most
once per project per day, and only ever because something worth marking has happened. That scarcity
is the whole licence for the effect, and it is also why the celebration lives there and nowhere
else. The task row therefore has its AT-2404 exit back unchanged — 320ms of height→0, opacity→0 and
a 6px lift — pinned by the `leaves by collapsing` case in `TaskPresentationCompletion.test.js`,
because the modules it would need still exist one directory away. The other half of AT-2495 stayed:
the completion motion still plays when a task is finished from the long-press checkbox popup
(`taskCompletionHandoff.js`).

**The exit is the sweep's fourth stage, not a second animation after it.** AT-2492's run is
FILL → SHIMMER → PULSE → SETTLE; a line that is LEAVING replaces the 660ms settle with the 1200ms
disintegration, so the whole thing is 3320ms rather than 2780 and reads as one gesture. The settle is
subsumed rather than skipped: the sweep overlay is a CHILD of the masked row, so the dissolve front
carries the coloured wash and the accent bar off with everything else — fading them out first and
then dissolving an already-plain row would spend 660ms throwing away the thing worth watching.
Nothing waits on any of it; the only cost is `PROJECT_LINE_EXIT_HOLD_MS` (~3.4s), which postpones
the board dropping a block it has already decided to drop.

**Which of the two stage-4s runs is read 2.1 seconds in, from a ref, and that is load-bearing.** The
celebration starts on the `sidebarNumbers` snapshot; "the board is dropping this block"
(`thereAreNotTasksInFirstDay`, threaded down as `completedSweepLineWillLeave`) arrives through a
different listener and is routinely SECOND — the same skew `PROJECT_SWEEP_PROBE_MS` exists to
absorb. Deciding at `start()` would therefore have picked the settle for the ordinary case and
silently lost the disintegration, and it fails invisibly, because a settle is a perfectly
plausible-looking animation. The value passed down is `baseHideProjectData`, deliberately **not**
`hideProjectData`: the second is false for the whole hold — that is what the hold IS — so it could
never say "this line is leaving".

**Since the rounded project-card redesign, the mask goes on the whole card; the particles go beside
it (AT-2535).** Masking the old 57px `ProjectHeader` left the new `ProjectSection` surface, body
padding and rounded corners behind until the block vanished abruptly. `ProjectSection` therefore
owns `useProjectCompletedSweepMotion` + `useProjectLineExit` and masks/collapses its complete
`Animated.View`. The sweep itself must live in `ProjectSection` as
an absolute-fill CHILD of that node: leaving it in `ProjectHeader` keeps its old `top: 20` /
`bottom: 1` content-band geometry, so only ~35px of a potentially much taller card is coloured even
though the mask correctly erases the whole card. Its tint is the resolved
`palette.PROJECT_ITEM_ACTIVE`, the exact colour `ProjectHeader` paints, not the raw marker colour;
the latter has the same hue but is a visibly brighter shade. The same resolved tint feeds the
sparks. `ProjectLineDisintegration` is a SIBLING of that masked card — a child would be erased by the
very front it is shedding — inside a wrapper `View` so its absolute placement resolves against that
card and nothing else. The card's resolved `marginBottom` is supplied to the exit separately because
`onLayout` excludes margins; it interpolates to zero with the height, avoiding a final spacing jump
when the hold unmounts. Two failure modes are guarded
explicitly: an exit whose verdict is **withdrawn** mid-run (a task landing back in the project) is
reset, and an exit the board **never finishes** is put back after `EXIT_RECOVERY_MS`, because an
erased zero-height card is a hole the user can neither see nor click and has to reload to clear. The
card's height is frozen when the exit begins, so the collapse cannot overwrite what it is collapsing
from and the particle layer keeps the full height while the card closes underneath it.

**The celebration is nine sparks, and it must never become confetti.** AT-2492's ranking rule
stands: the all-projects empty inbox owns confetti (46 pieces, gravity, spin, a `position: fixed`
layer that escapes to the viewport), and clearing one project stays smaller in KIND. So these are
struck OFF the dissolve front on the same `particleLiftOff` derivation the dust uses — the
celebration is visibly caused by the line leaving rather than thrown over it — they rise and twinkle
(grow into their peak, where a mote only ever shrinks), nothing falls or spins, they carry the
project's own colour with every third one gold so a pale project still reads, and the layer is
`position: absolute` bounded to the project card. Their life is CLAMPED to `COLLAPSE_START` rather than
tuned to fit, so `SPARK_LIFE` can be retuned without leaving a particle drifting while the board
pulls the content below up through it.

Pinned by `projectLineDisintegration.test.js` (the mask arithmetic re-derived from the CSS spec, the
grain, the dust and the celebration), `ProjectLineDisintegration.test.js`,
`projectCompletedSweepMotion.test.js` (the branch, both arrival orders, both recoveries),
`ProjectHeaderLineExit.test.js` (the wiring — the mask on the complete card, animated spacing, the particles outside it,
and every other board in the app unaffected), and the AT-2495 blocks in
`ProjectEmptyInboxCelebration.test.js`, which measures the sparks against the real all-projects
confetti so a future change that quietly promotes them fails the build. Plus `browser-tests/at2495`,
which is the only place any of this is ever seen: jsdom drops `mask-image` without a word and
`__mocks__/react-native.js` stubs `Animated.timing`, so it screenshots the card every ~50ms and counts
surviving pixels per column, in four modes (leaving, late verdict, staying, reduced motion).

## Per-project completion sweep is disabled (AT-2551)

The per-project FILL → SHIMMER → PULSE → DISINTEGRATE run above is no longer connected to the open
tasks board. After the rounded-card change its overlay covered the entire project card, and the
shimmer plus pulse read as two page-wide flashes when a project became empty. `OpenTasksByProject`
therefore does not call `useProjectCompletedSweep`, pass completion-run props to `ProjectSection`, or
hold a cleared All Projects card for the animation. A cleared card leaves as soon as the existing
empty-project condition says it should. The selected-project header and empty illustration remain
visible but static, while task-loading skeletons continue to use their independent readiness flags.
The animation modules remain available for now so this product decision is a small, reversible
wiring change rather than a broad deletion of the earlier motion work.

AT-2558 adds one narrow exception: when any genuine top-level task completion **or user-facing
postpone out of Today** is followed by the board confirming that its project is leaving, the card
gets AT-2495's original 1.2s right-to-left mask, dust and sparks. It starts the disintegration
directly through `projectDisintegrationMotion`; the broad FILL → SHIMMER → PULSE colour sweep stays
disconnected. Completion reports before its held write; postpone reports from the shared
`postponeTaskWithMotion` coordinator after the row's short exit and immediately before its write.
That ordering means the exit does not depend on which of the open-task and sidebar snapshots arrives
first. It also keeps the signal at the UI boundary that knows a mounted, top-level Today row is
actually changing its placement date: do not publish from generic Firestore due-date helpers, which
also serve background, bulk, subtask and non-Today changes. Quick dates, custom calendar dates,
Someday and single-task auto-postpone all converge on this coordinator. Date-list drag/drop only
reorders inside one list (cross-list drops remain unimplemented), and bulk organize mode remains
excluded. A signal alone cannot start the exit; filters, workflow handoffs, subtasks, projects with
other visible content, selected-project boards, assistant profiles and reduced-motion paths retain
the immediate/static behavior above. If new work lands while the card is dissolving, both the hold
and mask are withdrawn immediately so the live project returns whole and clickable.

AT-2565 applies the same handoff one level down when that postponed task belongs to a goal. The
shared `postponeTaskWithMotion` coordinator publishes the goal id after the task row's exit and
immediately before its write. `useGoalSectionExit` still requires the goal to be absent from both
the populated and empty-goal lists before it holds the existing row for the AT-2507 fade/collapse,
so the signal cannot decide visibility or remove a goal that has its own Today reminder. Dragging,
deleting, reassigning, re-goaling, goal-level postpone, non-Today lists, filters, organize mode and
reduced motion keep their existing immediate/static behavior. Completion and task-postpone events
share the in-memory goal-task-exit channel; no Redux or persistence state is added.
