export const DEFAULT_MAX_STORED_FEEDS = 200

const getLastChangeDate = feedDoc => {
    const value = feedDoc?.data?.()?.lastChangeDate
    return typeof value === 'number' ? value : 0
}

/**
 * A delete that lands on a document another cleanup already removed is not a
 * failure of this cleanup. Firestore reports it as `not-found` when the rules
 * never run, and as `permission-denied` under this app's rules: the feed delete
 * rule evaluates `canReadObject(projectId, resource.data)`, and dereferencing a
 * missing document's `resource.data` is a rules evaluation error that reaches
 * the client as PERMISSION_DENIED. Every document we delete here was returned by
 * a query that already proved it readable (the `readerIds` projection), so a
 * denial on its delete can only mean the document disappeared in between.
 */
export const isAlreadyGoneDeleteError = error => error?.code === 'not-found' || error?.code === 'permission-denied'

// One cleanup per collection at a time. Every write batch used to start its own
// run, so a burst of edits fired several cleanups that all read the same
// overflow and raced to delete it; every loser reported a permission error for
// a document the winner had just removed.
const inFlightCleanups = new Map()

/**
 * Client-side feed cleanup may only inspect documents proven readable by the
 * server-owned access projection. Sorting happens after the secured query so
 * this helper does not need another composite index merely for maintenance.
 *
 * Resolves with the number of documents this run removed. Concurrent calls for
 * the same collection and reader share the in-flight run and its result.
 */
export function deleteOldVisibleFeeds(db, path, readerId, maxStoredFeeds = DEFAULT_MAX_STORED_FEEDS) {
    if (!db || !path || readerId === undefined || readerId === null) return Promise.resolve(0)

    const key = `${path}|${readerId}|${maxStoredFeeds}`
    const inFlight = inFlightCleanups.get(key)
    if (inFlight) return inFlight

    const run = trimVisibleFeeds(db, path, readerId, maxStoredFeeds).finally(() => {
        if (inFlightCleanups.get(key) === run) inFlightCleanups.delete(key)
    })
    inFlightCleanups.set(key, run)
    return run
}

async function trimVisibleFeeds(db, path, readerId, maxStoredFeeds) {
    const snapshot = await db.collection(path).where('readerIds', 'array-contains', readerId).get()
    const oldFeedDocs = [...snapshot.docs]
        .sort((left, right) => getLastChangeDate(right) - getLastChangeDate(left))
        .slice(maxStoredFeeds)

    const results = await Promise.allSettled(oldFeedDocs.map(feedDoc => db.doc(`${path}/${feedDoc.id}`).delete()))

    const realFailure = results.find(result => result.status === 'rejected' && !isAlreadyGoneDeleteError(result.reason))
    if (realFailure) throw realFailure.reason

    return results.filter(result => result.status === 'fulfilled').length
}
