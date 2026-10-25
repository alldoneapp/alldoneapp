/** One backend listener per key, last subscriber tears it down. No retained data after release. */
export const createSharedNoteSubscriptions = () => {
    const entries = new Map()
    return (key, start, stop, callback) => {
        let entry = entries.get(key)
        if (!entry) {
            entry = { callbacks: new Set(), hasValue: false, value: null }
            entries.set(key, entry)
            entry.callbacks.add(callback)
            try {
                entry.handle = start(value => {
                    entry.hasValue = true
                    entry.value = value
                    for (const subscriber of entry.callbacks) subscriber(value)
                })
            } catch (error) {
                entries.delete(key)
                throw error
            }
        } else {
            entry.callbacks.add(callback)
            if (entry.hasValue) callback(entry.value)
        }
        let released = false
        return () => {
            if (released) return false
            released = true
            entry.callbacks.delete(callback)
            if (!entry.callbacks.size) {
                entries.delete(key)
                stop(entry.handle)
                return true
            }
            return false
        }
    }
}

export const subscribeSharedNoteData = createSharedNoteSubscriptions()

// Missing-task verification is a one-shot read rather than a listener. Coalesce
// duplicate embeds' concurrent recovery reads; do not cache stale/deleted tasks.
const readsByLoader = new WeakMap()
export const readSharedTask = (load, projectId, taskId) => {
    let reads = readsByLoader.get(load)
    if (!reads) {
        reads = new Map()
        readsByLoader.set(load, reads)
    }
    const key = `${projectId}/${taskId}`
    if (reads.has(key)) return reads.get(key)
    const result = Promise.resolve().then(() => load(projectId, taskId))
    reads.set(key, result)
    const remove = () => {
        if (reads.get(key) === result) reads.delete(key)
    }
    result.then(remove, remove)
    return result
}
