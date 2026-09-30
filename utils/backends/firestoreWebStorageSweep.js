/**
 * Removes the localStorage entries Firestore's multi-tab mode leaves behind.
 *
 * With `persistentMultipleTabManager` the SDK mirrors each tab's state into
 * localStorage so other tabs can follow it: one `firestore_clients_*` entry per
 * tab, one `firestore_targets_*` entry per query and one `firestore_mutations_*`
 * entry per write. A target entry is only removed when its listener is
 * explicitly unsubscribed, so every query still open when a page reloads,
 * closes or is killed stays behind for good, and a client entry survives
 * whenever `pagehide` does not fire (Android killing the app). Queries that
 * carry today's date become new targets every day. The dogfooding Pixel held
 * 11,311 target entries (2.2 MB of the ~5 MB origin quota) after six weeks;
 * past the quota the app's own writes (comment outbox, pending task markers,
 * drafts) start to fail.
 *
 * The SDK reads none of the orphans, but it DOES act on a removed client entry:
 * other tabs treat that client as gone and stop listening for its queries. So a
 * client is only removed when Firestore's own IndexedDB heartbeat (refreshed
 * every few seconds by every live tab) and its localStorage entry both say it
 * has been silent for longer than the SDK's own 30-minute client age. Target
 * entries named by a kept client are kept too. Everything that cannot be
 * proven safe is left alone: an unreadable IndexedDB skips the sweep entirely.
 */
import { logPerformanceMeasurement } from '../performance/performanceLogger'

// Mirrors the SDK's MAX_CLIENT_AGE_MS: older clients are no longer "active" to it.
export const FIRESTORE_CLIENT_MAX_AGE_MS = 30 * 60 * 1000
export const FIRESTORE_WEB_STORAGE_SWEEP_DELAY_MS = 60 * 1000
export const FIRESTORE_WEB_STORAGE_SWEEP_CHUNK_SIZE = 250
const CLIENT_METADATA_READ_TIMEOUT_MS = 2000

export const getFirestorePersistenceKey = db => {
    const appName = db?.app?.name
    const projectId = db?.app?.options?.projectId
    return appName && projectId ? `firestore/${appName}/${projectId}/` : null
}

const prefixesFor = persistenceKey => ({
    client: `firestore_clients_${persistenceKey}_`,
    target: `firestore_targets_${persistenceKey}_`,
    mutation: `firestore_mutations_${persistenceKey}_`,
})

const parse = value => {
    try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' ? parsed : null
    } catch (_) {
        return null
    }
}

const isRecent = (parsed, now, maxAgeMs) =>
    !!parsed && Number.isFinite(parsed.updateTimeMs) && now - parsed.updateTimeMs < maxAgeMs

/**
 * Pure planning step. `entries` are [key, value] pairs from localStorage;
 * `liveClientIds` comes from Firestore's IndexedDB client metadata.
 * Returns the keys to remove.
 */
export const planFirestoreWebStorageSweep = ({
    entries,
    persistenceKey,
    liveClientIds,
    now,
    maxAgeMs = FIRESTORE_CLIENT_MAX_AGE_MS,
}) => {
    const prefix = prefixesFor(persistenceKey)
    const removals = []
    const keptTargetIds = new Set()
    const targets = []

    entries.forEach(([key, value]) => {
        if (key.startsWith(prefix.client)) {
            const clientId = key.slice(prefix.client.length)
            const parsed = parse(value)
            if (liveClientIds.has(clientId) || isRecent(parsed, now, maxAgeMs)) {
                ;(Array.isArray(parsed?.activeTargetIds) ? parsed.activeTargetIds : []).forEach(id =>
                    keptTargetIds.add(id)
                )
            } else {
                removals.push(key)
            }
        } else if (key.startsWith(prefix.target)) {
            targets.push([key, value])
        } else if (key.startsWith(prefix.mutation)) {
            // Only other tabs read these, through the storage event that has
            // already fired; the owning tab rewrites and removes it on settle.
            if (!isRecent(parse(value), now, maxAgeMs)) removals.push(key)
        }
    })

    targets.forEach(([key, value]) => {
        const targetId = Number(key.slice(prefix.target.length))
        if (keptTargetIds.has(targetId) || isRecent(parse(value), now, maxAgeMs)) return
        removals.push(key)
    })

    return removals
}

