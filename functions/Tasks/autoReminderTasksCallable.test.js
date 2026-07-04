const mockDocuments = {}
const mockBatchCommit = jest.fn(() => Promise.resolve())
const mockBatchSetProjectContext = jest.fn()
const mockAutoPostponeTaskCloud = jest.fn(({ now }) => Promise.resolve(now + 86400000))
const mockFindAndSetNewFocusTask = jest.fn(() => Promise.resolve())
const mockCanAccessObject = jest.fn(() => true)

const mockSnapshotFor = path => {
    const value = mockDocuments[path]
    return {
        exists: value !== undefined,
        data: () => value,
    }
}

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({
        doc: jest.fn(path => ({
            path,
            get: jest.fn(() => Promise.resolve(mockSnapshotFor(path))),
        })),
    })),
}))

jest.mock('../BatchWrapper/batchWrapper', () => ({
    BatchWrapper: jest.fn().mockImplementation(() => ({
        setProjectContext: mockBatchSetProjectContext,
        commit: mockBatchCommit,
    })),
}))

jest.mock('../GlobalState/globalState', () => ({
    loadFeedsGlobalState: jest.fn(),
}))

jest.mock('../shared/FocusTaskService', () => ({
    FocusTaskService: jest.fn().mockImplementation(() => ({
        findAndSetNewFocusTask: mockFindAndSetNewFocusTask,
    })),
}))

jest.mock('../shared/privacyAccess', () => ({
    canAccessObject: (...args) => mockCanAccessObject(...args),
    getAccessibleProjectIdsFromUserData: userData => userData.projectIds || [],
}))

jest.mock('../Utils/MapDataFuncions', () => ({
    mapProjectData: (projectId, project) => ({ id: projectId, ...project }),
    mapTaskData: (taskId, task) => ({ id: taskId, ...task }),
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    WORKSTREAM_ID_PREFIX: 'ws@',
}))

jest.mock('./autoPostponeTasksCloud', () => ({
    autoPostponeTaskCloud: (...args) => mockAutoPostponeTaskCloud(...args),
    getMomentInTimezone: () => ({ utcOffset: () => 120 }),
    resolveTimezoneContext: userData => ({ offsetMinutes: userData.timezone || 0 }),
}))

const {
    MAX_AUTO_REMINDER_TASKS,
    normalizeTaskRequests,
    executeAutoReminderTasks,
} = require('./autoReminderTasksCallable')

describe('autoReminderTasksCallable', () => {
    beforeEach(() => {
        Object.keys(mockDocuments).forEach(key => delete mockDocuments[key])
        jest.clearAllMocks()
    })

    test('validates, deduplicates, and prefers the primary task path', () => {
        const result = normalizeTaskRequests({
            targetUserId: ' user-1 ',
            tasks: [
                { projectId: 'project-1', taskId: 'task-1', isObservedTask: true },
                { projectId: 'project-1', taskId: 'task-1', isObservedTask: false },
            ],
        })

        expect(result).toEqual({
            targetUserId: 'user-1',
            tasks: [{ projectId: 'project-1', taskId: 'task-1', isObservedTask: false }],
        })
        expect(() =>
            normalizeTaskRequests({
                targetUserId: 'user-1',
                tasks: [{ projectId: 'project-1', taskId: 'task-1' }],
            })
        ).toThrow('isObservedTask')
        expect(MAX_AUTO_REMINDER_TASKS).toBe(500)
    })

    test('uses the actor for editor/feed metadata and the target user for observer and focus behavior', async () => {
        const now = Date.UTC(2026, 6, 4, 10, 0, 0)
        mockDocuments['users/actor-1'] = {
            projectIds: ['project-1'],
            displayName: 'Actor',
        }
        mockDocuments['users/target-1'] = {
            timezone: 2,
            inFocusTaskId: 'task-1',
            inFocusTaskProjectId: 'project-1',
        }
        mockDocuments['projects/project-1'] = { name: 'Project', userIds: ['actor-1', 'target-1'] }
        mockDocuments['items/project-1/tasks/task-1'] = {
            name: 'Observed task',
            observersIds: ['target-1'],
            isPublicFor: [0],
            parentGoalId: 'goal-1',
            done: false,
            inDone: false,
        }
        mockDocuments['items/project-1/tasks/task-missing'] = undefined

        const result = await executeAutoReminderTasks({
            actorUserId: 'actor-1',
            now,
            data: {
                targetUserId: 'target-1',
                tasks: [
                    { projectId: 'project-1', taskId: 'task-1', isObservedTask: true },
                    { projectId: 'project-1', taskId: 'task-missing', isObservedTask: false },
                ],
            },
        })

        expect(mockAutoPostponeTaskCloud).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: 'project-1',
                userId: 'target-1',
                editorUserId: 'actor-1',
                isObservedTask: true,
                feedUser: expect.objectContaining({ uid: 'actor-1', displayName: 'Actor' }),
                now,
            })
        )
        expect(mockBatchCommit).toHaveBeenCalledTimes(1)
        expect(mockFindAndSetNewFocusTask).toHaveBeenCalledWith('target-1', 'project-1', 'goal-1', 'task-1', 120)
        expect(result).toEqual({
            requestedCount: 2,
            updatedCount: 1,
            updated: [
                {
                    projectId: 'project-1',
                    taskId: 'task-1',
                    isObservedTask: true,
                    dueDate: now + 86400000,
                },
            ],
            skipped: [
                {
                    projectId: 'project-1',
                    taskId: 'task-missing',
                    isObservedTask: false,
                    reason: 'not-found',
                },
            ],
        })
    })

    test('rejects inaccessible projects and invalid observer requests', async () => {
        mockDocuments['users/actor-1'] = { projectIds: [] }
        mockDocuments['users/target-1'] = { projectIds: [] }
        mockDocuments['projects/project-1'] = { userIds: [] }
        mockDocuments['items/project-1/tasks/task-1'] = {
            observersIds: [],
            isPublicFor: [0],
            done: false,
            inDone: false,
        }

        await expect(
            executeAutoReminderTasks({
                actorUserId: 'actor-1',
                data: {
                    targetUserId: 'target-1',
                    tasks: [{ projectId: 'project-1', taskId: 'task-1', isObservedTask: true }],
                },
            })
        ).rejects.toMatchObject({ code: 'permission-denied' })

        mockDocuments['users/actor-1'].projectIds = ['project-1']
        mockDocuments['users/target-1'].projectIds = ['project-1']
        await expect(
            executeAutoReminderTasks({
                actorUserId: 'actor-1',
                data: {
                    targetUserId: 'target-1',
                    tasks: [{ projectId: 'project-1', taskId: 'task-1', isObservedTask: true }],
                },
            })
        ).rejects.toThrow('not observing')
    })
})
