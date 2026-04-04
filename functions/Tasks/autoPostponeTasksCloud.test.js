const mockQueryGet = jest.fn()
const mockUserDocUpdate = jest.fn(() => Promise.resolve())

jest.mock('firebase-admin', () => ({
    firestore: Object.assign(
        jest.fn(() => ({
            collection: jest.fn(name => {
                if (name === 'users') {
                    return {
                        where: jest.fn(() => ({
                            get: mockQueryGet,
                        })),
                    }
                }

                throw new Error(`Unexpected collection: ${name}`)
            }),
            doc: jest.fn(path => ({
                update: path.startsWith('users/') ? mockUserDocUpdate : jest.fn(() => Promise.resolve()),
            })),
        })),
        {
            FieldValue: {
                increment: jest.fn(value => ({ __increment__: value })),
            },
        }
    ),
}))

jest.mock('../BatchWrapper/batchWrapper', () => ({
    BatchWrapper: jest.fn().mockImplementation(() => ({
        update: jest.fn(),
        commit: jest.fn(() => Promise.resolve()),
        setProjectContext: jest.fn(),
        feedObjects: {},
    })),
}))

jest.mock('../Feeds/tasksFeeds', () => ({
    createTaskDueDateChangedFeed: jest.fn(() => Promise.resolve()),
}))

jest.mock('../Followers/followerHelper', () => ({
    tryAddFollower: jest.fn(() => Promise.resolve()),
}))

jest.mock('../GlobalState/globalState', () => ({
    loadFeedsGlobalState: jest.fn(),
}))

jest.mock('../shared/FocusTaskService', () => ({
    FocusTaskService: jest.fn().mockImplementation(() => ({
        findAndSetNewFocusTask: jest.fn(() => Promise.resolve()),
    })),
}))

jest.mock('../Utils/MapDataFuncions', () => ({
    mapProjectData: jest.fn((projectId, project) => ({ id: projectId, ...project })),
    mapTaskData: jest.fn((taskId, task) => ({ id: taskId, parentId: null, isPublicFor: [0], ...task })),
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    BACKLOG_DATE_NUMERIC: Number.MAX_SAFE_INTEGER,
    DEFAULT_WORKSTREAM_ID: 'ws@default',
    FEED_PUBLIC_FOR_ALL: 0,
    generateSortIndex: jest.fn(() => 123456789),
}))

const { createTaskDueDateChangedFeed } = require('../Feeds/tasksFeeds')
const { tryAddFollower } = require('../Followers/followerHelper')
const {
    AUTO_POSTPONE_AFTER_DAYS_OVERDUE_DEFAULT,
    AUTO_POSTPONE_AFTER_DAYS_OVERDUE_NEVER,
    normalizeAutoPostponeAfterDaysOverdue,
    resolveTimezoneContext,
    getLocalDateKey,
    getOverdueDays,
    shouldProcessUserToday,
    getUserWorkstreamIds,
    shouldAutoPostponeTask,
    mergeTaskCandidate,
    autoPostponeTaskCloud,
    processUserAutoPostpone,
    checkAndAutoPostponeTasks,
} = require('./autoPostponeTasksCloud')