/** Client ids Firestore itself considers active, or null when that cannot be read. */
export const readLiveFirestoreClientIds = ({
    persistenceKey,
    now = Date.now,
    maxAgeMs = FIRESTORE_CLIENT_MAX_AGE_MS,
    indexedDBObject = typeof indexedDB === 'undefined' ? undefined : indexedDB,
} = {}) => {
    if (!persistenceKey || !indexedDBObject) return Promise.resolve(null)
    const name = `${persistenceKey}main`
    return new Promise(resolve => {
        let database
        let finished = false
        const finish = value => {
            if (finished) return
            finished = true
            clearTimeout(timer)
            try {
                database?.close()
            } catch (_) {}
            resolve(value)
        }
        const timer = setTimeout(() => finish(null), CLIENT_METADATA_READ_TIMEOUT_MS)
        try {
            const request = indexedDBObject.open(name)
            request.onerror = () => finish(null)
            request.onblocked = () => finish(null)
            // Never create or migrate Firestore's database from here.
            request.onupgradeneeded = () => request.transaction.abort()
            request.onsuccess = () => {
                database = request.result
                if (finished) return database.close()
                if (!database.objectStoreNames.contains('clientMetadata')) return finish(null)
                const transaction = database.transaction('clientMetadata', 'readonly')
                const read = transaction.objectStore('clientMetadata').getAll()
                read.onsuccess = () => {
                    const cutoff = now() - maxAgeMs
                    finish(
                        new Set(
                            (read.result || [])
                                .filter(client => client && client.updateTimeMs >= cutoff)
                                .map(client => client.clientId)
                        )
                    )
                }
                read.onerror = () => finish(null)
                transaction.onabort = () => finish(null)
            }
        } catch (_) {
            finish(null)
        }
    })
}

const readEntries = storage => {
    const entries = []
    for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index)
        if (key && key.startsWith('firestore_')) entries.push([key, storage.getItem(key)])
    }
    return entries
}

/**
 * Plans and removes the orphans in small chunks, yielding between them so the
 * main thread (and any other tab processing the storage events) stays responsive.
 * A key that became recent since planning is skipped rather than removed.
 */
export const sweepFirestoreWebStorage = async ({
    storage,
    persistenceKey,
    readLiveClientIds = () => readLiveFirestoreClientIds({ persistenceKey }),
    now = Date.now,
    maxAgeMs = FIRESTORE_CLIENT_MAX_AGE_MS,
    chunkSize = FIRESTORE_WEB_STORAGE_SWEEP_CHUNK_SIZE,
    yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0)),
    record = logPerformanceMeasurement,
} = {}) => {
    if (!storage || !persistenceKey) return { removed: 0, skipped: 'unavailable' }
    const startedAt = now()
    const liveClientIds = await readLiveClientIds()
    if (!liveClientIds) return { removed: 0, skipped: 'client_metadata_unavailable' }

    let entries
    try {
        entries = readEntries(storage)
    } catch (_) {
        return { removed: 0, skipped: 'storage_unreadable' }
    }
    const removals = planFirestoreWebStorageSweep({ entries, persistenceKey, liveClientIds, now: now(), maxAgeMs })

    let removed = 0
    let bytes = 0
    for (let offset = 0; offset < removals.length; offset += chunkSize) {
        if (offset) await yieldToBrowser()
        const checkedAt = now()
        removals.slice(offset, offset + chunkSize).forEach(key => {
            try {
                const value = storage.getItem(key)
                if (value === null || isRecent(parse(value), checkedAt, maxAgeMs)) return
                storage.removeItem(key)
                removed++
                bytes += key.length + value.length
            } catch (_) {}
        })
    }

    try {
        record(
            'firestore_webstorage_sweep',
            'complete',
            Math.max(0, now() - startedAt),
            { candidate_count: entries.length, count: removed, byte_count: bytes },
            { sampleRate: removed ? 1 : 0.1 }
        )
    } catch (_) {}
    return { removed, bytes, scanned: entries.length }
}

let sweepScheduled = false

/**
 * Runs the sweep once per page, a minute after boot and in idle time, so it
 * never competes with the initial sync it would otherwise slow down.
 */
export const scheduleFirestoreWebStorageSweep = (db, { delayMs = FIRESTORE_WEB_STORAGE_SWEEP_DELAY_MS } = {}) => {
    if (sweepScheduled || typeof window === 'undefined') return
    const persistenceKey = getFirestorePersistenceKey(db)
    if (!persistenceKey) return
    sweepScheduled = true
    setTimeout(() => {
        const run = () => {
            let storage
            try {
                storage = window.localStorage
            } catch (_) {
                return
            }
            sweepFirestoreWebStorage({ storage, persistenceKey }).catch(error =>
                console.warn('[Firestore] localStorage sweep failed:', error)
            )
        }
        if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 10000 })
        else run()
    }, delayMs)
}
