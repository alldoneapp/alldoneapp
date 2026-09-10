/**
 * AT-2500, second follow-up - "I add a task, immediately move it to another date, and it stays in
 * today's list."
 *
 * The first follow-up gave settlement the document to decide on, which was right. What it left in
 * place was that settlement happens exactly ONCE, at the create's server ack - while the optimistic
 * row stays unconfirmed until the server-side access projection lands, which production measures in
 * seconds (see the module header for the reporting account's own timings). A postpone made in that
 * gap reaches nobody: the ack has been and gone, and the postponed document matches no list's query
 * either before or after the projection, so Firestore has no `added` to correct the row with and no
 * `removed` to take it away.
 *
 * These cases drive the REAL settlement module against a fake Firestore document, because the whole
 * defect is in its LIFECYCLE - which publications happen, and when it stops. Every existing suite
 * calls `publishOptimisticTaskSettled` by hand, so none of them can see this: they assert what a
 * list does with a settlement, never whether the settlement it needs is ever published.
 */

const mockSubscriberCounts = new Map()

jest.mock('./optimisticTaskCreate', () => ({
    hasOptimisticTaskSubscribers: projectId => (mockSubscriberCounts.get(projectId) || 0) > 0,
    publishOptimisticTaskSettled: (...args) => mockPublish(...args),
}))

const mockPublish = jest.fn()

// One fake document, driven by the test: `get({source:'cache'})` answers `cachedDoc`, and
// `emitSnapshot` plays the SDK raising a new version of it to the listener.
let cachedDoc
let cacheReadError
let snapshotListeners
let snapshotErrorHandlers
let listenerUnsubscribes
let onSnapshotError

const buildDocRef = () => ({
    get: async options => {
        expect(options).toEqual({ source: 'cache' })
        if (cacheReadError) throw cacheReadError
        return cachedDoc
    },
    onSnapshot: (options, handler, errorHandler) => {
        if (onSnapshotError) throw onSnapshotError
        expect(options).toEqual({ includeMetadataChanges: true })
        const unsubscribe = jest.fn()
        snapshotListeners.push(handler)
        snapshotErrorHandlers.push(errorHandler)
        listenerUnsubscribes.push(unsubscribe)
        return unsubscribe
    },
})

const docPaths = []

jest.mock('../firestore', () => ({
    getDb: () => ({
        doc: path => {
            docPaths.push(path)
            return buildDocRef()
        },
    }),
}))

import {
    SETTLEMENT_WINDOW_TIMEOUT_MS,
    listsCanSeeTaskThemselves,
    settleOptimisticTaskRow,
    stopAllOptimisticTaskSettlements,
} from './optimisticTaskSettlement'

const PROJECT_ID = 'project-1'
const TASK_ID = 'task-1'
const TODAY = 1_700_000_000_000
const TOMORROW = TODAY + 24 * 60 * 60 * 1000

const rawTask = (overrides = {}) => ({
    name: 'buy milk',
    inDone: false,
    currentReviewerId: 'user-1',
    isPublicFor: [0],
    dueDate: TODAY,
    ...overrides,
})

/** A local-only version of the document: the SDK's own latency compensation. */
const localSnapshot = data => ({
    exists: !!data,
    data: () => data,
    metadata: { fromCache: true, hasPendingWrites: true },
})

/** The document as the server holds it, with nothing of ours still unacknowledged. */
const serverSnapshot = data => ({
    exists: !!data,
    data: () => data,
    metadata: { fromCache: false, hasPendingWrites: false },
})

const asCacheSnapshot = data => ({ exists: !!data, data: () => data })

/** Plays a new version of the document to the settlement's listener. */
const emitSnapshot = snapshot => snapshotListeners.forEach(handler => handler(snapshot))

const publishedDocuments = () => mockPublish.mock.calls.map(([, , taskData]) => taskData)

