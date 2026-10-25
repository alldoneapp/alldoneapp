const mockState = { loggedUser: { uid: 'u1' } }
const mockDb = {}

jest.mock('../firestore', () => ({ getDb: () => mockDb }))
jest.mock('../../../redux/store', () => ({ __esModule: true, default: { getState: () => mockState } }))
jest.mock('firebase/compat/app', () => {
    class FieldPath {
        constructor(...segments) {
            this.segments = segments
        }
    }
    return { __esModule: true, default: { firestore: { FieldPath, FieldValue: { delete: () => '__DELETE__' } } } }
})

import {
    queueSummaryChatNotificationWrite,
    reconcileProject,
    resetActivitySummaryForTests,
    SUMMARY_FIRST_SNAPSHOT_TIMEOUT_MS,
    subscribeActivitySummary,
} from './activityUnreadSummary'

const SUMMARY = 'users/u1/private/activityUnreadSummary'

const setupDb = (sources = {}) => {
    const docs = new Map(Object.entries(sources))
    const listeners = []
    const transactionWrites = []
    Object.assign(mockDb, {
        doc: path => ({
            path,
            onSnapshot: (next, error) => {
                const listener = { path, next, error, closed: false }
                listeners.push(listener)
                return () => (listener.closed = true)
            },
        }),
        collection: path => ({
            get: async () => ({
                docs: [...docs.keys()]
                    .filter(key => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1)
                    .map(key => ({ id: key.split('/').pop() })),
            }),
        }),
        runTransaction: async work =>
            work({
                get: async ref => ({ exists: docs.has(ref.path), data: () => docs.get(ref.path) }),
                set: (ref, value, options) => transactionWrites.push({ path: ref.path, value, options }),
            }),
    })
    const summaryListener = () => listeners.find(listener => listener.path === SUMMARY && !listener.closed)
    const deliverSummary = data => summaryListener().next({ data: () => data })
    return { docs, listeners, transactionWrites, summaryListener, deliverSummary }
}

const legacy = () => {
    const state = { subscribed: 0, unsubscribed: 0, deliver: null }
    state.subscribe = deliver => {
        state.subscribed++
        state.deliver = deliver
        return () => state.unsubscribed++
    }
    return state
}

