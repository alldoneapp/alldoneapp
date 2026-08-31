/**
 * Compact stale-while-revalidate projections for the secondary All Projects views.
 *
 * Firestore's persistent cache remains the canonical offline store. These projections only avoid
 * rebuilding the rows the user just saw through many per-project IndexedDB queries when opening
 * Goals, Notes, Contacts or Chats. Every consumer still attaches its normal listeners and replaces
 * the projection as soon as the first complete live/cache snapshot arrives.
 */

export const SECONDARY_VIEW_CACHE_SCHEMA_VERSION = 1
export const SECONDARY_VIEW_CACHE_MAX_AGE_MS = 36 * 60 * 60 * 1000
export const SECONDARY_VIEW_CACHE_WRITE_DELAY_MS = 1200
export const SECONDARY_VIEW_CACHE_MAX_ENTRIES_PER_VIEW = 128

export const SECONDARY_VIEW_GOALS = 'goals'
export const SECONDARY_VIEW_NOTES = 'notes'
export const SECONDARY_VIEW_CONTACTS = 'contacts'
export const SECONDARY_VIEW_CHATS = 'chats'

const DATABASE_NAME = 'alldone-secondary-view-cache'
const DATABASE_VERSION = 1
const SNAPSHOT_STORE = 'snapshots'

const recordsByUser = new Map()
const loadedUsers = new Set()
const pendingReads = new Map()
const pendingWriteTimers = new Map()
const pendingIdleHandles = new Map()

const getIndexedDbFactory = () => {
    if (typeof window !== 'undefined' && window.indexedDB) return window.indexedDB
    if (typeof indexedDB !== 'undefined') return indexedDB
    return null
}

const createEmptyRecord = (userId, savedAt = Date.now()) => ({
    schemaVersion: SECONDARY_VIEW_CACHE_SCHEMA_VERSION,
    userId,
    savedAt,
    views: {},
})

const openCacheDatabase = factory =>
    new Promise((resolve, reject) => {
        const request = factory.open(DATABASE_NAME, DATABASE_VERSION)
        request.onupgradeneeded = () => {
            const database = request.result
            if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
                database.createObjectStore(SNAPSHOT_STORE, { keyPath: 'userId' })
            }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error || new Error('Could not open the secondary view cache'))
        request.onblocked = () => reject(new Error('Secondary view cache upgrade was blocked'))
    })

const readRecord = async userId => {
    const factory = getIndexedDbFactory()
    if (!factory || !userId) return null

    let database
    try {
        database = await openCacheDatabase(factory)
        return await new Promise((resolve, reject) => {
            const transaction = database.transaction(SNAPSHOT_STORE, 'readonly')
            const request = transaction.objectStore(SNAPSHOT_STORE).get(userId)
            request.onsuccess = () => resolve(request.result || null)
            request.onerror = () => reject(request.error || new Error('Could not read the secondary view cache'))
        })
    } finally {
        database?.close()
    }
}

const writeRecord = async record => {
    const factory = getIndexedDbFactory()
    if (!factory || !record?.userId) return false

    let database
    try {
        database = await openCacheDatabase(factory)
        await new Promise((resolve, reject) => {
            const transaction = database.transaction(SNAPSHOT_STORE, 'readwrite')
            transaction.objectStore(SNAPSHOT_STORE).put(record)
            transaction.oncomplete = resolve
            transaction.onerror = () => reject(transaction.error || new Error('Could not write secondary view cache'))
            transaction.onabort = () => reject(transaction.error || new Error('Secondary view cache write aborted'))
        })
        return true
    } finally {
        database?.close()
    }
}

const isFreshTimestamp = (savedAt, now) =>
    Number.isFinite(savedAt) && savedAt <= now + 5 * 60 * 1000 && now - savedAt <= SECONDARY_VIEW_CACHE_MAX_AGE_MS

export const getRestorableSecondaryViewCache = (record, userId, now = Date.now()) => {
    if (
        !record ||
        record.schemaVersion !== SECONDARY_VIEW_CACHE_SCHEMA_VERSION ||
        record.userId !== userId ||
        !isFreshTimestamp(record.savedAt, now)
    ) {
        return null
    }

    const views = {}
    Object.entries(record.views || {}).forEach(([view, entries]) => {
        const freshEntries = {}
        Object.entries(entries || {}).forEach(([key, entry]) => {
            if (entry && isFreshTimestamp(entry.savedAt, now) && entry.value !== undefined) {
                freshEntries[key] = entry
            }
        })
        if (Object.keys(freshEntries).length > 0) views[view] = freshEntries
    })

    return { ...record, views }
}

