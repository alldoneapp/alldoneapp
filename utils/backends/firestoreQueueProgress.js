// Read only the persistent queue's batch IDs, never its payloads. Firestore has
// no public per-batch progress event after a reload. If this optional diagnostic
// is unavailable (memory cache/schema change), recovery keeps its normal policy.
export const readFirestoreQueueProgress = async (db, userId) => {
    if (!userId || typeof indexedDB === 'undefined' || !indexedDB.databases || !db?.app?.options?.projectId) return null
    const name = `firestore/${db.app.name}/${db.app.options.projectId}/main`
    return new Promise(resolve => {
        let database
        let finished = false
        const finish = value => {
            if (finished) return
            finished = true
            clearTimeout(timer)
            database?.close()
            resolve(value)
        }
        const timer = setTimeout(() => finish(null), 1000)
        // Include database discovery in the deadline too: a wedged storage
        // process must not hold the write monitor's recovery check indefinitely.
        Promise.resolve()
            .then(() => indexedDB.databases())
            .then(names => {
                if (finished) return
                if (!names.some(database => database.name === name)) return finish(null)
                const request = indexedDB.open(name)
                request.onerror = () => finish(null)
                request.onblocked = () => finish(null)
                request.onupgradeneeded = () => request.transaction.abort()
                request.onsuccess = () => {
                    database = request.result
                    if (finished) return database.close()
                    if (!database.objectStoreNames.contains('mutations')) return finish(null)
                    const transaction = database.transaction('mutations', 'readonly')
                    let count = 0
                    let firstBatchId = null
                    const cursor = transaction.objectStore('mutations').openCursor()
                    cursor.onsuccess = () => {
                        const row = cursor.result
                        if (!row) return
                        if (row.value.userId === userId) {
                            count++
                            firstBatchId =
                                firstBatchId === null ? row.value.batchId : Math.min(firstBatchId, row.value.batchId)
                        }
                        row.continue()
                    }
                    transaction.oncomplete = () => finish({ count, firstBatchId })
                    transaction.onerror = () => finish(null)
                    transaction.onabort = () => finish(null)
                }
            })
            .catch(() => finish(null))
    })
}

export const queueHasAdvanced = (previous, current) =>
    !!previous &&
    !!current &&
    (current.count < previous.count ||
        (previous.firstBatchId !== null &&
            current.firstBatchId !== null &&
            current.firstBatchId > previous.firstBatchId))
