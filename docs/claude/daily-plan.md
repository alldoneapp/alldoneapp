# Daily plan — "Plan my day" (AT-3142)

Capacity-aware **positive** daily selection: instead of deselecting dozens of due tasks, the user
reviews Anna's proposal of what fits today, confirms what gets postponed, and works on a focused
Today with one Undo. Approved design: mockup artifact `TzP8PBCGg1d4gB8pmMhF` v2 (project-grouped).

## Flow and files

| Step                                                                                                                                                                                                                             | Where                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry: "Plan my day" next to "Time to work" (All projects line, task boards and My Day); after Apply a "Today's plan · n/N left" pill                                                                                            | `components/TaskListView/DailyPlan/DailyPlanEntry.js`, mounted by `Header/AllProjectsLine/AllProjectsMeetingTime.js` (shares its `useMeetingTimeToday` view, no extra listeners) |
| Review: one cross-project capacity card, project groups (sidebar order) with selected count + duration subtotal, rows Must → Should → Could, collapsed Not today per project, search, overload help, missing-calendar assumption | `DailyPlanModal.js`, `DailyPlanReview.js`                                                                                                                                        |
| Postpone check: destination first (3 days … 1 year, Someday), project second, tick per destination / project / task, reconciliation                                                                                              | `DailyPlanPostpone.js`                                                                                                                                                           |
| All numbers                                                                                                                                                                                                                      | `utils/dailyPlan/dailyPlanModel.js` (pure, `dailyPlanModel.test.js`)                                                                                                             |
| Apply (one transaction + one undo record + plan record)                                                                                                                                                                          | `functions/Tasks/dailyPlanService.js`, callable `applyDailyPlanSecondGen`                                                                                                        |
| Focused Today                                                                                                                                                                                                                    | the existing priority filter set to Must/Should/Could (`PLAN_FILTER`); the list stays the normal project-grouped Today                                                           |

## Decisions (agreed with the product owner 2026-11-23)

- **Apply writes real priorities** (shared task fields): planned tasks get must/should/could; a kept
  task's Must/Should/Could becomes Do later so the plan leads the list. Observed tasks: only the
  observer's own due date is ever moved, never the owner's priority.
- **Capacity = 80% of "Time to work"** (AT-3136: working hours minus merged meetings), 20% buffer.
  Note: since 2026-11-23 the header's "Time to work" is the time still available from now; the plan
  still computes the whole working day (`windowMinutes − meetingMinutes`), see
  `calendar-reminders-whatsapp.md`.
  No core/stretch split, no aging quota.
- **Proposal is deterministic** (no model call, no Gold). Ranking revised 2026-11-24 (follow-up to
  !942, see "Ranking" below): your Must tasks, the focus task, milestones at risk, then the project
  list order; filled while it fits. Do later tasks are never proposed.
- Defaults the product owner did not object to: unknown estimates count as **30 min** and are flagged
  (estimate edits in the review are plan-local, not written to the task); **manual entry only** (no
  morning popup, so weekends/vacations need no handling); **Undo skips tasks edited since**.
- Meetings (calendar tasks) are already subtracted as meeting time: never counted, never postponed.
  Tasks waiting for an assistant are not on the user's Today at all, so agent runtime is excluded.
- Nothing is written before Apply. The snapshot of Today is frozen when the dialog opens; the server
  re-checks every task.

## Ranking (revised 2026-11-24, product owner's decisions)

The v1 rule "goal work postponed ≥ 3× is protected and ranked higher" (plus "most postponed" and
"oldest due date" as tie-breakers) was wrong: in the owner's real data almost every goal task had
been postponed ≥ 3×, so it protected nearly everything, and postponing is a signal of LOWER
importance. All in `utils/dailyPlan/dailyPlanModel.js` (`proposePlan`, `compareByFit`):

1. **Your Must tasks**: always in, never dropped (Overload state when they alone exceed the budget).
2. **The focus task**: always in.
3. **Milestones at risk** (may override the project order, with a visible reason): a goal whose
   **dated** milestone is at most **3 workdays** away (today + 2 more, Mon–Fri, today always counts)
   or **≤ 14 days overdue** (counts as due today, 1 workday left). It gets **today's share** of its
   due work = goal work ÷ workdays left, rounded up (goal work = the estimates of the goal's tasks in
   this plan, Do later excluded, review edits included). Tasks of the goal are pulled in, best first,
   until the share is covered (Must/focus/kept tasks of the goal count towards it) and while they fit
   the budget. Nearest milestone first, then project order. Row reason: "Milestone Thu 26 Nov at
   risk · workdays left: 3 · 30m of 1h 30m goal work needed today · ahead of project order"; the
   capacity card counts them ("Planned ahead of the project order …: n").
