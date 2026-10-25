const mockState = {
    loggedUser: { uid: 'u1', isAnonymous: false },
    sidebarNumbers: { loading: true },
}
const mockSnapshotCallbacks = []
const mockUnsubscribe = jest.fn()
const mockQuery = {
    where: jest.fn(() => mockQuery),
    onSnapshot: jest.fn(callback => {
        mockSnapshotCallbacks.push(callback)
        return mockUnsubscribe
    }),
}

jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: {
        getState: jest.fn(),
        dispatch: jest.fn(),
    },
}))

jest.mock('../firestore', () => ({
    getDb: jest.fn(() => ({ collection: jest.fn(() => mockQuery) })),
    globalWatcherUnsub: {},
    mapTaskData: jest.fn((id, data) => ({ id, ...data })),
}))

import { globalWatcherUnsub } from '../firestore'
import mockStore from '../../../redux/store'
import { unwatchSidebarTasksAmount, watchSidebarTasksAmount } from './taskNumbers'

const doc = (id, data) => ({ id, data: () => data })
const snapshot = docs => ({
    docs,
    docChanges: () => docs.map(taskDoc => ({ type: 'added', doc: taskDoc })),
})

describe('sidebar task-number watchers', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockSnapshotCallbacks.length = 0
        mockState.sidebarNumbers = { loading: true }
        mockStore.getState.mockImplementation(() => mockState)
        mockStore.dispatch.mockImplementation(action => {
            if (action.type === 'Set sidebar numbers') mockState.sidebarNumbers = action.numbers
        })
        Object.keys(globalWatcherUnsub).forEach(key => delete globalWatcherUnsub[key])
    })

    it('recalculates workstream membership without resubscribing or clearing confirmed counts', () => {
        const controller = watchSidebarTasksAmount(
            ['p1'],
            [[{ wsId: 'ws@1', userIds: ['u1'] }]],
            ['regular-p1'],
            ['observed-p1']
        )

        mockSnapshotCallbacks[0](
            snapshot([
                doc('direct', { userId: 'u1', currentReviewerId: 'u1' }),
                doc('workstream', { userId: 'ws@1', currentReviewerId: 'ws@1' }),
            ])
        )
        mockSnapshotCallbacks[1](snapshot([]))

        expect(mockState.sidebarNumbers.p1.u1).toBe(2)
        expect(mockQuery.onSnapshot).toHaveBeenCalledTimes(2)

        controller.updateWorkstreamsUsersIdsByProject([[{ wsId: 'ws@1', userIds: ['u1', 'u2'] }]])

        expect(mockQuery.onSnapshot).toHaveBeenCalledTimes(2)
        expect(mockUnsubscribe).not.toHaveBeenCalled()
        expect(mockState.sidebarNumbers).toEqual({ p1: { u1: 2, u2: 1, 'ws@1': 1 } })
        expect(mockStore.dispatch).not.toHaveBeenCalledWith({
            type: 'Set sidebar numbers',
            numbers: { loading: false },
        })

        unwatchSidebarTasksAmount(['regular-p1', 'observed-p1'], { clearNumbers: false })
        expect(mockUnsubscribe).toHaveBeenCalledTimes(2)
        expect(mockState.sidebarNumbers.p1.u1).toBe(2)
    })
})
