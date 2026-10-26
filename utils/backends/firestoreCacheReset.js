/**
 * One-time reset of a bloated Firestore IndexedDB cache (AT-2860).
 *
 * The Artifacts tab's first linked-uploads implementation (2026-10-25) listened to whole source
 * collections and to every conversation of each project. One visit left the persistent cache with
 * ~28,000 targets and ~100 MB of documents. The data was harmless; the size was not: a local query
 * on a collection reads every cached document of it, and the cache sat at the LRU limit where the
 * SDK's garbage collector works through it. The client's Firestore queue stopped answering and the
 * app replaced itself every seven minutes (`firestore-restart_timeout`). Fixing the tab stops new
 * bloat; this removes what is already there, once per device.
 *
 * Deleting the cache must never delete work. A write the server has not acknowledged lives only in
 * that cache, and another open tab holds the same database. So the reset happens in two steps:
 *
 * 1. `scheduleFirestoreCacheResetCheck` inspects the database a while after boot. When it is
 *    bloated it waits until the page is HIDDEN, waits for every pending write to be acknowledged,
 *    confirms the mutation queue is empty, no task write or comment draft is in flight and no other
 *    tab's client is alive, records a request and reloads.
 * 2. On that reload `applyPendingFirestoreCacheReset` calls `clearPersistence()` before persistence
 *    is configured. The SDK runs the deletion first on its own queue, so the client then starts on an
 *    empty cache. A request is only honoured for a few minutes, and an interrupted clear is never
 *    retried, so this can not loop.
 */
import { hasUnsafeCommentDrafts } from '../commentDraftStore'
import { recordNewDayEvent } from '../newDayDiagnostics'
import { hasPendingTaskWrites } from './pendingTaskWrites'

export const FIRESTORE_CACHE_RESET_KEY = 'alldone.firestoreCacheReset.v1'
export const BLOATED_TARGET_COUNT = 10000
export const BLOATED_DOCUMENT_BYTES = 80 * 1024 * 1024
export const CACHE_CHECK_DELAY_MS = 90 * 1000
export const RESET_REQUEST_MAX_AGE_MS = 10 * 60 * 1000
// Every live client refreshes its metadata every few seconds, a throttled hidden one about once a
// minute. Anything that recent is a tab whose cache would be deleted under it.
export const LIVE_CLIENT_WINDOW_MS = 2 * 60 * 1000
export const PENDING_WRITES_TIMEOUT_MS = 10 * 1000
export const CLEAR_TIMEOUT_MS = 10 * 1000

const getStorage = () => {
    try {
        return window.localStorage
    } catch (error) {
        return null
    }
}

export const readCacheResetState = (storage = getStorage()) => {
    try {
        const value = JSON.parse(storage?.getItem(FIRESTORE_CACHE_RESET_KEY) || 'null')
        return value && typeof value === 'object' ? value : null
    } catch (error) {
        return null
    }
}

const writeCacheResetState = (state, storage = getStorage()) => {
    try {
        storage?.setItem(FIRESTORE_CACHE_RESET_KEY, JSON.stringify(state))
        return true
    } catch (error) {
        return false
    }
}

export const getFirestoreCacheDatabaseName = projectId => `firestore/[DEFAULT]/${projectId}/main`

const requestResult = request =>
    new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })

/**
 * Reads the cache's size from the SDK's own bookkeeping without starting the SDK. Never creates
 * the database: a database opened here before Firestore made it would have no stores and break the
 * SDK's schema upgrade. Resolves to null when there is nothing (or nothing readable) to inspect.
 */
export const inspectFirestoreCache = async ({ projectId, indexedDB: idb = globalThis.indexedDB, now = Date.now }) => {
    if (!idb || !projectId) return null
    const name = getFirestoreCacheDatabaseName(projectId)
    try {
        if (typeof idb.databases === 'function') {
            const databases = await idb.databases()
            if (!databases.some(database => database.name === name)) return null
        }
        const db = await new Promise((resolve, reject) => {
            const request = idb.open(name)
            request.onupgradeneeded = () => {
                // It did not exist: abort so nothing is created.
                request.transaction.abort()
            }
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
            request.onblocked = () => reject(new Error('blocked'))
        })
        try {
            const stores = ['targetGlobal', 'remoteDocumentGlobal', 'mutations', 'clientMetadata']
            if (!stores.every(store => db.objectStoreNames.contains(store))) return null
            const transaction = db.transaction(stores, 'readonly')
            const [targetGlobal, documentGlobal, pendingMutations, clients] = await Promise.all([
                requestResult(transaction.objectStore('targetGlobal').getAll()),
                requestResult(transaction.objectStore('remoteDocumentGlobal').getAll()),
                requestResult(transaction.objectStore('mutations').count()),
                requestResult(transaction.objectStore('clientMetadata').getAll()),
            ])
            const time = now()
            return {
                targetCount: Number(targetGlobal?.[0]?.targetCount) || 0,
                byteSize: Number(documentGlobal?.[0]?.byteSize) || 0,
                pendingMutations,
                liveClients: (clients || []).filter(
                    client => time - (Number(client?.updateTimeMs) || 0) < LIVE_CLIENT_WINDOW_MS
                ).length,
            }
        } finally {
            db.close()
        }
    } catch (error) {
        return null
    }
}

