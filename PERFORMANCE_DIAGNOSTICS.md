# Client performance diagnostics

The web client emits sampled, consent-gated GA4 `performance_trace` events. The event payload is
limited to durations, stable page paths and aggregate counts; task, project, note and user ids are
never accepted by either the performance logger or the analytics allowlist.

## Measurements

- `app_boot`: authentication, current-user load, initial project data and first usable app paint.
- `firestore_persistence`: IndexedDB persistence enable/skip/failure duration.
- `browser_navigation`: native navigation milestones.
- `main_thread_long_tasks`: ten-second aggregate windows of browser long tasks.
- `page_load`: navigation start, loading-counter activity, paint and page-ready time.
- `firestore_first_snapshot`: cached-buffer and first-usable snapshot timing for task, goal,
  milestone and note boards.
- `project_data_first_snapshot`: users, contacts, workstreams and assistants loaded on demand.
- `notes_offline_prefetch` and `notes_offline_catch_up`: listing/download/IndexedDB totals, bytes,
  counts and failures.
- `bulk_task_update`: highlight, assignee, due-date, backlog, parent-goal, estimation, deletion and
  auto-postpone changes.
  The terminal phase says `client_complete` when existing code intentionally does not await the
  Firestore commit, and `server_acked` when it does.
- `move_object_project` and `move_task_project`: chat/activity history, task copy and subtask work.

The normal sample rate is 10%. High-fan-out per-project Firestore listeners use 2%. Analytics
consent remains authoritative: without consent, no event is uploaded.

## Live debug mode

Add `?perfDebug=1` to a URL or run:

```js
localStorage.setItem('alldone.performance.debug', '1')
location.reload()
```

Debug mode forces sampling for that browser and prints structured `[Performance]` console records.
The in-memory ring buffer is also available as:

```js
window.__alldonePerformance.getRecords()
window.__alldonePerformance.clear()
```

Remove the query parameter or stored key and reload to return to normal sampling.

## Controlled offline-feature comparison

Use the same account, browser and route, and compare several cold and warm runs. Change one switch
at a time:

| Variant                  | Query parameter              | localStorage key                           |
| ------------------------ | ---------------------------- | ------------------------------------------ |
| Baseline                 | `perfDebug=1`                | `alldone.performance.debug`                |
| No Firestore persistence | `perfDisablePersistence=1`   | `alldone.performance.disablePersistence`   |
| No note prefetch         | `perfDisableNotesPrefetch=1` | `alldone.performance.disableNotesPrefetch` |

Experiment switches imply debug mode. A query parameter explicitly set to `0` overrides a stored
switch for that load. Disabling Firestore persistence removes offline durability for that browser
session; use it only for a controlled comparison. Disabling note prefetch does not disable pending
offline-note catch-up, so it cannot discard edits.
