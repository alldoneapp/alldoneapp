import { createCachedSnapshotGate, CACHED_SNAPSHOT_GRACE_MS } from './cachedSnapshotGate'

const makeSnapshot = ({ fromCache, docs = [], hasPendingWrites = false } = {}) => ({
    docs,
    size: docs.length,
    empty: docs.length === 0,
    forEach: callback => docs.forEach(callback),
    docChanges: () => [],
    metadata: { fromCache, hasPendingWrites },
})

describe('createCachedSnapshotGate', () => {
    beforeEach(() => {
        jest.useFakeTimers()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    const createHarness = ({ isOffline = () => false } = {}) => {
        const delivered = []
        const gate = createCachedSnapshotGate(() => handler, { isOffline })
        function handler(querySnapshot) {
            if (gate.shouldBuffer(querySnapshot)) return
            delivered.push(querySnapshot)
        }
        return { gate, handler, delivered }
    }

    it('delivers server snapshots immediately (unchanged online behavior)', () => {
        const { handler, delivered } = createHarness()
        handler(makeSnapshot({ fromCache: false }))
        expect(delivered).toHaveLength(1)
    })

    it('buffers cached snapshots while online (unchanged online behavior)', () => {
        const { handler, delivered } = createHarness()
        handler(makeSnapshot({ fromCache: true }))
        expect(delivered).toHaveLength(0)
    })

    it('delivers cached snapshots immediately while offline', () => {
        const { handler, delivered } = createHarness({ isOffline: () => true })
        handler(makeSnapshot({ fromCache: true }))
        expect(delivered).toHaveLength(1)
    })

    it('flushes after the grace period when only cached snapshots arrive', () => {
        const docs = [{ id: 'a' }]
        const { handler, delivered } = createHarness()
        handler(makeSnapshot({ fromCache: true, docs }))
        expect(delivered).toHaveLength(0)

        jest.advanceTimersByTime(CACHED_SNAPSHOT_GRACE_MS)
        expect(delivered).toHaveLength(1)
        // The flush snapshot delegates the result set but reports no NEW changes —
        // the real changes already sit in the watcher's own buffer.
        expect(delivered[0].docs).toBe(docs)
        expect(delivered[0].docChanges()).toEqual([])
        expect(delivered[0].metadata.fromCache).toBe(true)
        expect(delivered[0].metadata.isGateFlush).toBe(true)
    })

    it('does not re-arm the timer from its own flush', () => {
        const { handler, delivered } = createHarness()
        handler(makeSnapshot({ fromCache: true }))
        jest.advanceTimersByTime(CACHED_SNAPSHOT_GRACE_MS * 3)
        expect(delivered).toHaveLength(1)
    })

    it('a server snapshot cancels the pending flush and resets the gate', () => {
        const { handler, delivered } = createHarness()
        handler(makeSnapshot({ fromCache: true }))
        handler(makeSnapshot({ fromCache: false }))
        jest.advanceTimersByTime(CACHED_SNAPSHOT_GRACE_MS * 2)

        // Only the server snapshot was delivered; no late cache flush followed.
        expect(delivered).toHaveLength(1)
        expect(delivered[0].metadata.fromCache).toBe(false)
    })

    it('keeps one timer across a burst of cached snapshots and flushes the latest', () => {
        const firstDocs = [{ id: 'a' }]
        const secondDocs = [{ id: 'a' }, { id: 'b' }]
        const { handler, delivered } = createHarness()
        handler(makeSnapshot({ fromCache: true, docs: firstDocs }))
        jest.advanceTimersByTime(CACHED_SNAPSHOT_GRACE_MS - 1)
        handler(makeSnapshot({ fromCache: true, docs: secondDocs }))
        jest.advanceTimersByTime(1)

        expect(delivered).toHaveLength(1)
        expect(delivered[0].docs).toBe(secondDocs)
    })

    it('re-arms for a new cached period after a flush', () => {
        const { handler, delivered } = createHarness()
        handler(makeSnapshot({ fromCache: true }))
        jest.advanceTimersByTime(CACHED_SNAPSHOT_GRACE_MS)
        expect(delivered).toHaveLength(1)

        handler(makeSnapshot({ fromCache: true }))
        expect(delivered).toHaveLength(1)
        jest.advanceTimersByTime(CACHED_SNAPSHOT_GRACE_MS)
        expect(delivered).toHaveLength(2)
    })

    it('a wrapped unsubscribe kills the pending flush with the subscription', () => {
        const unsubscribe = jest.fn()
        const { gate, handler, delivered } = createHarness()
        const wrapped = gate.wrapUnsubscribe(unsubscribe)

        handler(makeSnapshot({ fromCache: true }))
        wrapped()
        jest.advanceTimersByTime(CACHED_SNAPSHOT_GRACE_MS)

        expect(unsubscribe).toHaveBeenCalledTimes(1)
        expect(delivered).toHaveLength(0)
    })

    it('going offline mid-grace delivers on the next snapshot without waiting', () => {
        let offline = false
        const { handler, delivered } = createHarness({ isOffline: () => offline })
        handler(makeSnapshot({ fromCache: true }))
        offline = true
        handler(makeSnapshot({ fromCache: true }))
        expect(delivered).toHaveLength(1)
        jest.advanceTimersByTime(CACHED_SNAPSHOT_GRACE_MS * 2)
        expect(delivered).toHaveLength(1)
    })
})