export const isBloatedFirestoreCache = inspection =>
    !!inspection && (inspection.targetCount > BLOATED_TARGET_COUNT || inspection.byteSize > BLOATED_DOCUMENT_BYTES)

/**
 * Boot step. Must run before persistence is configured and before any other Firestore call.
 * Returns true when it started a clear.
 */
export const applyPendingFirestoreCacheReset = (
    db,
    { storage = getStorage(), now = Date.now, reload = () => window.location.reload(), setTimer = setTimeout } = {}
) => {
    const state = readCacheResetState(storage)
    if (!state) return false
    if (state.state === 'clearing') {
        // The page went away mid-clear. Never try again: a clear that cannot finish is a hang.
        writeCacheResetState({ state: 'failed', at: now(), reason: 'interrupted' }, storage)
        return false
    }
    if (state.state !== 'requested' || !(now() - (Number(state.at) || 0) < RESET_REQUEST_MAX_AGE_MS)) return false
    if (!db || typeof db.clearPersistence !== 'function') return false
    if (!writeCacheResetState({ state: 'clearing', at: now() }, storage)) return false

    let settled = false
    const finish = (next, stage) => {
        if (settled) return
        settled = true
        writeCacheResetState({ ...next, at: now() }, storage)
        recordNewDayEvent('cache-reset', { reason: stage })
    }
    // The deletion waits for every other connection to the database to close. Should one never
    // close, the SDK queue is stuck behind it: replace the page, which will not try again.
    setTimer(() => {
        if (settled) return
        finish({ state: 'failed', reason: 'timeout' }, 'timeout')
        reload()
    }, CLEAR_TIMEOUT_MS)
    try {
        Promise.resolve(db.clearPersistence()).then(
            () => finish({ state: 'done' }, 'done'),
            error => finish({ state: 'failed', reason: String(error?.code || 'error') }, 'failed')
        )
    } catch (error) {
        finish({ state: 'failed', reason: String(error?.code || 'error') }, 'failed')
        return false
    }
    return true
}

const withTimeout = (promise, ms, setTimer) =>
    Promise.race([promise.then(() => true), new Promise(resolve => setTimer(() => resolve(false), ms))])

/**
 * After boot: find out whether this device's cache needs the reset and, if so, request it at the
 * first safe moment. Returns a stop function.
 */
export const scheduleFirestoreCacheResetCheck = (
    db,
    {
        projectId,
        storage = getStorage(),
        inspect = () => inspectFirestoreCache({ projectId }),
        now = Date.now,
        reload = () => window.location.reload(),
        setTimer = setTimeout,
        clearTimer = clearTimeout,
        doc = typeof document !== 'undefined' ? document : null,
        isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false,
        hasPendingAppWrites = () => hasPendingTaskWrites() || hasUnsafeCommentDrafts(),
        delayMs = CACHE_CHECK_DELAY_MS,
    } = {}
) => {
    const state = readCacheResetState(storage)
    // One reset per device and version of this key, whether it worked or not.
    if (state && state.state !== 'requested') return () => {}
    let stopped = false
    let attempting = false
    let listening = false

    const attempt = async () => {
        if (stopped || attempting || !doc || doc.visibilityState !== 'hidden') return
        attempting = true
        try {
            if (!isOnline() || hasPendingAppWrites()) return
            if (typeof db?.waitForPendingWrites === 'function') {
                const acknowledged = await withTimeout(
                    Promise.resolve(db.waitForPendingWrites()),
                    PENDING_WRITES_TIMEOUT_MS,
                    setTimer
                )
                if (!acknowledged) return
            }
            const inspection = await inspect()
            if (stopped || !isBloatedFirestoreCache(inspection)) return
            if (inspection.pendingMutations > 0 || inspection.liveClients > 1) return
            if (doc.visibilityState !== 'hidden' || hasPendingAppWrites()) return
            if (!writeCacheResetState({ state: 'requested', at: now() }, storage)) return
            recordNewDayEvent('reload', { reason: 'firestore-cache-reset' })
            stop()
            reload()
        } finally {
            attempting = false
        }
    }
    const onVisibility = () => {
        void attempt()
    }
    const stop = () => {
        stopped = true
        if (listening) doc.removeEventListener('visibilitychange', onVisibility)
        listening = false
        clearTimer(timer)
    }
    const timer = setTimer(async () => {
        if (stopped) return
        const inspection = await inspect()
        if (stopped || !isBloatedFirestoreCache(inspection) || !doc) return
        doc.addEventListener('visibilitychange', onVisibility)
        listening = true
        void attempt()
    }, delayMs)
    return stop
}