describe('AT-2500 the settlement window of a just-created task', () => {
    beforeEach(() => {
        mockPublish.mockClear()
        mockSubscriberCounts.clear()
        mockSubscriberCounts.set(PROJECT_ID, 1)
        snapshotListeners = []
        snapshotErrorHandlers = []
        listenerUnsubscribes = []
        docPaths.length = 0
        cachedDoc = asCacheSnapshot(rawTask())
        cacheReadError = null
        onSnapshotError = null
    })

    afterEach(() => {
        stopAllOptimisticTaskSettlements()
        jest.useRealTimers()
    })

    it('publishes the verdict the local cache can already give at the ack', async () => {
        // Unchanged from the first follow-up, and still what answers the common case: a postpone
        // made BEFORE the write was acknowledged is already in the cached document.
        cachedDoc = asCacheSnapshot(rawTask({ dueDate: TOMORROW }))

        await settleOptimisticTaskRow(PROJECT_ID, TASK_ID)

        expect(mockPublish).toHaveBeenCalledTimes(1)
        expect(mockPublish).toHaveBeenCalledWith(PROJECT_ID, TASK_ID, rawTask({ dueDate: TOMORROW }))
        expect(docPaths[0]).toBe(`items/${PROJECT_ID}/tasks/${TASK_ID}`)
    })

    it('keeps watching, so a postpone made AFTER the ack still reaches the lists', async () => {
        // THE REGRESSION. Production order on the reporting account: ack at ~+0.3s, postpone at
        // +2.5s, access projection at +10s. With one publication at the ack, the postpone is seen
        // by nobody and the create-time row stays in today's list until the watcher restarts.
        await settleOptimisticTaskRow(PROJECT_ID, TASK_ID)
        expect(publishedDocuments()).toEqual([rawTask()])

        emitSnapshot(localSnapshot(rawTask({ dueDate: TOMORROW, timesPostponed: 1 })))

        expect(publishedDocuments()).toEqual([rawTask(), rawTask({ dueDate: TOMORROW, timesPostponed: 1 })])
    })

    it('goes on watching after the projection has landed but the postpone is still unacknowledged', async () => {
        // `hasPendingWrites` is exactly the postpone still in the mutation queue. Treating a
        // projection-carrying snapshot as final regardless of it would close the window on the one
        // client that still has something to say about the document.
        await settleOptimisticTaskRow(PROJECT_ID, TASK_ID)

        emitSnapshot({
            exists: true,
            data: () => rawTask({ readerIds: ['user-1'] }),
            metadata: { fromCache: false, hasPendingWrites: true },
        })
        expect(listenerUnsubscribes[0]).not.toHaveBeenCalled()

        emitSnapshot(serverSnapshot(rawTask({ dueDate: TOMORROW, readerIds: ['user-1'] })))
        expect(publishedDocuments()[publishedDocuments().length - 1]).toEqual(
            rawTask({ dueDate: TOMORROW, readerIds: ['user-1'] })
        )
    })

    it('does NOT close the window at the create’s own ack', async () => {
        // The document is server-confirmed within milliseconds of the create, long before
        // `onCreateTask` writes the projection. Stopping there is precisely where the defect lives:
        // the lists still cannot see the task, so they still need the verdicts that follow.
        await settleOptimisticTaskRow(PROJECT_ID, TASK_ID)

        emitSnapshot(serverSnapshot(rawTask()))

        expect(listenerUnsubscribes[0]).not.toHaveBeenCalled()

        emitSnapshot(localSnapshot(rawTask({ dueDate: TOMORROW })))
        expect(publishedDocuments()).toContainEqual(rawTask({ dueDate: TOMORROW }))
    })

    it('closes the window once the lists can see the task through their own queries', async () => {
        // Server-confirmed, nothing of ours pending, and the projection the queries filter on is
        // in place. From here Firestore reports every change to the lists itself.
        await settleOptimisticTaskRow(PROJECT_ID, TASK_ID)

        emitSnapshot(serverSnapshot(rawTask({ readerIds: ['user-1'] })))

        expect(listenerUnsubscribes[0]).toHaveBeenCalledTimes(1)

        const publicationsBefore = mockPublish.mock.calls.length
        emitSnapshot(serverSnapshot(rawTask({ dueDate: TOMORROW, readerIds: ['user-1'] })))
        expect(mockPublish.mock.calls.length).toBe(publicationsBefore)
    })

    it('publishes only when the document actually changed', async () => {
        // An ordinary create yields the same document several times over - the cache read, the
        // listener's first cached snapshot, then the metadata-only move to server-confirmed. Each
        // redundant publication would make every list recompute for nothing.
        await settleOptimisticTaskRow(PROJECT_ID, TASK_ID)
        emitSnapshot(localSnapshot(rawTask()))
        emitSnapshot({ exists: true, data: () => rawTask(), metadata: { fromCache: false, hasPendingWrites: false } })

        expect(mockPublish).toHaveBeenCalledTimes(1)
    })

    it('never opens a window when no list is holding an optimistic row', async () => {
        // Nothing subscribed to the create, so nothing anywhere is showing a row to reconcile -
        // and a document listener would be a billed read spent on nobody.
        mockSubscriberCounts.clear()

        await settleOptimisticTaskRow(PROJECT_ID, TASK_ID)

        expect(mockPublish).not.toHaveBeenCalled()
        expect(snapshotListeners).toHaveLength(0)
        expect(docPaths).toHaveLength(0)
    })

    it('reports no verdict, rather than a removal, when the cache cannot be read', async () => {
        // `null` is read by every subscriber as "cannot say", which leaves the row standing. A
        // stale row corrects itself; a wrongly removed one looks like the task was lost.
        cacheReadError = new Error('cache unavailable')

        await settleOptimisticTaskRow(PROJECT_ID, TASK_ID)

        expect(mockPublish).toHaveBeenCalledWith(PROJECT_ID, TASK_ID, null)
    })

    it('degrades to the ack verdict alone when the document cannot be watched', async () => {
        // Exactly the behaviour before this module existed - never worse than that.
        onSnapshotError = new Error('listen refused')

        await expect(settleOptimisticTaskRow(PROJECT_ID, TASK_ID)).resolves.toBeUndefined()

        expect(publishedDocuments()).toEqual([rawTask()])
    })

    it('never rejects, whatever the client does', async () => {
        // The create has already succeeded by the time this runs; nothing about it may depend on
        // the settlement window, and an unhandled rejection here would surface as a failed create.
        cacheReadError = new Error('boom')
        onSnapshotError = new Error('boom')

        await expect(settleOptimisticTaskRow(PROJECT_ID, TASK_ID)).resolves.toBeUndefined()
    })

    it('closes the window at the timeout, so a projection that never lands cannot leak a listener', async () => {
        jest.useFakeTimers()

        await settleOptimisticTaskRow(PROJECT_ID, TASK_ID, { timeoutMs: 1000 })
        expect(listenerUnsubscribes[0]).not.toHaveBeenCalled()

        jest.advanceTimersByTime(1000)

        expect(listenerUnsubscribes[0]).toHaveBeenCalledTimes(1)
        const publicationsBefore = mockPublish.mock.calls.length
        emitSnapshot(localSnapshot(rawTask({ dueDate: TOMORROW })))
        expect(mockPublish.mock.calls.length).toBe(publicationsBefore)
    })

    it('is bounded generously enough to outlast a slow access projection', () => {
        // The reporting account's own create took ten seconds to have its projection written; a
        // window shorter than that would expire before the lists could ever see the task.
        expect(SETTLEMENT_WINDOW_TIMEOUT_MS).toBeGreaterThanOrEqual(20000)
    })

    it('restarts the window for a re-created id instead of doubling it', async () => {
        // Cloud and undo paths can re-run a create for the same id.
        await settleOptimisticTaskRow(PROJECT_ID, TASK_ID)
        await settleOptimisticTaskRow(PROJECT_ID, TASK_ID)

        expect(listenerUnsubscribes[0]).toHaveBeenCalledTimes(1)
        expect(listenerUnsubscribes[1]).not.toHaveBeenCalled()
    })

    it('ignores an incomplete call', async () => {
        await settleOptimisticTaskRow(PROJECT_ID, '')
        await settleOptimisticTaskRow('', TASK_ID)

        expect(mockPublish).not.toHaveBeenCalled()
    })

    it('closes the window quietly when the listen itself fails', async () => {
        // A `permission-denied` here is very often a rules-EVALUATION error thrown by a transport
        // restart rather than a denial (AT-2484). Either way there is no verdict to give, and an
        // `onSnapshot` with no error handler would raise it as an unhandled error in the app.
        await settleOptimisticTaskRow(PROJECT_ID, TASK_ID)
        const publicationsBefore = mockPublish.mock.calls.length

        expect(typeof snapshotErrorHandlers[0]).toBe('function')
        expect(() => snapshotErrorHandlers[0](new Error('Missing or insufficient permissions'))).not.toThrow()

        expect(listenerUnsubscribes[0]).toHaveBeenCalledTimes(1)
        expect(mockPublish.mock.calls.length).toBe(publicationsBefore)
    })

    it('stops publishing for a task whose document was deleted', async () => {
        await settleOptimisticTaskRow(PROJECT_ID, TASK_ID)

        emitSnapshot({ exists: false, data: () => null, metadata: { fromCache: false, hasPendingWrites: false } })

        // A rolled-back create is removed by its own publication; this one says "no verdict".
        expect(publishedDocuments()).toEqual([rawTask(), null])
    })
})

