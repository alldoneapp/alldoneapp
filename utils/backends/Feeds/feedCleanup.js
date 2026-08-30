export const DEFAULT_MAX_STORED_FEEDS = 200

const getLastChangeDate = feedDoc => {
    const value = feedDoc?.data?.()?.lastChangeDate
    return typeof value === 'number' ? value : 0
}

/**
 * Client-side feed cleanup may only inspect documents proven readable by the
 * server-owned access projection. Sorting happens after the secured query so
 * this helper does not need another composite index merely for maintenance.
 */
export async function deleteOldVisibleFeeds(db, path, readerId, maxStoredFeeds = DEFAULT_MAX_STORED_FEEDS) {
    if (!db || !path || readerId === undefined || readerId === null) return 0

    const snapshot = await db.collection(path).where('readerIds', 'array-contains', readerId).get()
    const oldFeedDocs = [...snapshot.docs]
        .sort((left, right) => getLastChangeDate(right) - getLastChangeDate(left))
        .slice(maxStoredFeeds)

    await Promise.all(oldFeedDocs.map(feedDoc => db.doc(`${path}/${feedDoc.id}`).delete()))
    return oldFeedDocs.length
}
