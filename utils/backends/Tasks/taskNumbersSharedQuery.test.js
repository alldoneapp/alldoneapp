const mockState = {
    loggedUser: { uid: 'u1', isAnonymous: false },
    sidebarNumbers: { loading: true },
}
const mockQueries = []

// Every query records its clause chain; Firestore only shares a server target between queries whose
// chains are identical, so the chain IS what these tests pin.
const mockMakeQuery = path => {
    const query = {
        path,
        clauses: [],
        where: jest.fn((...clause) => {
            const next = mockMakeQuery(path)
            next.clauses = [...query.clauses, ['where', ...clause]]
            return next
        }),
        orderBy: jest.fn((...clause) => {
            const next = mockMakeQuery(path)
            next.clauses = [...query.clauses, ['orderBy', ...clause]]
            return next
        }),
        onSnapshot: jest.fn(callback => {
            const unsubscribe = jest.fn()
            mockQueries.push({ path, clauses: query.clauses, callback, unsubscribe })
            return unsubscribe
        }),
    }
    return query
}

jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: { getState: jest.fn(), dispatch: jest.fn() },
}))

jest.mock('../firestore', () => ({
    getDb: jest.fn(() => ({ collection: path => mockMakeQuery(path) })),
    globalWatcherUnsub: {},
    mapTaskData: jest.fn((id, data) => ({ id, ...data })),
}))

import { globalWatcherUnsub } from '../firestore'
import mockStore from '../../../redux/store'
import {
    watchDoneTasksAmount,
    watchOpenTasksAmount,
    watchSidebarTasksAmount,
    watchUserWorkstreamsOpenTasksAmount,
} from './taskNumbers'
import { watchDoneTasks } from './myDayDoneTasks'

const doc = (id, data) => ({ id, data: () => data })
const snapshot = docs => ({ docs, docChanges: () => docs.map(taskDoc => ({ type: 'added', doc: taskDoc })) })
const chainOf = query => JSON.stringify([query.path, query.clauses])

describe('today task counters share one Firestore query per project', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockQueries.length = 0
        mockStore.getState.mockImplementation(() => mockState)
        Object.keys(globalWatcherUnsub).forEach(key => delete globalWatcherUnsub[key])
    })

    it('builds the sidebar, open-amount and workstream-amount queries identically', () => {
        watchSidebarTasksAmount(['p1'], [[]], ['sidebar-p1'], ['observed-p1'])
        const sidebarQuery = mockQueries[0]

        watchOpenTasksAmount(['p1'], 'u1', false, false, { total: 0 }, ['open-p1'], jest.fn())
        watchUserWorkstreamsOpenTasksAmount(['p1'], { p1: ['ws@2'] }, false, false, { total: 0 }, ['ws-p1'], jest.fn())

        const openQuery = mockQueries[mockQueries.length - 2]
        const workstreamQuery = mockQueries[mockQueries.length - 1]
        expect(chainOf(openQuery)).toBe(chainOf(sidebarQuery))
        expect(chainOf(workstreamQuery)).toBe(chainOf(sidebarQuery))
        // One listener for all workstreams of the project, not one per workstream.
        expect(mockQueries.filter(query => query === workstreamQuery)).toHaveLength(1)
    })

    it('counts only the tasks each counter is about', () => {
        const amounts = { total: 0 }
        const settled = jest.fn()
        watchOpenTasksAmount(['p1'], 'u1', false, false, amounts, ['open-p1'], settled)
        watchUserWorkstreamsOpenTasksAmount(['p1'], { p1: ['ws@2'] }, false, false, amounts, ['ws-p1'], settled)
        const [openQuery, workstreamQuery] = mockQueries

        const tasks = snapshot([
            doc('mine', { userId: 'u1', currentReviewerId: 'u1' }),
            doc('reviewing', { userId: 'u9', currentReviewerId: 'u1' }),
            doc('someone-else', { userId: 'u9', currentReviewerId: 'u9' }),
            doc('default-ws', { userId: 'ws@default', currentReviewerId: 'ws@default' }),
            doc('ws2', { userId: 'ws@2', currentReviewerId: 'ws@2' }),
            doc('ws2-in-review', { userId: 'ws@2', currentReviewerId: 'u9' }),
        ])
        openQuery.callback(tasks)
        workstreamQuery.callback(tasks)

        expect(amounts.p1.normal).toBe(2)
        expect(amounts.p1.workstreams).toEqual({ 'ws@default': 1, 'ws@2': 1 })
        expect(amounts.total).toBe(4)
        expect(settled.mock.calls.map(([token]) => token)).toEqual(['open-p1', 'ws-p1'])
    })

    it('can unsubscribe every per-workstream listener when counting Later/Someday', () => {
        watchUserWorkstreamsOpenTasksAmount(['p1'], { p1: ['ws@2'] }, true, false, { total: 0 }, ['ws-p1'], jest.fn())
        expect(mockQueries).toHaveLength(2)

        globalWatcherUnsub['ws-p1']()

        mockQueries.forEach(query => expect(query.unsubscribe).toHaveBeenCalledTimes(1))
    })

    it('counts done tasks from the same query as the My Day done list', () => {
        watchDoneTasks('p1', 'u1', 'myday-done-p1')
        watchDoneTasksAmount(['p1'], 'u1', ['done-p1'])
        const [myDayQuery, amountQuery] = mockQueries
        expect(chainOf(amountQuery)).toBe(chainOf(myDayQuery))

        const now = Date.now()
        amountQuery.callback(
            snapshot([
                doc('done', { done: true, parentId: null, completed: now }),
                doc('done-subtask', { done: true, parentId: 'done', completed: now }),
                doc('in-done-parent', { done: false, parentId: 'done', completed: now }),
            ])
        )
        expect(mockStore.dispatch).toHaveBeenCalledWith(expect.objectContaining({ doneTasksAmount: 1 }))
    })
})