describe('autoPostponeTasksCloud', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockQueryGet.mockResolvedValue({ docs: [] })
    })

    test('defaults invalid settings to 3 and preserves Never as 0', () => {
        expect(normalizeAutoPostponeAfterDaysOverdue(undefined)).toBe(AUTO_POSTPONE_AFTER_DAYS_OVERDUE_DEFAULT)
        expect(normalizeAutoPostponeAfterDaysOverdue(0)).toBe(AUTO_POSTPONE_AFTER_DAYS_OVERDUE_NEVER)
    })

    test('resolves numeric and named timezones', () => {
        expect(resolveTimezoneContext({ timezone: 2 })).toEqual({ zoneName: null, offsetMinutes: 120 })
        expect(resolveTimezoneContext({ timezone: 'Europe/Berlin' })).toEqual({
            zoneName: 'Europe/Berlin',
            offsetMinutes: null,
        })
    })

    test('computes the local date key in the user timezone', () => {
        const now = Date.UTC(2026, 0, 1, 22, 30, 0)
        expect(getLocalDateKey({ timezone: 120 }, now)).toBe('2026-01-02')
    })

    test('calculates overdue days by local calendar day', () => {
        const timezoneContext = resolveTimezoneContext({ timezone: 120 })
        const now = Date.UTC(2026, 0, 4, 0, 5, 0)
        const dueDate = Date.UTC(2026, 0, 1, 10, 0, 0)

        expect(getOverdueDays(dueDate, timezoneContext, now)).toBe(3)
    })

    test('only processes a user once per local day', () => {
        const now = Date.UTC(2026, 0, 1, 22, 30, 0)
        expect(shouldProcessUserToday({ timezone: 120, lastAutoPostponeLocalDateKey: '2026-01-01' }, now)).toEqual({
            localDateKey: '2026-01-02',
            shouldProcess: true,
        })
        expect(shouldProcessUserToday({ timezone: 120, lastAutoPostponeLocalDateKey: '2026-01-02' }, now)).toEqual({
            localDateKey: '2026-01-02',
            shouldProcess: false,
        })
    })

    test('includes default and explicit workstreams', () => {
        expect(getUserWorkstreamIds({}, 'project-1')).toEqual(['ws@default'])
        expect(getUserWorkstreamIds({ workstreams: { 'project-1': ['ws@custom'] } }, 'project-1')).toEqual([
            'ws@default',
            'ws@custom',
        ])
    })

    test('skips subtasks when checking eligibility', () => {
        const timezoneContext = resolveTimezoneContext({ timezone: 0 })
        const now = Date.UTC(2026, 0, 4, 0, 5, 0)
        const endOfToday = Date.UTC(2026, 0, 4, 23, 59, 59)

        expect(
            shouldAutoPostponeTask({
                task: {
                    id: 'task-1',
                    parentId: 'parent-1',
                    done: false,
                    inDone: false,
                    isPublicFor: [0, 'user-1'],
                },
                effectiveDueDate: Date.UTC(2026, 0, 1, 10, 0, 0),
                userId: 'user-1',
                timezoneContext,
                thresholdDays: 3,
                endOfToday,
                now,
            })
        ).toBe(false)
    })

    test('prefers direct or workstream candidates over observed ones', () => {
        const taskMap = new Map()

        mergeTaskCandidate(taskMap, { id: 'task-1', isObservedTask: true, source: 'observed' })
        mergeTaskCandidate(taskMap, { id: 'task-1', isObservedTask: false, source: 'direct' })

        expect(taskMap.get('task-1')).toEqual({ id: 'task-1', isObservedTask: false, source: 'direct' })
    })

    test('updates direct tasks with dueDate and timesPostponed increment', async () => {
        const batch = { update: jest.fn() }

        await autoPostponeTaskCloud({
            projectId: 'project-1',
            task: {
                id: 'task-1',
                dueDate: Date.UTC(2026, 0, 1, 10, 0, 0),
                timesPostponed: 0,
                subtaskIds: ['subtask-1'],
                dueDateByObserversIds: {},
                isPublicFor: [0, 'user-1'],
            },
            userId: 'user-1',
            isObservedTask: false,
            timezoneContext: resolveTimezoneContext({ timezone: 0 }),
            batch,
            feedUser: { uid: 'user-1' },
            now: Date.UTC(2026, 0, 4, 0, 5, 0),
        })

        expect(batch.update).toHaveBeenNthCalledWith(
            1,
            expect.any(Object),
            expect.objectContaining({
                dueDate: Date.UTC(2026, 0, 5, 0, 5, 0),
                timesPostponed: { __increment__: 1 },
                lastEditorId: 'user-1',
            })
        )
        expect(batch.update).toHaveBeenNthCalledWith(
            2,
            expect.any(Object),
            expect.objectContaining({
                dueDate: Date.UTC(2026, 0, 5, 0, 5, 0),
                timesPostponed: { __increment__: 1 },
            })
        )
        expect(createTaskDueDateChangedFeed).toHaveBeenCalled()
        expect(tryAddFollower).toHaveBeenCalled()
    })

    test('updates observed tasks only on dueDateByObserversIds', async () => {
        const batch = { update: jest.fn() }

        await autoPostponeTaskCloud({
            projectId: 'project-1',
            task: {
                id: 'task-1',
                dueDate: Date.UTC(2026, 0, 1, 10, 0, 0),
                timesPostponed: 3,
                subtaskIds: ['subtask-1'],
                dueDateByObserversIds: { 'user-1': Date.UTC(2026, 0, 1, 10, 0, 0) },
                isPublicFor: [0, 'user-1'],
            },
            userId: 'user-1',
            isObservedTask: true,
            timezoneContext: resolveTimezoneContext({ timezone: 0 }),
            batch,
            feedUser: { uid: 'user-1' },
            now: Date.UTC(2026, 0, 4, 0, 5, 0),
        })

        expect(batch.update).toHaveBeenCalledTimes(1)
        expect(batch.update).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({
                'dueDateByObserversIds.user-1': Date.UTC(2026, 0, 5, 0, 5, 0),
                lastEditorId: 'user-1',
            })
        )
    })

    test('skips processing when the feature is disabled for the user', async () => {
        const result = await processUserAutoPostpone(
            'user-1',
            { autoPostponeAfterDaysOverdue: 0, lastAutoPostponeLocalDateKey: '' },
            Date.UTC(2026, 0, 4, 0, 5, 0)
        )

        expect(result).toEqual({ processed: false, reason: 'disabled', postponedCount: 0 })
        expect(mockUserDocUpdate).not.toHaveBeenCalled()
    })

    test('treats users without a recent login query result as skipped by the scheduled runner', async () => {
        mockQueryGet.mockResolvedValue({ docs: [] })

        const result = await checkAndAutoPostponeTasks(Date.UTC(2026, 0, 4, 0, 5, 0))

        expect(result).toEqual({
            success: true,
            activeUsers: 0,
            processedUsers: 0,
            skippedUsers: 0,
            postponedTasks: 0,
        })
    })
})
