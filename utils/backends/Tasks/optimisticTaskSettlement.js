import { isEqual } from 'lodash'

import { getDb } from '../firestore'
import {
    discardOptimisticTaskSubscribers,
    onOptimisticTaskSubscribersConfirmed,
    publishOptimisticTaskSettled,
} from './optimisticTaskCreate'

/**
 * AT-2500, second follow-up - a task created and postponed a moment later was STILL left in
 * today's list.
 *
 * The first follow-up made settlement carry the document, so a list could re-check its optimistic
 * row against its own query instead of inferring anything from the absence of an echo. That is
 * right, and it fixed the blink. What it did not fix is that settlement happens exactly ONCE, at
 * the server ack of the create - and the window in which the row can still be orphaned is far
 * longer than that.
 *
 * The two ends of that window come from opposite places:
 *
 *  - the ack lands as soon as Firestore has the `set()`, a few hundred milliseconds in;
 *  - the row stays UNCONFIRMED until a query snapshot names the document, and none can until
 *    `onCreateTask` -> `synchronizeAccessProjection` has written `readerIds` server-side and it has
 *    travelled back. Every one of these watchers filters on that field, so before it exists the
 *    task matches no query anywhere. On the reporting account that took about TEN SECONDS
 *    (`items/-M6X9.../tasks/-P0cmKxbkjhYRGSriDKc`: created 19:40:22, postponed 19:40:24, server
 *    `updateTime` 19:40:32).
 *
 * Anything the user does in between is therefore invisible to every list. Postponing at +2.5s -
 * i.e. exactly "add a task and immediately move it to another date" - is read from the local cache
 * by nobody: settlement has already been and gone, the document still matches no query (it has no
 * projection yet), and once the projection does land the postponed document does not match either,
 * so no `added` is delivered and no `removed` can be. The create-time row sits in today's list
 * showing a date the task no longer has, until the whole watcher restarts. The persisted document
 * is perfectly correct throughout, which is why a reload shows the task on its new date - the
 * defect is only ever in the live list.
 *
 * So settlement is not an event, it is a WINDOW, and this module owns it. Every publication carries
 * the document as the local cache holds it right then, and the run ends the moment the lists can
 * see the task for themselves:
 *
 *   1. the immediate cache read at the ack - unchanged from the first follow-up, and still the one
 *      that answers the common "postponed before the ack" case with no listener involved;
 *   2. a document listener for the rest of the window. It is fed by the SDK's own latency
 *      compensation, so a local edit through any write path at all - `setTaskDueDate`, a batch, a
 *      drag, done, an assignee change - reaches it the instant the mutation is applied, with no
 *      hook in any of those call sites that a future one could forget;
 *   3. it stops only after every list which accepted the optimistic create has actually seen the
 *      task in its own query (or has removed its pending copy). The document receiving its access
 *      projection is not sufficient: AT-2539 reproduced a postpone between that document-listener
 *      callback and the query listener's later `added` callback. `SETTLEMENT_WINDOW_TIMEOUT_MS` is
 *      the backstop for a query that never confirms at all.
 *
 * Three properties keep this cheap. It never starts when no list subscribed to the create (nothing
 * is holding an optimistic row, so there is nothing to reconcile). It publishes only when the
 * document actually changed, so an ordinary create costs one publication and the lists recompute
 * once. And it is one document listener, for a few seconds, per created task.
 *
 * It cannot make the row worse than not running at all: every failure - no listener, a rejected
 * listen, a read that throws - degrades to `null`, which subscribers read as "no verdict" and which
 * leaves the row standing. Removing a row on no evidence is the flicker the first follow-up existed
 * to remove, and nothing here may reintroduce it.
 */

/**
 * How long a single create's settlement window may stay open. Only reached when an accepting query
 * never confirms or removes its pending row (a failed projection, a very long outage); ordinarily
 * every subscriber confirms shortly after the projection arrives.
 */
export const SETTLEMENT_WINDOW_TIMEOUT_MS = 30000

/** Runs keyed `projectId/taskId`, so a re-created id restarts its window rather than doubling it. */
const activeSettlements = new Map()

const settlementKey = (projectId, taskId) => `${projectId}/${taskId}`

const readTaskFromCache = async (projectId, taskId) => {
    try {
        const snapshot = await getDb().doc(`items/${projectId}/tasks/${taskId}`).get({ source: 'cache' })
        return snapshot && snapshot.exists ? snapshot.data() : null
    } catch (error) {
        // Cache miss (in-memory client evicted it, persistence unavailable) - no verdict.
        return null
    }
}