describe('AT-2500 listsCanSeeTaskThemselves', () => {
    const withProjection = { readerIds: ['user-1'] }

    it('is true only for a server-confirmed document carrying the access projection', () => {
        expect(
            listsCanSeeTaskThemselves({ metadata: { fromCache: false, hasPendingWrites: false } }, withProjection)
        ).toBe(true)
    })

    it('is false while the snapshot is still local', () => {
        expect(
            listsCanSeeTaskThemselves({ metadata: { fromCache: true, hasPendingWrites: false } }, withProjection)
        ).toBe(false)
    })

    it('is false while this client still holds an unacknowledged write', () => {
        expect(
            listsCanSeeTaskThemselves({ metadata: { fromCache: false, hasPendingWrites: true } }, withProjection)
        ).toBe(false)
    })

    it('is false before the projection exists, which is the whole point of the window', () => {
        // `readerIds` is the field every one of these queries filters on, and the access rules
        // forbid a client to write it - so until the server has, the task matches nothing anywhere.
        expect(listsCanSeeTaskThemselves({ metadata: { fromCache: false, hasPendingWrites: false } }, {})).toBe(false)
        expect(
            listsCanSeeTaskThemselves({ metadata: { fromCache: false, hasPendingWrites: false } }, { readerIds: [] })
        ).toBe(false)
    })

    it('is false for a snapshot with no metadata at all', () => {
        expect(listsCanSeeTaskThemselves({}, withProjection)).toBe(false)
        expect(listsCanSeeTaskThemselves(null, withProjection)).toBe(false)
    })
})
