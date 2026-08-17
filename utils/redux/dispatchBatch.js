import store from '../../redux/store'

/**
 * AT-2337 — dispatch coalescing for the open-tasks watcher pipeline.
 *
 * Why this exists
 * ---------------
 * "All projects → Tasks" mounts one independent block per project (a heavy
 * dogfooding account renders ~78 of them), and every one of those blocks owns
 * its own set of Firestore `onSnapshot` listeners. Each snapshot used to walk
 * through ~10 SEPARATE `store.dispatch(...)` calls (open tasks, filtered open
 * tasks, hidden-task flag, first-day flag, today's empty goals, loading flags,
 * open-tasks map, open-subtasks map, subtasks-by-task, stopLoadingData).
 *
 * A redux dispatch is not free here even though the reducers are cheap shallow
 * copies: react-redux 9 subscribes through `useSyncExternalStoreWithSelector`,
 * so EVERY notification synchronously re-runs the selector of EVERY mounted
 * `useSelector`. The all-projects board has thousands of them (~15 per project
 * block, ~19 per date section, ~16 per task row), so the cost of a snapshot is
 * `dispatches × subscribers`, and the dispatch count is the only half of that
 * product we can cut without changing what the screen shows.
 *
 * React 18's auto-batching does NOT help with this: it coalesces the resulting
 * re-renders, but the selector runs happen before React is involved at all.
 *
 * What it does
 * ------------
 * `runInDispatchBatch(fn)` buffers every action sent through `batchDispatch`
 * while `fn` runs, then hands them to the store as ONE array dispatch.
 * `@manaflair/redux-batch` (already installed, see redux/store.js) reduces an
 * array of actions in order and notifies subscribers exactly once, so the final
 * state and the relative ordering of the actions are byte-for-byte what they
 * were before — only the number of subscriber notifications changes.
 *
 * Care required
 * -------------
 * Code that reads `store.getState()` BETWEEN two buffered dispatches sees the
 * pre-batch state. That is safe for the open-tasks pipeline (the values it
 * reads back — `taskListSingleLoading`, the hashtag/priority/VM filters,
 * `subtaskByTaskStore` — are never written by the actions being buffered in the
 * same batch), but it is the thing to check before wrapping a new call site.
 * Nested `runInDispatchBatch` calls join the outer batch rather than flushing
 * early, so a helper can be batched without knowing who called it.
 */

let buffer = null

/**
 * Dispatch an action, or add it to the batch currently being collected.
 * Outside a batch this is exactly `store.dispatch`.
 */
export const batchDispatch = action => {
    if (buffer !== null) {
        buffer.push(action)
        return action
    }
    return store.dispatch(action)
}

/**
 * Run `fn`, coalescing every `batchDispatch` made during it into a single
 * store notification. Returns whatever `fn` returns. The batch is flushed even
 * if `fn` throws, so a failing snapshot handler cannot strand queued actions.
 */
export const runInDispatchBatch = fn => {
    if (buffer !== null) {
        // Already collecting - join the outer batch so the flush stays single.
        return fn()
    }

    buffer = []
    let actions
    try {
        return fn()
    } finally {
        actions = buffer
        buffer = null
        if (actions.length === 1) {
            store.dispatch(actions[0])
        } else if (actions.length > 1) {
            store.dispatch(actions)
        }
    }
}

/** Test helper: true while a batch is being collected. */
export const isCollectingDispatchBatch = () => buffer !== null
