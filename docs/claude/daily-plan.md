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
  No core/stretch split, no aging quota.
- **Proposal is deterministic** (no model call, no Gold): your Must tasks always (never dropped, even
  when they alone exceed the budget — that is the Overload state), the focus task, then ranked by
  priority, protected goal work (goal-linked, postponed ≥ 3×), goal-linked, times postponed, oldest
  due date, list order; filled while it fits. Do later tasks are never proposed.
- Defaults the product owner did not object to: unknown estimates count as **30 min** and are flagged
  (estimate edits in the review are plan-local, not written to the task); **manual entry only** (no
  morning popup, so weekends/vacations need no handling); **Undo skips tasks edited since**;
  protected tasks are ranked higher and unticked by default, no reserved quota.
- Meetings (calendar tasks) are already subtracted as meeting time: never counted, never postponed.
  Tasks waiting for an assistant are not on the user's Today at all, so agent runtime is excluded.
- Nothing is written before Apply. The snapshot of Today is frozen when the dialog opens; the server
  re-checks every task.

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
  destinations, Someday/protected opt-in, reconciliation, payload.
- `components/TaskListView/DailyPlan/DailyPlanModal.test.js` — the dialog end to end with a stubbed
  callable (normal, edits, search, overload, missing calendar, postpone, apply, offline, responsive).
- `functions/Tasks/dailyPlanService.test.js` — validation, permissions, Someday confirmation,
  observed tasks, subtasks, idempotency, day check, focus refresh, limits, Apply → edit → Undo.
- `functions/Tasks/autoPostponeTasksCloud.test.js` (holds), `functions/shared/UndoActionService.test.js`
  (`skipIfChanged`), `__tests__/Firestore/firestoreRules.emulator.test.js` (dailyPlans server-owned).
- `browser-tests/at3142/run.js` — real Chromium, synthetic data, network blocked: desktop flow,
  overload, missing calendar, 390 px without horizontal overflow.

## Known limits / follow-ups

- Not exposed over MCP / assistant tools yet (parity rule in `mcp.md` applies when it is).
- Estimate edits in the review are not saved to the task.
- "n left" counts planned tasks still open and due today; a planned task postponed by hand later
  counts as no longer left.
- Firestore rules change is live only after `deploy:firestore:rules:production`.