const mergeRecords = (diskRecord, memoryRecord, userId) => {
    const merged = createEmptyRecord(userId)
    ;[diskRecord, memoryRecord].filter(Boolean).forEach(record => {
        Object.entries(record.views || {}).forEach(([view, entries]) => {
            merged.views[view] = { ...(merged.views[view] || {}), ...entries }
        })
        merged.savedAt = Math.max(merged.savedAt, record.savedAt || 0)
    })
    return merged
}

export const primeSecondaryViewCache = userId => {
    if (!userId) return Promise.resolve(null)
    if (loadedUsers.has(userId)) return Promise.resolve(recordsByUser.get(userId) || createEmptyRecord(userId))
    if (pendingReads.has(userId)) return pendingReads.get(userId)

    const promise = readRecord(userId)
        .then(record => {
            const diskRecord = getRestorableSecondaryViewCache(record, userId)
            const merged = mergeRecords(diskRecord, recordsByUser.get(userId), userId)
            recordsByUser.set(userId, merged)
            loadedUsers.add(userId)
            return merged
        })
        .catch(error => {
            if (typeof __DEV__ !== 'undefined' && __DEV__) {
                console.warn('[SecondaryViewCache] Read failed:', error)
            }
            const record = recordsByUser.get(userId) || createEmptyRecord(userId)
            recordsByUser.set(userId, record)
            loadedUsers.add(userId)
            return record
        })
        .finally(() => pendingReads.delete(userId))

    pendingReads.set(userId, promise)
    return promise
}

export const buildSecondaryViewCacheKey = (...parts) => JSON.stringify(parts)

const getEntry = (record, view, key, now = Date.now()) => {
    const entry = record?.views?.[view]?.[key]
    return entry && isFreshTimestamp(entry.savedAt, now) ? entry.value : null
}

export const getSecondaryViewCacheEntrySync = (userId, view, key, now = Date.now()) =>
    getEntry(recordsByUser.get(userId), view, key, now)

export const getSecondaryViewCacheEntry = async (userId, view, key, now = Date.now()) => {
    const inMemory = getSecondaryViewCacheEntrySync(userId, view, key, now)
    if (inMemory) return inMemory
    const record = await primeSecondaryViewCache(userId)
    return getEntry(record, view, key, now)
}

const cancelIdleWrite = userId => {
    const handle = pendingIdleHandles.get(userId)
    if (handle === undefined) return
    if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(handle)
    } else {
        clearTimeout(handle)
    }
    pendingIdleHandles.delete(userId)
}

const persistUserRecord = async userId => {
    await primeSecondaryViewCache(userId)
    const record = recordsByUser.get(userId)
    if (!record) return false
    try {
        return await writeRecord(record)
    } catch (error) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn('[SecondaryViewCache] Write failed:', error)
        }
        return false
    }
}

const schedulePersist = (userId, delayMs = SECONDARY_VIEW_CACHE_WRITE_DELAY_MS) => {
    clearTimeout(pendingWriteTimers.get(userId))
    cancelIdleWrite(userId)

    pendingWriteTimers.set(
        userId,
        setTimeout(() => {
            pendingWriteTimers.delete(userId)
            const run = () => {
                pendingIdleHandles.delete(userId)
                persistUserRecord(userId)
            }
            const handle =
                typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
                    ? window.requestIdleCallback(run, { timeout: 4000 })
                    : setTimeout(run, 0)
            pendingIdleHandles.set(userId, handle)
        }, delayMs)
    )
}

export const setSecondaryViewCacheEntry = (userId, view, key, value, { savedAt = Date.now(), persist = true } = {}) => {
    if (!userId || !view || !key || value === undefined) return false
    const record = recordsByUser.get(userId) || createEmptyRecord(userId, savedAt)
    record.schemaVersion = SECONDARY_VIEW_CACHE_SCHEMA_VERSION
    record.userId = userId
    record.savedAt = savedAt
    const viewEntries = {
        ...(record.views?.[view] || {}),
        [key]: { savedAt, value },
    }
    const oldestKeys = Object.entries(viewEntries)
        .sort(([, first], [, second]) => (second.savedAt || 0) - (first.savedAt || 0))
        .slice(SECONDARY_VIEW_CACHE_MAX_ENTRIES_PER_VIEW)
        .map(([entryKey]) => entryKey)
    oldestKeys.forEach(entryKey => delete viewEntries[entryKey])
    record.views = { ...record.views, [view]: viewEntries }
    recordsByUser.set(userId, record)
    if (persist) schedulePersist(userId)
    return true
}

export const resetSecondaryViewCacheForTests = () => {
    pendingWriteTimers.forEach(clearTimeout)
    pendingIdleHandles.forEach((handle, userId) => {
        if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
            window.cancelIdleCallback(handle)
        } else {
            clearTimeout(handle)
        }
        pendingIdleHandles.delete(userId)
    })
    recordsByUser.clear()
    loadedUsers.clear()
    pendingReads.clear()
    pendingWriteTimers.clear()
}
