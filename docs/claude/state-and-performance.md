# Redux state management and client performance

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## State Management

Redux store in `redux/store.js` (~116k lines) with actions in `redux/actions.js` (~63k lines). Uses `@manaflair/redux-batch` for batched updates.

Since migration Stage 6: **redux 5 + react-redux 9**. The app is hooks-only — there are
no `connect()` call sites, just `useSelector`/`useDispatch`/`shallowEqual`/`useStore` —
so react-redux's class-era API surface is irrelevant here. `@manaflair/redux-batch` is
unmaintained and declares `peer: {redux: "*"}`; it was verified working against redux 5
(array and nested-array dispatch still coalesce to one subscriber notification), but it
is the thing to check first on any future redux bump, since nothing upstream will.
**The app stays on React 18.3.1 deliberately** — see `FRONTEND_MIGRATION_PLAN.md`
Stage 6 for why React 19 was measured and declined (13 live quill blots would have to
move from synchronous `ReactDOM.render` to asynchronous `createRoot`). Do not introduce
new `ReactDOM.render`, `unmountComponentAtNode`, or `findDOMNode` call sites regardless;
they are all React 19 removals and every one added now is future migration cost.

**Never subscribe an all-projects view to a whole `xByProject` map (AT-2336).** Nearly
every per-project slice in the store is a plain object that the reducer replaces
wholesale (`{ ...state.boardMilestonesByProject }`), so writing **one** project's slice
changes the identity of the map holding **all** of them. A component that selects the map
therefore re-renders on every per-project write, and the all-projects views fan out one
Firestore watcher **per project** — so the writes arrive in proportion to the project
count and the settle cost is O(projects²). This is not theoretical at dogfooding scale:
the reporting account has **78 active projects** (64 of them guides), and "All projects –
Goals" settled with a measured **12,168** renders of `MilestonesListByProject` versus 233
after the fix. Note the data was never the problem — those 78 `watchAllGoals` listeners
return only ~363 documents / ~1.4 MB in total; it is pure render amplification. The
pattern that fixes it, in `components/GoalsView/goalsBoardSelectors.js`: the parent
selects a **flat map of primitives** carrying only what it needs for ordering and
`canShowProject` (a `"<date>|<id>"` string, because objects allocate a fresh identity on
every selector run and defeat `shallowEqual`), compares it with `shallowEqual`, and the
per-project child reads its own slice with `useSelector(state => state.x[projectId])` and
is wrapped in `React.memo`. The memo only pays off if the callbacks the parent passes down
are `useCallback`-stable, which is why `GoalsView`'s dismissible handlers are.

Two related traps in the same view, both worth copying elsewhere. A per-project effect
whose **cleanup nulls the slices it is about to rewrite** turns every snapshot into a
redundant write pair and defeats any equality guard — clearing belongs in an
unmount/user-change effect, not in the recompute's cleanup. And an equality guard over
recomputed redux slices should compare **element references**, not deep values:
`mapGoalData`/`mapMilestoneData` rebuild every object per snapshot, so reference
comparison can never swallow real data while still catching the recomputes triggered by
mount, tab switches and unrelated store churn. Pinned by
`components/GoalsView/GoalsViewAllProjectsPerformance.test.js`,
`goalsBoardWrites.test.js` and `goalsBoardSelectors.test.js`.

**Known remaining cost in the Goals board, not yet fixed:** `MilestoneStatistics` opens a
live `items/{projectId}/tasks` listener per milestone header to render one
`N Tasks · N Story Points` line, and the "Someday"/backlog header passes a milestone
timestamp of **year 5000**, so its window is effectively unbounded. On the reporting
account's main project that single line streams **1,165 task documents / ~5.7 MB**. It is
always mounted in the single-project Goals view. Fixing it means either sharing one
per-project task listener across milestone buckets or making the stats lazy — not a
cosmetic change, so it was left out of AT-2336.

**An open inline "Add new task" editor dies with its parent (AT-3010).** Its open state is
component-local (`DismissibleItem.visibleModal`), its draft is in Redux (`tmpInputTextTask`), so
when the task board replaces the composer's PARENT the editor closes and the keyboard drops while
the draft silently survives — reported on Android, typing in an empty project right after a
sidebar project switch. `utils/editingGuard.js` (`useIsUserEditing`) freezes the known
restructures (missing-dates composer in `OpenTasksByProject`, empty-list composer and grouping in
`MainSection`, the fallback ghosts in `OpenTasksByDate`), but the board renders today's general
composer in more than one parent and not every switch can be frozen — the date-section list in
`OpenTasksByProject` is read straight from the store, so its children cannot be held once their
data is gone. `inlineAddTaskReopen.js` is the safety net: `OpenTasksByProject` provides one
`InlineAddTaskReopenScope` per board; a `NewTaskSection` that unmounts while open records its line
(project, day, goal), and the next composer for that line on the same board reopens itself
(`EditTask` restores the draft and focuses). It is scoped to the board instance, not to time —
leaving the board drops it. When adding a new place that renders `NewTaskSection`, keep it inside
the board's scope. Pinned by `InlineAddTaskReopen.test.js` and `OpenTasksByDate.test.js`.

## Client performance telemetry

Boot, page readiness, Firestore first snapshots, offline note workers and bulk task operations emit
sampled, consent-gated `performance_trace` events through `utils/performance/performanceLogger.js`.
No entity ids are accepted. For the debug console, in-memory record buffer and controlled
Firestore-persistence/note-prefetch comparison switches, see `PERFORMANCE_DIAGNOSTICS.md`.
