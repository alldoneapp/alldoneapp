const mockUnsubscribeFunctions = []
const mockSnapshotCallbacks = []
const emptySnapshot = { docs: [], forEach: () => {} }

const mockQuery = {
    where: jest.fn(() => mockQuery),
    limit: jest.fn(() => mockQuery),
    orderBy: jest.fn(() => mockQuery),
    get: jest.fn(() => Promise.resolve(emptySnapshot)),
    onSnapshot: jest.fn(callback => {
        const unsubscribe = jest.fn()
        mockUnsubscribeFunctions.push(unsubscribe)
        mockSnapshotCallbacks.push(callback)
        return unsubscribe
    }),
}

jest.mock('../firestore', () => ({
    getDb: () => ({ collection: () => mockQuery }),
    globalWatcherUnsub: {},
    mapGoalData: (id, data) => ({ id, ...data }),
    mapTaskData: (id, data) => ({ id, ...data }),
}))
jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: {
        dispatch: jest.fn(),
        getState: () => ({ loggedUser: { uid: 'logged-user', isAnonymous: false } }),
    },
}))
jest.mock('../../../components/Feeds/Utils/FeedsConstants', () => ({ FEED_PUBLIC_FOR_ALL: 'all' }))
jest.mock('../../../components/Workstreams/WorkstreamHelper', () => ({
    DEFAULT_WORKSTREAM_ID: 'default-workstream',
    isWorkstream: id => String(id).startsWith('ws-board-'),
}))
jest.mock('../../../components/GoalsView/GoalsHelper', () => ({
    DYNAMIC_PERCENT: -1,
    getOwnerId: (projectId, userId) => `${projectId}:${userId}`,
}))
jest.mock('../../../components/TaskListView/Utils/TasksHelper', () => ({
    BACKLOG_DATE_NUMERIC: Number.MAX_SAFE_INTEGER,
}))
jest.mock('./myDayTasks', () => ({
    GOALS_MY_DAY_TYPE: 'goals',
    OBSERVED_TASKS_MY_DAY_TYPE: 'observed',
    TO_ATTEND_TASKS_MY_DAY_TYPE: 'assigned',
    WORKSTREAM_TASKS_MY_DAY_TYPE: 'workstreams',
}))
import { watchIfNeedShowLaterOpenTasksButton, watchOpenTasksShowMoreAvailability } from './tasksShowMoreButton'
import { globalWatcherUnsub as mockGlobalWatcherUnsub } from '../firestore'
import mockStore from '../../../redux/store'

describe('task show-more listener ownership', () => {
    beforeEach(() => {
        mockStore.dispatch.mockClear()
        mockQuery.where.mockClear()
        mockQuery.limit.mockClear()
        mockQuery.orderBy.mockClear()
        mockQuery.get.mockClear()
        mockQuery.onSnapshot.mockClear()
        mockUnsubscribeFunctions.splice(0)
        mockSnapshotCallbacks.splice(0)
        Object.keys(mockGlobalWatcherUnsub).forEach(key => delete mockGlobalWatcherUnsub[key])
    })

    it('shares broad sources while keeping task date queries bounded to one document', () => {
        const unsubscribe = watchOpenTasksShowMoreAvailability({
            projectId: 'project-1',
            userId: 'user-1',
            userWorkstreamIds: ['workstream-a', 'workstream-b'],
            watcherKey: 'availability',
        })

        // 3 assigned + 1 observed + 2 per workstream (including default) + 1 goals.
        // The previous component mounted 17 listeners for this same setup.
        expect(mockQuery.onSnapshot).toHaveBeenCalledTimes(11)
        expect(mockQuery.limit).toHaveBeenCalledTimes(9)

        mockSnapshotCallbacks.forEach(callback => callback(emptySnapshot))
        const actions = mockStore.dispatch.mock.calls.flatMap(([action]) => action)
        expect(actions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ type: 'Add there are later open tasks', thereAreLaterOpenTasks: false }),
                expect.objectContaining({ type: 'Add there are someday open tasks', thereAreSomedayOpenTasks: false }),
                expect.objectContaining({ type: 'Add there are later empty goals', thereAreLaterEmptyGoals: false }),
                expect.objectContaining({
                    type: 'Add there are someday empty goals',
                    thereAreSomedayEmptyGoals: false,
                }),
            ])
        )

        unsubscribe()
        mockUnsubscribeFunctions.forEach(stop => expect(stop).toHaveBeenCalledTimes(1))
        expect(mockGlobalWatcherUnsub.availability).toBeUndefined()
    })

    it('uses one-shot availability reads for All Projects instead of permanent listeners', async () => {
        const unsubscribe = watchOpenTasksShowMoreAvailability({
            projectId: 'project-1',
            userId: 'user-1',
            userWorkstreamIds: ['workstream-a', 'workstream-b'],
            watcherKey: 'availability',
            live: false,
        })

        expect(mockQuery.onSnapshot).not.toHaveBeenCalled()
        expect(mockQuery.get).toHaveBeenCalledTimes(11)

        await Promise.resolve()
        await Promise.resolve()

        const actions = mockStore.dispatch.mock.calls.flatMap(([action]) => action)
        expect(actions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ type: 'Add there are later open tasks', thereAreLaterOpenTasks: false }),
                expect.objectContaining({ type: 'Add there are someday open tasks', thereAreSomedayOpenTasks: false }),
            ])
        )

        unsubscribe()
        expect(mockUnsubscribeFunctions).toHaveLength(0)
        expect(mockGlobalWatcherUnsub.availability).toBeUndefined()
    })

    it('keeps every legacy workstream unsubscribe under the composite key', () => {
        watchIfNeedShowLaterOpenTasksButton(
            'project-1',
            'user-1',
            ['workstream-a', 'workstream-b'],
            'normal',
            'observed',
            'workstreams',
            true,
            false
        )

        expect(mockQuery.onSnapshot).toHaveBeenCalledTimes(5)
        mockGlobalWatcherUnsub.workstreams()

        // The last three subscriptions are the two custom workstreams plus default.
        mockUnsubscribeFunctions.slice(-3).forEach(stop => expect(stop).toHaveBeenCalledTimes(1))
    })
})
