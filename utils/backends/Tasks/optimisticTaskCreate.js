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
 *
 * Settlement (AT-2500). The two events above are not enough on their own, because they only ever
 * describe the task as it looked at the moment it was created. A user who postpones the task
 * before the echo arrives changes the document underneath the published row, and a watcher can
 * then be left holding a row that Firestore will never mention again: the task no longer matches
 * the list's query (`dueDate <= endOfDay` for today's board and for My Day), so there is no
 * `added` to correct it and no `removed` to take it away. The row stays in today's list, showing
 * a date it no longer has, until the whole watcher restarts.
 *
 * `publishOptimisticTaskSettled` closes that hole with the one fact only the writer knows: the
 * `set()` has been acknowledged by the SERVER. Firestore raises the local `added` for a matching
 * document as soon as the mutation is applied locally, which is always well before the round trip
 * completes - so by settlement time a document that belongs in a list has already been offered to
 * that list. A subscriber that has still not seen the document therefore knows it is not in its
 * query, and may drop the optimistic row instead of waiting for an echo that is never coming.
 *
 * Deliberately NOT published when the write is still in flight offline: `set()` only resolves on
 * the server ack, so an offline create keeps its optimistic row (the local cache holds the
 * document and the row is correct), which is exactly what should happen.
 */

const subscribersByProject = new Map()

export const OPTIMISTIC_TASK_ADDED = 'added'
export const OPTIMISTIC_TASK_REMOVED = 'removed'
/**
 * Carries an id only - by definition there is no document data to publish, since the point of the
 * event is that the authoritative document is now Firestore's to describe, not ours. Subscribers
 * must branch on this type BEFORE reading `doc.data()`.
 */
export const OPTIMISTIC_TASK_SETTLED = 'settled'

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

/**
 * AT-2500 - the server has acknowledged the create, so every list may now trust its own view of
 * the document over the payload we published optimistically. Carries no data on purpose: a
 * subscriber that still has an unconfirmed row for this id must drop it, and one that has seen
 * the real document has nothing to do.
 */
export const publishOptimisticTaskSettled = (projectId, taskId) => {
    if (!projectId || !taskId) return
    publish(projectId, {
        type: OPTIMISTIC_TASK_SETTLED,
        doc: { id: taskId, exists: true, data: () => null, metadata: { fromCache: false } },
    })
}

/** Test-only: the bus is module state, so suites must be able to start from a clean one. */
export const resetOptimisticTaskCreates = () => subscribersByProject.clear()
