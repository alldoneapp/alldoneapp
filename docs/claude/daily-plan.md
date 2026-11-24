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