/**
 * Ends any settlement window still open for this task. Exported for the watcher-side teardown and
 * for tests; calling it for a task with no open window is a no-op.
 */
export const stopOptimisticTaskSettlement = (projectId, taskId) => {
    const stop = activeSettlements.get(settlementKey(projectId, taskId))
    if (stop) stop()
}

/** Test-only: this module holds live listeners and timers, so a suite must be able to reset it. */
export const stopAllOptimisticTaskSettlements = () => {
    Array.from(activeSettlements.values()).forEach(stop => stop())
    activeSettlements.clear()
}

/**
 * AT-2500 - the server has acknowledged the create. Publish what the task looks like now, and keep
 * publishing until the lists can see it for themselves.
 *
 * Never rejects and never throws: the write it follows has already succeeded, and nothing about
 * creating a task may depend on this.
 */
export const settleOptimisticTaskRow = async (projectId, taskId, { timeoutMs = SETTLEMENT_WINDOW_TIMEOUT_MS } = {}) => {
    if (!projectId || !taskId) return

    const key = settlementKey(projectId, taskId)
    stopOptimisticTaskSettlement(projectId, taskId)

    let stopped = false
    let unsubscribe = null
    let unsubscribeConfirmation = null
    let timer = null
    let lastPublished
    let hasPublished = false

    const stop = () => {
        if (stopped) return
        stopped = true
        if (activeSettlements.get(key) === stop) activeSettlements.delete(key)
        if (timer) clearTimeout(timer)
        timer = null
        if (unsubscribeConfirmation) {
            unsubscribeConfirmation()
            unsubscribeConfirmation = null
        }
        if (unsubscribe) {
            try {
                unsubscribe()
            } catch (error) {
                // A listener that cannot be torn down must not take the create path down with it.
            }
            unsubscribe = null
        }
    }

    /**
     * Publishing the same document twice would make every list recompute for nothing, and an
     * ordinary create produces the identical document several times over (the cache read, the
     * listener's first cached snapshot, the metadata-only transition to server-confirmed).
     */
    const publishIfChanged = taskData => {
        if (stopped) return
        if (hasPublished && isEqual(taskData, lastPublished)) return
        lastPublished = taskData
        hasPublished = true
        publishOptimisticTaskSettled(projectId, taskId, taskData)
    }

    activeSettlements.set(key, stop)
    unsubscribeConfirmation = onOptimisticTaskSubscribersConfirmed(projectId, taskId, stop)
    // No list accepted this task's optimistic create, or every such list already confirmed it
    // before the create ack arrived. There is no pending row for this listener to reconcile.
    if (!unsubscribeConfirmation) {
        stop()
        return
    }
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timer = setTimeout(() => {
            discardOptimisticTaskSubscribers(projectId, taskId)
            stop()
        }, timeoutMs)
    }

    // The verdict available right now, from the local cache: no network, no billed read, and it
    // already reflects every local edit made since the create - which answers the common case
    // (postponed before the ack) without the listener below ever having to fire.
    publishIfChanged(await readTaskFromCache(projectId, taskId))
    if (stopped) return

    try {
        const listenerUnsubscribe = getDb()
            .doc(`items/${projectId}/tasks/${taskId}`)
            .onSnapshot(
                { includeMetadataChanges: true },
                snapshot => {
                    if (stopped) return
                    const taskData = snapshot && snapshot.exists ? snapshot.data() : null
                    publishIfChanged(taskData)
                },
                // A listen that fails (a transport restart reported as `permission-denied` - see
                // AT-2484 - or a genuine denial) reports no verdict and simply closes the window.
                // Without this handler the SDK would raise the error as an unhandled one.
                () => {
                    discardOptimisticTaskSubscribers(projectId, taskId)
                    stop()
                }
            )

        // `onSnapshot` may deliver a cached snapshot synchronously, and that snapshot may already
        // satisfy the stop condition - in which case `stop()` has run before this assignment and
        // would leave the listener behind. Tear it down here instead.
        if (stopped) {
            try {
                listenerUnsubscribe()
            } catch (error) {
                // A listener that cannot be torn down must not take the create path down with it.
            }
        } else {
            unsubscribe = listenerUnsubscribe
        }
    } catch (error) {
        // No listener available (a stubbed client, a transport that refused). The immediate cache
        // verdict above still stands, which is precisely the behaviour before this module existed.
        discardOptimisticTaskSubscribers(projectId, taskId)
        stop()
    }
}