describe('activity unread summary registry', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        resetActivitySummaryForTests()
    })
    afterEach(() => {
        resetActivitySummaryForTests()
        jest.useRealTimers()
    })

    it('keeps the direct listener until the server mirror exists, then serves from the summary', () => {
        const { deliverSummary } = setupDb()
        const direct = legacy()
        const onData = jest.fn()
        subscribeActivitySummary({
            userId: 'u1',
            projectId: 'p1',
            kind: 'feeds',
            tab: 'all',
            onData,
            legacySubscribe: direct.subscribe,
        })

        // No snapshot yet: nothing opened, nothing guessed.
        expect(direct.subscribed).toBe(0)

        // A summary no trigger has written (no mirrorVersion) is not trusted.
        deliverSummary({ feeds: { p1: { all: { tasks: { t1: 1 } } } } })
        expect(direct.subscribed).toBe(1)
        direct.deliver({ tasks: { t1: 1 } })
        expect(onData).toHaveBeenLastCalledWith({ tasks: { t1: 1 } })

        deliverSummary({ mirrorVersion: 1, bootstrapped: { p1: true }, feeds: { p1: { all: { tasks: { t1: 1 } } } } })
        expect(direct.unsubscribed).toBe(1)
        // Same value from the new source: no duplicate delivery.
        expect(onData).toHaveBeenCalledTimes(1)

        deliverSummary({ mirrorVersion: 1, bootstrapped: { p1: true }, feeds: { p1: {} } })
        expect(onData).toHaveBeenLastCalledWith(null)
    })

    it('serves chat notifications with their comment ids, like the direct listener', () => {
        const { deliverSummary } = setupDb()
        const onData = jest.fn()
        subscribeActivitySummary({
            userId: 'u1',
            projectId: 'p1',
            kind: 'chats',
            onData,
            legacySubscribe: legacy().subscribe,
        })

        deliverSummary({
            mirrorVersion: 1,
            bootstrapped: { p1: true },
            chats: { p1: { c2: { chatId: 'b' }, c1: { chatId: 'a' } } },
        })

        expect(onData).toHaveBeenCalledWith([
            { chatId: 'a', commentId: 'c1' },
            { chatId: 'b', commentId: 'c2' },
        ])
    })

    it('copies a project in once before trusting it, re-reading every source in the transaction', async () => {
        const { deliverSummary, transactionWrites } = setupDb({
            'feedsCount/p1/u1/followed': { tasks: { t1: 1 } },
            'chatNotifications/p1/u1/c1': { chatId: 'a' },
            [SUMMARY]: { mirrorVersion: 1, chats: { p1: { gone: { chatId: 'x' } } } },
        })
        const direct = legacy()
        subscribeActivitySummary({
            userId: 'u1',
            projectId: 'p1',
            kind: 'chats',
            onData: jest.fn(),
            legacySubscribe: direct.subscribe,
        })

        deliverSummary({ mirrorVersion: 1, chats: { p1: { gone: { chatId: 'x' } } } })
        // Not bootstrapped yet: the direct listener serves the badge meanwhile.
        expect(direct.subscribed).toBe(1)

        await reconcileProject('u1', 'p1')

        expect(transactionWrites).toHaveLength(1)
        const [{ value, options }] = transactionWrites
        expect(value.bootstrapped).toEqual({ p1: true })
        expect(value.feeds.p1).toEqual({ followed: { tasks: { t1: 1 } } })
        // A summary entry whose source is gone is removed; a missing one is added.
        expect(value.chats.p1).toEqual({ c1: { chatId: 'a' }, gone: '__DELETE__' })
        expect(options.mergeFields.map(path => path.segments.join('.')).sort()).toEqual([
            'bootstrapped.p1',
            'chats.p1.c1',
            'chats.p1.gone',
            'feeds.p1.followed',
        ])
    })

    it('writes nothing when a reconcile finds the summary already matching', async () => {
        const summary = { mirrorVersion: 1, bootstrapped: { p1: true }, chats: { p1: { c1: { chatId: 'a' } } } }
        const { deliverSummary, transactionWrites } = setupDb({
            'chatNotifications/p1/u1/c1': { chatId: 'a' },
            [SUMMARY]: summary,
        })
        subscribeActivitySummary({
            userId: 'u1',
            projectId: 'p1',
            kind: 'chats',
            onData: jest.fn(),
            legacySubscribe: legacy().subscribe,
        })
        deliverSummary(summary)

        await reconcileProject('u1', 'p1')

        expect(transactionWrites).toHaveLength(0)
    })

    it('falls back to the direct listener when the summary never answers', () => {
        setupDb()
        const direct = legacy()
        subscribeActivitySummary({
            userId: 'u1',
            projectId: 'p1',
            kind: 'chats',
            onData: jest.fn(),
            legacySubscribe: direct.subscribe,
        })

        jest.advanceTimersByTime(SUMMARY_FIRST_SNAPSHOT_TIMEOUT_MS)

        expect(direct.subscribed).toBe(1)
    })

    it('uses the direct listener for anyone but the signed-in user, and closes the summary with its last consumer', () => {
        const { summaryListener } = setupDb()
        const other = legacy()
        const unsubscribeOther = subscribeActivitySummary({
            userId: 'someone-else',
            projectId: 'p1',
            kind: 'chats',
            onData: jest.fn(),
            legacySubscribe: other.subscribe,
        })
        expect(other.subscribed).toBe(1)
        expect(summaryListener()).toBeUndefined()
        unsubscribeOther()
        expect(other.unsubscribed).toBe(1)

        const unsubscribe = subscribeActivitySummary({
            userId: 'u1',
            projectId: 'p1',
            kind: 'chats',
            onData: jest.fn(),
            legacySubscribe: legacy().subscribe,
        })
        const listener = summaryListener()
        unsubscribe()
        expect(listener.closed).toBe(true)
    })

    it('never queues a write to another user’s summary, which the rules would reject with the whole batch', () => {
        setupDb()
        const batch = { set: jest.fn() }
        expect(queueSummaryChatNotificationWrite(batch, 'someone-else', 'p1', 'c1', null)).toBe(false)
        expect(queueSummaryChatNotificationWrite(batch, 'u1', 'p1', 'c1', null)).toBe(true)
        expect(batch.set).toHaveBeenCalledTimes(1)
        expect(batch.set.mock.calls[0][0].path).toBe(SUMMARY)
    })
})
