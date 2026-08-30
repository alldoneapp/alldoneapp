const mockWhere = jest.fn()
const mockOnSnapshot = jest.fn()
const mockCollectionGroup = jest.fn()
const mockUnderlyingUnsubscribe = jest.fn()
const mockSnapshotPerformance = {
    observe: jest.fn(),
    fail: jest.fn(),
    cancel: jest.fn(),
}

const mockQuery = {
    where: (...args) => {
        mockWhere(...args)
        return mockQuery
    },
    onSnapshot: (...args) => mockOnSnapshot(...args),
}

jest.mock('./firestore', () => ({
    getDb: () => ({ collectionGroup: (...args) => mockCollectionGroup(...args) }),
}))

jest.mock('./cachedSnapshotGate', () => ({
    createCachedSnapshotGate: () => ({
        shouldBuffer: () => false,
        wrapUnsubscribe: unsubscribe => unsubscribe,
        dispose: jest.fn(),
    }),
}))

jest.mock('../performance/firestoreSnapshotPerformance', () => ({
    createFirstSnapshotPerformance: () => mockSnapshotPerformance,
}))

import {
    getAllProjectsAssignedTasksQuery,
    resetAllProjectsAssignedTaskWatchesForTests,
    subscribeToAllProjectsAssignedTasks,
} from './allProjectsAssignedTasks'

const buildDocument = (projectId, taskId) => ({
    id: taskId,
    ref: { path: `items/${projectId}/tasks/${taskId}` },
    data: () => ({ taskId }),
})

const buildSnapshot = (documents, changes = documents.map(doc => ({ type: 'added', doc }))) => ({
    docs: documents,
    size: documents.length,
    empty: documents.length === 0,
    forEach: callback => documents.forEach(callback),
    docChanges: () => changes,
    metadata: { fromCache: false, hasPendingWrites: false },
})

describe('shared All Projects assigned-task listener', () => {
    let handleSnapshot
    let handleError

    beforeEach(() => {
        jest.clearAllMocks()
        resetAllProjectsAssignedTaskWatchesForTests()
        mockCollectionGroup.mockReturnValue(mockQuery)
        mockOnSnapshot.mockImplementation((options, onSnapshot, onError) => {
            handleSnapshot = onSnapshot
            handleError = onError
            return mockUnderlyingUnsubscribe
        })
    })

    afterEach(() => resetAllProjectsAssignedTaskWatchesForTests())

    it('builds the collection-group query from server-owned access projections', () => {
        getAllProjectsAssignedTasksQuery({
            currentUserId: 'user-1',
            accessReaderId: 'user-1',
            endOfDay: 123,
            projectIds: ['project-2', 'project-1', 'project-1'],
        })

        expect(mockCollectionGroup).toHaveBeenCalledWith('tasks')
        expect(mockWhere.mock.calls).toEqual([
            ['readerIds', 'array-contains', 'user-1'],
            ['projectId', 'in', ['project-1', 'project-2']],
            ['currentReviewerId', '==', 'user-1'],
            ['inDone', '==', false],
            ['dueDate', '<=', 123],
        ])
    })

    it('rejects empty or oversized project scopes before opening a listener', () => {
        const common = { currentUserId: 'user-1', accessReaderId: 'user-1', endOfDay: 123 }

        expect(() => getAllProjectsAssignedTasksQuery({ ...common, projectIds: [] })).toThrow(
            'between 1 and 30 active project ids'
        )
        expect(() =>
            getAllProjectsAssignedTasksQuery({
                ...common,
                projectIds: Array.from({ length: 31 }, (_, index) => `project-${index}`),
            })
        ).toThrow('between 1 and 30 active project ids')
        expect(mockCollectionGroup).not.toHaveBeenCalled()
    })

    it('uses one Firestore listener and splits its snapshot by project', () => {
        const firstProjectSnapshots = []
        const secondProjectSnapshots = []
        const common = {
            currentUserId: 'user-1',
            accessReaderId: 'user-1',
            endOfDay: 123,
            projectIds: ['project-1', 'project-2'],
        }

        const unsubscribeFirst = subscribeToAllProjectsAssignedTasks({
            ...common,
            projectId: 'project-1',
            onSnapshot: snapshot => firstProjectSnapshots.push(snapshot),
        })
        const unsubscribeSecond = subscribeToAllProjectsAssignedTasks({
            ...common,
            projectId: 'project-2',
            onSnapshot: snapshot => secondProjectSnapshots.push(snapshot),
        })

        expect(mockOnSnapshot).toHaveBeenCalledTimes(1)

        const project1Task = buildDocument('project-1', 'task-1')
        const project2Task = buildDocument('project-2', 'task-2')
        const inactiveTask = buildDocument('inactive-project', 'task-3')
        handleSnapshot(buildSnapshot([project1Task, project2Task, inactiveTask]))

        expect(firstProjectSnapshots).toHaveLength(1)
        expect(firstProjectSnapshots[0].docs).toEqual([project1Task])
        expect(firstProjectSnapshots[0].docChanges().map(change => change.doc)).toEqual([project1Task])
        expect(secondProjectSnapshots[0].docs).toEqual([project2Task])

        unsubscribeFirst()
        expect(mockUnderlyingUnsubscribe).not.toHaveBeenCalled()
        unsubscribeSecond()
        expect(mockUnderlyingUnsubscribe).toHaveBeenCalledTimes(1)
    })

    it('replays the current project result to a subscriber that mounts after the first snapshot', async () => {
        const common = {
            currentUserId: 'user-1',
            accessReaderId: 'user-1',
            endOfDay: 123,
            projectIds: ['project-1', 'project-2'],
        }
        const unsubscribeFirst = subscribeToAllProjectsAssignedTasks({
            ...common,
            projectId: 'project-1',
            onSnapshot: jest.fn(),
        })
        const project2Task = buildDocument('project-2', 'task-2')
        handleSnapshot(buildSnapshot([project2Task]))

        const lateSnapshots = []
        const unsubscribeLate = subscribeToAllProjectsAssignedTasks({
            ...common,
            projectId: 'project-2',
            onSnapshot: snapshot => lateSnapshots.push(snapshot),
        })
        await Promise.resolve()

        expect(lateSnapshots).toHaveLength(1)
        expect(lateSnapshots[0].docs).toEqual([project2Task])
        expect(lateSnapshots[0].docChanges()).toEqual([{ type: 'added', doc: project2Task, oldIndex: -1, newIndex: 0 }])

        unsubscribeFirst()
        unsubscribeLate()
    })

    it('lets every project fall back when the shared query fails', () => {
        const firstFallback = jest.fn()
        const secondFallback = jest.fn()
        const common = {
            currentUserId: 'user-1',
            accessReaderId: 'user-1',
            endOfDay: 123,
            projectIds: ['project-1', 'project-2'],
        }

        subscribeToAllProjectsAssignedTasks({
            ...common,
            projectId: 'project-1',
            onSnapshot: jest.fn(),
            onError: firstFallback,
        })
        subscribeToAllProjectsAssignedTasks({
            ...common,
            projectId: 'project-2',
            onSnapshot: jest.fn(),
            onError: secondFallback,
        })
        handleError(new Error('index unavailable'))

        expect(mockSnapshotPerformance.fail).toHaveBeenCalledTimes(1)
        expect(firstFallback).toHaveBeenCalledTimes(1)
        expect(secondFallback).toHaveBeenCalledTimes(1)
        expect(mockUnderlyingUnsubscribe).toHaveBeenCalledTimes(1)
    })
})
