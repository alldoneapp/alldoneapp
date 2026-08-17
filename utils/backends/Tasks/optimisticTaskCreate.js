/**
 * AT-2342 - show a task the user just created before Firestore echoes it back.
 *
 * Creating a task is a pure client-side act: `uploadNewTask` mints the id itself (`getId()`),
 * fills every field locally and hands the finished document to `.set()`. Nothing about the row
 * needs the server. Yet no list renders it until the document has travelled out to Firestore,
 * back through the Listen stream, into `processTaskChanges`, through the regroup/resort/refilter
 * pipeline and finally into redux. The row is therefore missing for as long as that takes - the
 * local IndexedDB write, a view recompute across every active listener, and (whenever the
 * listener is not currently in sync with the server, e.g. right after a reconnect or a tab
 * resume) up to `CACHED_SNAPSHOT_GRACE_MS` of `cachedSnapshotGate` buffering on top. The user
 * has pressed Return and their task is nowhere, which reads as "it was lost".
 *
 * This module is the bus that closes that gap. `uploadNewTask` publishes the document it is
 * about to write; every live task watcher that has subscribed decides whether the task belongs
 * in ITS query and, if so, feeds it into the very same snapshot pipeline a real Firestore change
 * would take. Reusing the real pipeline is the whole point - grouping by goal, priority sorting,
 * per-day estimation totals, hashtag/priority/VM filters and the all-projects trimming all apply
 * unchanged, so the optimistic row is indistinguishable from the settled one. Karsten chose
 * exactly that: the row appears instantly with no "saving" chrome (AT-2342 product decision).
 *
 * Why an event bus and not a redux slice of pending tasks:
 *
 *  - There is no canonical `tasks` slice to insert into. Every list in this app is the *shaped
 *    output* of its own watcher (a day-tuple here, a `[goalId, tasks]` grouping there), so a
 *    pending-task slice would have to be re-merged, re-grouped and re-sorted at every single
 *    render site. Publishing one document and letting each watcher apply it through the code it
 *    already runs is far less surface area.
 *  - It needs no lifecycle of its own. Nothing is stored here, so nothing can leak, go stale or
 *    need a TTL sweeper. The task lands in each watcher's normal state and is reconciled by that
 *    watcher's normal reconciliation.
 *
 * Reconciliation and duplicates. The delta-based watcher (`openTasks.js`) already guards its
 * `added` branch on `!tasksMap.<bucket>ById[task.id]`, so when the real Firestore `added` arrives
 * for a task we injected it is skipped - duplicates are impossible by construction, not by a
 * de-dupe pass we have to remember to keep correct. The full-rebuild watchers (`openGoalTasks`,
 * `myDayTasks`) rebuild from a document list, so they simply drop any pending document whose id
 * the real snapshot now carries. Either way the published payload is byte-identical to what
 * `.set()` writes, so even the window where both exist cannot show different data.
 *
 * Rollback. A `set()` only rejects on permission-denied or invalid data (offline it just stays
 * queued, and the local cache already holds the document, so the row is correct). When it does
 * reject, Firestore reverts its own local mutation and the listener emits a `removed` change
 * that would clean the row up on its own; publishing an explicit removal as well makes the
 * rollback deterministic for lists whose watcher is not currently mounted. Subscribers must
 * therefore treat removal as IDEMPOTENT - see the existence check in `openTasks.js`, without
 * which the two removals would decrement the per-day task/estimation counters twice.
 */

const subscribersByProject = new Map()

export const OPTIMISTIC_TASK_ADDED = 'added'
export const OPTIMISTIC_TASK_REMOVED = 'removed'

/**
 * Shapes a published task exactly like a Firestore `docChanges()` entry, so a subscriber can
 * hand it straight to the same handler it gives real changes to. `data()` returns the raw
 * document (the object passed to `.set()`), NOT a `mapTaskData` result - the pipelines map it
 * themselves, and feeding them an already-mapped task would map it twice.
 */
export const buildOptimisticTaskChange = (type, taskId, taskData) => ({
    type,
    doc: {
        id: taskId,
        exists: type === OPTIMISTIC_TASK_ADDED,
        data: () => taskData,
        // A watcher may read `metadata` to tell an unconfirmed row from a settled one. The
        // document is genuinely a pending local write at this point.
        metadata: { fromCache: true, hasPendingWrites: true },
    },
})

/**
 * @param handler receives a change shaped like a Firestore `docChanges()` entry.
 * @returns an unsubscribe function. Watchers must call it from their own unsubscribe so a
 *          publication can never reach a list nobody is watching any more.
 */
export const subscribeToOptimisticTaskCreates = (projectId, handler) => {
    if (!projectId || typeof handler !== 'function') return () => {}

    let subscribers = subscribersByProject.get(projectId)
    if (!subscribers) {
        subscribers = new Set()
        subscribersByProject.set(projectId, subscribers)
    }
    subscribers.add(handler)

    return () => {
        const current = subscribersByProject.get(projectId)
        if (!current) return
        current.delete(handler)
        if (current.size === 0) subscribersByProject.delete(projectId)
    }
}

const publish = (projectId, change) => {
    const subscribers = subscribersByProject.get(projectId)
    if (!subscribers || subscribers.size === 0) return

    // Snapshot the set first: a subscriber is free to unsubscribe (or subscribe) while handling.
    Array.from(subscribers).forEach(handler => {
        try {
            handler(change)
        } catch (error) {
            // One broken list must never take down task creation itself - the write is already
            // on its way and the real snapshot will render the task regardless.
            console.warn('[AT-2342] optimistic task subscriber failed', error)
        }
    })
}

export const publishOptimisticTaskCreated = (projectId, taskId, taskData) => {
    if (!projectId || !taskId || !taskData) return
    publish(projectId, buildOptimisticTaskChange(OPTIMISTIC_TASK_ADDED, taskId, taskData))
}

export const publishOptimisticTaskCreateFailed = (projectId, taskId, taskData) => {
    if (!projectId || !taskId || !taskData) return
    publish(projectId, buildOptimisticTaskChange(OPTIMISTIC_TASK_REMOVED, taskId, taskData))
}

/** Test-only: the bus is module state, so suites must be able to start from a clean one. */
export const resetOptimisticTaskCreates = () => subscribersByProject.clear()
