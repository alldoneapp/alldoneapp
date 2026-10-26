import {
    BLOATED_TARGET_COUNT,
    CACHE_CHECK_DELAY_MS,
    CLEAR_TIMEOUT_MS,
    FIRESTORE_CACHE_RESET_KEY,
    RESET_REQUEST_MAX_AGE_MS,
    applyPendingFirestoreCacheReset,
    inspectFirestoreCache,
    readCacheResetState,
    scheduleFirestoreCacheResetCheck,
} from './firestoreCacheReset'
import { recordNewDayEvent } from '../newDayDiagnostics'

jest.mock('../newDayDiagnostics', () => ({ recordNewDayEvent: jest.fn() }))
jest.mock('../commentDraftStore', () => ({ hasUnsafeCommentDrafts: () => false }))
jest.mock('./pendingTaskWrites', () => ({ hasPendingTaskWrites: () => false }))

const memoryStorage = (initial = {}) => {
    const values = new Map(Object.entries(initial))
    return {
        getItem: key => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => values.set(key, value),
    }
}
const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
}
const bloated = { targetCount: BLOATED_TARGET_COUNT + 1, byteSize: 0, pendingMutations: 0, liveClients: 1 }

let storage
let timers
const setTimer = (fn, ms) => {
    timers.push({ fn, ms })
    return timers.length
}
beforeEach(() => {
    storage = memoryStorage()
    timers = []
    recordNewDayEvent.mockClear()
})

describe('applying a requested reset at boot', () => {
    const request = (state, at = 1000) => storage.setItem(FIRESTORE_CACHE_RESET_KEY, JSON.stringify({ state, at }))

    it('does nothing without a request', () => {
        const db = { clearPersistence: jest.fn() }
        expect(applyPendingFirestoreCacheReset(db, { storage, now: () => 1000, setTimer })).toBe(false)
        expect(db.clearPersistence).not.toHaveBeenCalled()
    })

    it('clears the persisted cache once and remembers that it did', async () => {
        request('requested')
        const db = { clearPersistence: jest.fn(() => Promise.resolve()) }
        expect(applyPendingFirestoreCacheReset(db, { storage, now: () => 2000, setTimer })).toBe(true)
        expect(db.clearPersistence).toHaveBeenCalledTimes(1)
        expect(readCacheResetState(storage).state).toBe('clearing')
        await flush()
        expect(readCacheResetState(storage).state).toBe('done')
        expect(recordNewDayEvent).toHaveBeenCalledWith('cache-reset', { reason: 'done' })
    })

    it('ignores a stale request and never retries an interrupted clear', () => {
        const db = { clearPersistence: jest.fn() }
        request('requested', 0)
        expect(applyPendingFirestoreCacheReset(db, { storage, now: () => RESET_REQUEST_MAX_AGE_MS, setTimer })).toBe(
            false
        )
        request('clearing')
        expect(applyPendingFirestoreCacheReset(db, { storage, now: () => 1500, setTimer })).toBe(false)
        expect(readCacheResetState(storage)).toMatchObject({ state: 'failed', reason: 'interrupted' })
        expect(db.clearPersistence).not.toHaveBeenCalled()
    })

    it('gives up and replaces the page when the deletion stays blocked', () => {
        request('requested')
        const reload = jest.fn()
        applyPendingFirestoreCacheReset(
            { clearPersistence: () => new Promise(() => {}) },
            { storage, now: () => 2000, setTimer, reload }
        )
        expect(timers[0].ms).toBe(CLEAR_TIMEOUT_MS)
        timers[0].fn()
        expect(reload).toHaveBeenCalled()
        expect(readCacheResetState(storage)).toMatchObject({ state: 'failed', reason: 'timeout' })
    })
})