4. **Everything else in the project-list order** (`functions/shared/projectListOrder.js`, the
   sidebar's `sortIndexByUser` order; NOT the Today display order, which puts the focus project on
   top). Strict: a Should in a lower project does not beat an unprioritised task in a higher one.
   Inside a project: Should → Could → none, then an active milestone (fewest workdays left, then
   more goal work per remaining workday, then earlier date), then **fewer postpones first**, then the
   list order (`sortIndex`). The due date is not a key (no aging).

Fill: walk that order and take each task that still fits the 80% budget (a big task that does not
fit is skipped, a smaller later one may still fit).

**Milestone data** (real model, nothing invented per task): a task's milestone is its
`parentGoalId` goal's `completionMilestoneDate` (`goals/{projectId}/items`, redux
`goalsByProjectInTasks`, loaded per project by the Today list). Goal `scheduleMode: 'fixed'` →
**dated** milestone (may override); `'dynamic'` → rolling **period** milestone such as
"1 Nov – 30 Nov" (only ranks inside its project; otherwise every month end would put all projects
"at risk" at once — in the owner's data nearly all goals are dynamic monthly ones). Neutral (no
milestone effect): no goal, goal in Backlog (`completionMilestoneDate` = MAX_SAFE_INTEGER), goal
100% done, project's open milestones loaded but none on that date (closed), > 14 days overdue
(`stale`; old open milestones from 2023 exist), goal data of the project not loaded or the goal not
readable (`unknown`). Real estimates were 0 on every task due today in the owner's data, so effort
is mostly the 30 min default per task until estimates are maintained.

**Postpone check**: only Someday is opt-in. Nothing is unticked because it was postponed often.
A task of a milestone at risk stays ticked but shows "Milestone … at risk: postponing may miss it".
Overload suggestions: weakest first (lowest project first), Could before Should, milestone-at-risk
rows last; Must and focus never.

## Server rules (`dailyPlanService.js`)

- Caller = `request.auth.uid`; membership `projects/{pid}.userIds` read inside the transaction;
  task visibility via `canAccessObject`; observer tasks need the caller in `observersIds`. Same
  authority as the existing bulk auto-postpone callable — no escalation.
- Only open, top-level tasks whose effective due date is today or earlier are changed; anything else
  is returned in `skipped` (`completed`, `not-due-today`, `subtask`, `not-found`).
- Postpone dates come from the stored `timesPostponed` via the existing ladder
  (`getDateToMoveTaskInAutoPostpone`), never from the client. **Someday needs `confirmSomeday`**;
  otherwise the task is skipped and kept (`someday-not-confirmed`).
- Subtasks of a postponed task move with it (as in `autoPostponeTaskCloud`).
- One undo record (`users/{uid}/undoActions/{requestId}`, max 450 operations, checked before the
  subtask reads); `requestId` makes Apply idempotent. Every operation has `skipIfChanged: true` and
  `requiredCurrentFields: { inDone: false }`.
- `localDateKey` must equal the caller's local day (offset-based) — a dialog left open over
  midnight is refused.
- No feed entries are written (same as the project postpone with Undo); the Undo bar shows the action.

## Undo: `skipIfChanged`

`functions/shared/UndoActionService.js` accepts an opt-in `skipIfChanged` per operation: when the
object no longer matches `after`, that operation is skipped (recorded in `skippedOperationIndexes`)
instead of failing the whole action. Membership and visibility checks still apply. Operations
without the flag keep the all-or-nothing behaviour. Used only by the daily plan.

## Nightly auto-postpone interaction

`users/{uid}/dailyPlans/{YYYY-MM-DD}` (server-written; owner-readable, client writes refused in
`firestore.rules` via `isServerOwnedUserCollection`) stores `somedayHoldTaskKeys`: tasks whose next
ladder step was Someday and that the user kept. `processUserAutoPostpone` reads the **latest**
plan's holds and does not send those tasks to Someday (`isHeldFromSomeday`); earlier ladder steps
run unchanged. If the record cannot be read the run **fails closed** (no automatic Someday for that
user that night). A new applied plan replaces the holds; Undo does not clear them (conservative).

## Tests

- `utils/dailyPlan/dailyPlanModel.test.js` — capacity, proposal, edits, overload, grouping/sorting,
  destinations, Someday opt-in, reconciliation, payload; ranking: project order, no postpone
  promotion/protection/aging, milestone resolution from goal data (dated/period/backlog/done/closed/
  overdue/stale/unknown), workdays, share and estimate edits, imminent override, Must/focus first.
- `components/TaskListView/DailyPlan/DailyPlanModal.test.js` — the dialog end to end with a stubbed
  callable (normal, edits, search, overload, missing calendar, postpone, apply, offline, responsive,
  milestone reason + order note, postpone warning, missing goal data, focus project display vs rank).
- `functions/Tasks/dailyPlanService.test.js` — validation, permissions, Someday confirmation,
  observed tasks, subtasks, idempotency, day check, focus refresh, limits, Apply → edit → Undo.
