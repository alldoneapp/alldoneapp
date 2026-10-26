// What the Artifacts tab showed last time, kept on this device so that opening the tab draws that
// list at once and the live answer only updates it, as the Notes lists do with Firestore's own
// cache. The linked uploads cannot lean on Firestore's cache: they come from a callable
// (getProjectLinkedUploads), whose first answer for a large project can take a few calls.
//
// Nothing here widens what anybody sees: an entry is keyed by the signed-in user, it is only ever a
// copy of what that user's own listeners and calls delivered, and the live result replaces it as
// soon as it has settled. Without IndexedDB (jsdom, a private window, wedged storage) it is a memory cache.

const DB_NAME = 'alldone-artifacts-cache'
const STORE = 'entries'
const DB_VERSION = 1
const WRITE_DELAY_MS = 1000
const STORAGE_TIMEOUT_MS = 1500

const memory = new Map()
const pendingWrites = new Map()
let writeTimer = null
let dbPromise = null

function openDatabase() {
    if (dbPromise) return dbPromise
    dbPromise = new Promise(resolve => {
        if (typeof indexedDB === 'undefined' || !indexedDB) return resolve(null)
        let settled = false
        const finish = db => {
            if (settled) return db?.close()
            settled = true
            clearTimeout(timer)
            resolve(db)
        }
        const timer = setTimeout(() => finish(null), STORAGE_TIMEOUT_MS)
        try {
            const request = indexedDB.open(DB_NAME, DB_VERSION)
            request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' })
            request.onsuccess = () => {
                const db = request.result
                db.onversionchange = () => {
                    db.close()
                    dbPromise = null
                }
                finish(db)
            }
            request.onerror = () => finish(null)
            request.onblocked = () => finish(null)
        } catch (error) {
            finish(null)
        }
    })
    return dbPromise
}

function readFromDatabase(key) {
    return openDatabase().then(
        db =>
            new Promise(resolve => {
                if (!db) return resolve(undefined)
                const timer = setTimeout(() => resolve(undefined), STORAGE_TIMEOUT_MS)
                try {
                    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
                    request.onsuccess = () => {
                        clearTimeout(timer)
                        resolve(request.result ? request.result.value : undefined)
                    }
                    request.onerror = () => {
                        clearTimeout(timer)
                        resolve(undefined)
                    }
                } catch (error) {
                    clearTimeout(timer)
                    resolve(undefined)
                }
            })
    )
}

function flushWrites() {
    writeTimer = null
    if (pendingWrites.size === 0) return Promise.resolve()
    const entries = [...pendingWrites.entries()]
    pendingWrites.clear()
    return openDatabase().then(
        db =>
            new Promise(resolve => {
                if (!db) return resolve()
                try {
                    const transaction = db.transaction(STORE, 'readwrite')
                    const store = transaction.objectStore(STORE)
                    entries.forEach(([key, value]) => store.put({ key, value, savedAt: Date.now() }))
                    transaction.oncomplete = () => resolve()
                    transaction.onerror = transaction.onabort = () => resolve()
                } catch (error) {
                    // A value the browser cannot store (quota, a non-cloneable value) only costs
                    // the next visit its head start.
                    resolve()
                }
            })
    )
}

// The value this session already holds, without waiting: `undefined` when there is none.
export function readCachedValue(key) {
    return memory.has(key) ? memory.get(key) : undefined
}

// The value this session or an earlier one stored; `undefined` when there is none.
export async function loadCachedValue(key) {
    if (memory.has(key)) return memory.get(key)
    const value = await readFromDatabase(key)
    // Something written while the database was being read is newer than what it returned.
    if (memory.has(key)) return memory.get(key)
    if (value !== undefined) memory.set(key, value)
    return value
}

export function writeCachedValue(key, value) {
    memory.set(key, value)
    pendingWrites.set(key, value)
    if (!writeTimer) writeTimer = setTimeout(flushWrites, WRITE_DELAY_MS)
}

export function flushArtifactsLocalCache() {
    if (writeTimer) clearTimeout(writeTimer)
    return flushWrites()
}

export function resetArtifactsLocalCacheForTests() {
    if (writeTimer) clearTimeout(writeTimer)
    writeTimer = null
    memory.clear()
    pendingWrites.clear()
    dbPromise = null
}

export function getArtifactsListCacheKey(userId, projectId, followedOnly) {
    return `artifacts|${userId}|${projectId}|${followedOnly ? 'followed' : 'all'}`
}

export function getLinkedUploadsCacheKey(userId, projectId) {
    return `uploads|${userId}|${projectId}`
}
