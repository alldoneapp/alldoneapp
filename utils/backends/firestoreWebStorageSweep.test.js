/** @jest-environment jsdom */

import {
    FIRESTORE_CLIENT_MAX_AGE_MS,
    getFirestorePersistenceKey,
    planFirestoreWebStorageSweep,
    sweepFirestoreWebStorage,
} from './firestoreWebStorageSweep'

const PK = 'firestore/[DEFAULT]/alldonealeph/'
const NOW = 1790748400000
const OLD = NOW - FIRESTORE_CLIENT_MAX_AGE_MS - 1
const RECENT = NOW - 1000

const client = (id, activeTargetIds, updateTimeMs) => [
    `firestore_clients_${PK}_${id}`,
    JSON.stringify({ activeTargetIds, updateTimeMs }),
]
const target = (id, updateTimeMs, state = 'current') => [
    `firestore_targets_${PK}_${id}`,
    JSON.stringify({ state, updateTimeMs }),
]
const mutation = (batchId, updateTimeMs, state = 'acknowledged') => [
    `firestore_mutations_${PK}_${batchId}_user-1`,
    JSON.stringify({ state, updateTimeMs }),
]

const createStorage = entries => {
    const map = new Map(entries)
    return {
        map,
        get length() {
            return map.size
        },
        key: index => [...map.keys()][index] ?? null,
        getItem: key => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => map.set(key, String(value)),
        removeItem: key => map.delete(key),
    }
}

describe('firestoreWebStorageSweep', () => {
    it('derives the SDK persistence key from the compat db', () => {
        expect(getFirestorePersistenceKey({ app: { name: '[DEFAULT]', options: { projectId: 'alldonealeph' } } })).toBe(
            PK
        )
        expect(getFirestorePersistenceKey({})).toBeNull()
    })

    it('removes orphaned targets, dead clients and settled mutations', () => {
        const entries = [
            client('dead', [7], OLD),
            target(7, OLD),
            target(8, OLD, 'rejected'),
            mutation(20, OLD),
            mutation(21, OLD, 'pending'),
        ]
        const removals = planFirestoreWebStorageSweep({
            entries,
            persistenceKey: PK,
            liveClientIds: new Set(),
            now: NOW,
        })
        expect(removals.sort()).toEqual(entries.map(([key]) => key).sort())
    })

    it('never removes a live client or the queries it still listens to, however old their entries are', () => {
        // An idle live tab heartbeats in IndexedDB but does not rewrite its localStorage entry.
        const live = client('live', [1, 2], OLD)
        const entries = [live, target(1, OLD), target(2, OLD), target(3, OLD)]
        const removals = planFirestoreWebStorageSweep({
            entries,
            persistenceKey: PK,
            liveClientIds: new Set(['live']),
            now: NOW,
        })
        expect(removals).toEqual([target(3, OLD)[0]])
    })

    it('keeps entries written within the client age, e.g. by a tab that is still starting', () => {
        const entries = [client('starting', [9], RECENT), target(9, OLD), target(10, RECENT), mutation(30, RECENT)]
        expect(
            planFirestoreWebStorageSweep({ entries, persistenceKey: PK, liveClientIds: new Set(), now: NOW })
        ).toEqual([])
    })

    it('leaves other projects and the SDK’s shared entries alone', () => {
        const entries = [
            ['firestore_targets_firestore/[DEFAULT]/alldonestaging/_5', JSON.stringify({ updateTimeMs: OLD })],
            [`firestore_online_state_${PK}`, JSON.stringify({ clientId: 'x', onlineState: 'Online' })],
            [`firestore_zombie_${PK}_dead`, 'dead'],
            ['alldone.taskWriteDiagnostics.v1', '[]'],
        ]
        expect(
            planFirestoreWebStorageSweep({ entries, persistenceKey: PK, liveClientIds: new Set(), now: NOW })
        ).toEqual([])
    })

    it('does nothing when Firestore’s client list cannot be read', async () => {
        const storage = createStorage([target(1, OLD)])
        const result = await sweepFirestoreWebStorage({
            storage,
            persistenceKey: PK,
            readLiveClientIds: async () => null,
            now: () => NOW,
        })
        expect(result.skipped).toBe('client_metadata_unavailable')
        expect(storage.map.size).toBe(1)
    })

    it('removes in chunks, yielding between them, and skips a key refreshed meanwhile', async () => {
        const entries = Array.from({ length: 5 }, (_, index) => target(index, OLD))
        const storage = createStorage([...entries, ['alldone.other', 'x']])
        const yieldToBrowser = jest.fn(async () => {
            // A live tab re-listens to target 4 between chunks.
            storage.setItem(target(4, NOW)[0], target(4, NOW)[1])
        })
        const record = jest.fn()
        const result = await sweepFirestoreWebStorage({
            storage,
            persistenceKey: PK,
            readLiveClientIds: async () => new Set(),
            now: () => NOW,
            chunkSize: 2,
            yieldToBrowser,
            record,
        })
        expect(yieldToBrowser).toHaveBeenCalledTimes(2)
        expect(result.removed).toBe(4)
        expect([...storage.map.keys()].sort()).toEqual(['alldone.other', target(4, NOW)[0]].sort())
        expect(record).toHaveBeenCalledWith(
            'firestore_webstorage_sweep',
            'complete',
            expect.any(Number),
            expect.objectContaining({ count: 4, candidate_count: 5 }),
            { sampleRate: 1 }
        )
    })
})