- `functions/Tasks/autoPostponeTasksCloud.test.js` (holds), `functions/shared/UndoActionService.test.js`
  (`skipIfChanged`), `__tests__/Firestore/firestoreRules.emulator.test.js` (dailyPlans server-owned).
- `browser-tests/at3142/run.js` — real Chromium, synthetic data, network blocked: desktop flow,
  overload, missing calendar, milestone at risk with its reason, 390 px without horizontal overflow.

## Known limits / follow-ups

- Goal work for the milestone share counts only the goal's tasks due today (the plan's snapshot);
  tasks of the goal due later are not loaded on Today and are not counted.
- Workdays are Mon–Fri; holidays and personal days off are not known.
- Goal/milestone data comes from what the Today list has loaded; a project whose goals are not
  loaded yet is ranked without milestones (never with a guessed date).

- Not exposed over MCP / assistant tools yet (parity rule in `mcp.md` applies when it is).
- Estimate edits in the review are not saved to the task.
- "n left" counts planned tasks still open and due today; a planned task postponed by hand later
  counts as no longer left.
- Firestore rules change is live only after `deploy:firestore:rules:production`.

## Daily inbox dataset (`inboxDays`, AT-3167)

Goal: learn how the owner cleans up 100+ due tasks every morning (most of them postponed by
swiping left) so it can be automated. Before this nothing stored the Today list at the start of a
day, and project-line, goal and "Plan my day" postpones wrote no history (their undo records expire
after 7 days). Everything lives in `functions/Tasks/inboxDayDataset.js` (`inboxDayDataset.test.js`);
it only records, never changes a task.

- **`users/{uid}/inboxDays/{YYYY-MM-DD}`** — written by the hourly `autoPostponeOverdueTasksSecondGen`
  run, right after `processUserAutoPostpone`, for every active user (auto-postpone on or off), once
  per local day (the record itself is the marker). `tasks` is the Today list the user wakes up to:
  the same queries as the nightly auto-postpone (`collectEligibleTasksForProject` with
  `thresholdDays: 0`: open, top level, visible, due today or earlier, observed tasks by the observer's
  date). Each entry: key, name (≤ 200 chars), due date, overdue days, created, timesPostponed,
  priority, estimate, goal, recurrence, focus, subtask count, origin (`calendar` / `email` / `other`
  creator / `self`), creatorId, `waitingForOther`. Capped at 500 (`truncated`).
- **`…/events/{eventId}`** — one per move off Today, from any path, written by
  `onUpdateTaskSecondGen` (`recordInboxPostponesIfChanged`): the primary due date (for
  `currentReviewerId`, else `userId`) or an observer's date moved later, from today-or-earlier to a
  later day in that user's time zone. Carries from/to, `toSomeday`, `editorId`, `editionDate` (bulk
  paths stamp one action's tasks with the same value) and the task's features from _before_ the move.
  Only a due date moved later costs anything (one `users/{uid}` read for the time zone); assistants
  and workstreams have no user doc and are skipped. Done tasks and subtasks never count.
- **Closing a day** — the next day's run adds `outcome` to every listed task: `done` (with
  `completedAt`), `postponed` (a move was recorded that day), `left` (still due, or later-dated with
  no move that day: `movedAfterDay`, i.e. the nightly auto-postpone moved it after the day ended),
  `gone` (deleted, became a subtask, no longer on this user's Today). `addedTasks` are the tasks that
  came onto Today after the snapshot and were postponed or left open; added tasks that were also
  finished the same day are not captured. Events before the snapshot (the nightly auto-postpone) are
  counted in `postponeEventsBeforeSnapshot` and never treated as decisions about the day
  (`snapshotAt` is the moment the list was read, after that run's auto-postpone writes, not the
  run's start time).
- **Anna's proposal** — "Plan my day" sends `proposedTier` / `proposedRule` per row (the proposal as
  it stood at Apply, `summarizePlan` rows) and `budgetMinutes`; the server keeps only known values
  and stores `proposal: [{ key, tier, rule, decision }]` and `budgetMinutes` in the
  `dailyPlans/{date}` record. Descriptive only: it never decides what Apply writes. Keys are
  `${projectId}:${taskId}` in both collections, so a day's plan joins its inbox day.
- Both collections are server-owned and owner-readable (`isServerOwnedUserCollection`), pinned in the
  rules emulator suite. Live only after `deploy:firestore:rules:production`; until then the owner
  could also write them (nothing reads them for authority).
- Known gaps: a move made while the trigger fails is lost (no retry); history before 2026-11-26 is
  only in the per-task feed archive (`oldFeeds/{projectId}/{DDMMYYYY}/…`, server-only, never
  trimmed), which has every swipe and auto-postpone but no project-line, goal or plan postpone.
  There is no read tool yet: the data is read with the Admin SDK or as the owner in the app.