describe('requesting the reset', () => {
    const makeDoc = (visibilityState = 'visible') => {
        const listeners = new Set()
        return {
            visibilityState,
            addEventListener: (_, fn) => listeners.add(fn),
            removeEventListener: (_, fn) => listeners.delete(fn),
            hide() {
                this.visibilityState = 'hidden'
                listeners.forEach(fn => fn())
            },
            listeners,
        }
    }
    const start = (overrides = {}) => {
        const doc = overrides.doc || makeDoc()
        const reload = jest.fn()
        const db = { waitForPendingWrites: jest.fn(() => Promise.resolve()) }
        const inspect = overrides.inspect || jest.fn(async () => bloated)
        scheduleFirestoreCacheResetCheck(db, {
            storage,
            inspect,
            reload,
            setTimer,
            clearTimer: jest.fn(),
            doc,
            // Stands in for appResume's page-hidden signal, which owns the visibility listeners.
            subscribeHidden: fn => {
                doc.addEventListener('visibilitychange', fn)
                return () => doc.removeEventListener('visibilitychange', fn)
            },
            now: () => 5000,
            isOnline: () => true,
            hasPendingAppWrites: () => false,
            ...overrides,
        })
        return { doc, reload, db, inspect }
    }

    it('waits until the page is hidden and every write is acknowledged, then reloads into the reset', async () => {
        const { doc, reload, db } = start()
        expect(timers[0].ms).toBe(CACHE_CHECK_DELAY_MS)
        await timers[0].fn()
        await flush()
        expect(reload).not.toHaveBeenCalled()
        doc.hide()
        await flush()
        expect(db.waitForPendingWrites).toHaveBeenCalled()
        expect(reload).toHaveBeenCalledTimes(1)
        expect(readCacheResetState(storage)).toEqual({ state: 'requested', at: 5000 })
        expect(doc.listeners.size).toBe(0)
    })

    it('leaves a healthy cache alone and never runs again after a reset', async () => {
        const healthy = start({ inspect: jest.fn(async () => ({ ...bloated, targetCount: 10, byteSize: 10 })) })
        await timers[0].fn()
        expect(healthy.doc.listeners.size).toBe(0)

        timers = []
        storage.setItem(FIRESTORE_CACHE_RESET_KEY, JSON.stringify({ state: 'done', at: 1 }))
        start()
        expect(timers).toHaveLength(0)
    })

    it.each([
        ['an unacknowledged mutation', { inspect: async () => ({ ...bloated, pendingMutations: 1 }) }],
        ['another live tab', { inspect: async () => ({ ...bloated, liveClients: 2 }) }],
        ['a task write or comment draft in flight', { hasPendingAppWrites: () => true }],
        ['no connection', { isOnline: () => false }],
    ])('never deletes the cache with %s', async (_, overrides) => {
        const { doc, reload } = start(overrides)
        await timers[0].fn()
        doc.hide()
        await flush()
        expect(reload).not.toHaveBeenCalled()
        expect(readCacheResetState(storage)).toBeNull()
    })

    it('does not wait forever for writes the server never acknowledges', async () => {
        const { doc, reload, db } = start()
        db.waitForPendingWrites.mockReturnValue(new Promise(() => {}))
        await timers[0].fn()
        doc.hide()
        await flush()
        timers.at(-1).fn()
        await flush()
        expect(reload).not.toHaveBeenCalled()
    })
})

describe('inspecting the cache without starting the SDK', () => {
    const request = (result, extra = {}) => {
        const req = { result, ...extra }
        setTimeout(() => (req.error ? req.onerror?.() : req.onsuccess?.()))
        return req
    }
    const fakeIndexedDb = ({ exists = true, stores = {} } = {}) => {
        const closed = jest.fn()
        const opened = jest.fn()
        const database = {
            objectStoreNames: { contains: name => name in stores },
            close: closed,
            transaction: () => ({
                objectStore: name => ({
                    getAll: () => request(stores[name]),
                    count: () => request(stores[name].length),
                }),
            }),
        }
        return {
            closed,
            opened,
            databases: async () => (exists ? [{ name: 'firestore/[DEFAULT]/demo/main' }] : []),
            open: name => {
                opened(name)
                return request(database)
            },
        }
    }

    it('reads targets, document bytes, queued writes and live clients', async () => {
        const idb = fakeIndexedDb({
            stores: {
                targetGlobal: [{ targetCount: 29230 }],
                remoteDocumentGlobal: [{ byteSize: 103274374 }],
                mutations: [],
                clientMetadata: [{ updateTimeMs: 9000 }, { updateTimeMs: 1 }],
            },
        })
        const inspection = await inspectFirestoreCache({ projectId: 'demo', indexedDB: idb, now: () => 10000 })
        expect(inspection).toEqual({ targetCount: 29230, byteSize: 103274374, pendingMutations: 0, liveClients: 2 })
        expect(idb.closed).toHaveBeenCalled()
    })

    it('never opens, and so never creates, a database that does not exist', async () => {
        const idb = fakeIndexedDb({ exists: false })
        expect(await inspectFirestoreCache({ projectId: 'demo', indexedDB: idb })).toBeNull()
        expect(idb.opened).not.toHaveBeenCalled()
    })
})
