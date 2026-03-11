const mockFirestoreState = {
    projects: {},
    users: {},
    tasks: [],
    updates: [],
}

let mockGeneratedTaskCounter = 0

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({
        doc: jest.fn(path => {
            if (path.startsWith('projects/')) {
                const projectId = path.split('/')[1]
                return {
                    get: jest.fn().mockResolvedValue({
                        exists: !!mockFirestoreState.projects[projectId],
                        data: () => mockFirestoreState.projects[projectId] || null,
                    }),
                }
            }

            if (path.startsWith('items/')) {
                return {
                    update: jest.fn().mockImplementation(async data => {
                        mockFirestoreState.updates.push({ path, data })
                    }),
                    delete: jest.fn(),
                }
            }

            throw new Error(`Unexpected doc path: ${path}`)
        }),
        collection: jest.fn(name => {
            if (name === 'users') {
                return {
                    doc: jest.fn(userId => ({
                        get: jest.fn().mockResolvedValue({
                            exists: !!mockFirestoreState.users[userId],
                            data: () => mockFirestoreState.users[userId] || null,
                        }),
                    })),
                }
            }

            if (name === '_') {
                return {
                    doc: jest.fn(() => ({ id: `generated-task-${++mockGeneratedTaskCounter}` })),
                }
            }

            if (name.startsWith('items/') && name.endsWith('/tasks')) {
                return {
                    where: jest.fn(() => ({
                        get: jest.fn().mockImplementation(async () => {
                            const docs = mockFirestoreState.tasks.map(task => ({
                                id: task.id,
                                data: () => ({ ...task }),
                            }))
                            return { docs }
                        }),
                    })),
                }
            }

            throw new Error(`Unexpected collection: ${name}`)
        }),
    })),
}))

jest.mock('../Tasks/tasksFirestoreCloud', () => ({
    deleteTask: jest.fn().mockResolvedValue(undefined),
    uploadTask: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../Tasks/onDeleteTaskFunctions', () => ({
    onDeleteTask: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../Feeds/tasksFeeds', () => ({
    createTaskUpdatedFeed: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../Feeds/tasksFeedsHelper', () => ({
    generateTaskObjectModel: jest.fn(() => ({})),
}))

jest.mock('../GlobalState/globalState', () => ({
    loadFeedsGlobalState: jest.fn(),
}))

jest.mock('../BatchWrapper/batchWrapper', () => ({
    BatchWrapper: jest.fn().mockImplementation(() => ({
        commit: jest.fn().mockResolvedValue(undefined),
    })),
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    FEED_PUBLIC_FOR_ALL: 0,
    MENTION_SPACE_CODE: 'M2mVOSjAVPPKweL',
    TASK_ASSIGNEE_USER_TYPE: 'user',
}))

const { uploadTask, deleteTask } = require('../Tasks/tasksFirestoreCloud')
const { onDeleteTask } = require('../Tasks/onDeleteTaskFunctions')
const { syncContactFollowUpTask } = require('./contactFollowUpTasks')

describe('contactFollowUpTasks', () => {
    beforeEach(() => {
        mockFirestoreState.projects = {
            'project-1': {
                userIds: ['user-1'],
                contactStatuses: {
                    status1: { id: 'status1', followUpDays: 3 },
                },
            },
        }
        mockFirestoreState.users = {
            'user-1': { timezone: 120 },
        }
        mockFirestoreState.tasks = []
        mockFirestoreState.updates = []
        mockGeneratedTaskCounter = 0
        jest.clearAllMocks()
        jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 2, 11, 10, 0, 0))
        jest.spyOn(console, 'log').mockImplementation(() => {})
        jest.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        Date.now.mockRestore()
        console.log.mockRestore()
        console.error.mockRestore()
    })

    function makeContact(overrides = {}) {
        return {
            uid: 'contact-1',
            displayName: 'Taylor Contact',
            contactStatusId: 'status1',
            recorderUserId: 'user-1',
            lastEditorId: 'user-1',
            lastEditionDate: Date.UTC(2026, 2, 11, 8, 0, 0),
            isPrivate: false,
            isPublicFor: [0, 'user-1'],
            ...overrides,
        }
    }

    function makeTask(overrides = {}) {
        return {
            id: 'task-1',
            created: Date.UTC(2026, 2, 8, 8, 0, 0),
            dueDate: Date.UTC(2026, 2, 14, 8, 0, 0),
            done: false,
            inDone: false,
            autoFollowUpManaged: true,
            autoFollowUpType: 'contact-status',
            autoFollowUpContactId: 'contact-1',
            autoFollowUpStatusId: 'status1',
            userId: 'user-1',
            lastEditorId: 'user-1',
            linkedParentContactsIds: ['contact-1'],
            ...overrides,
        }
    }

    test('creates the first managed follow-up task when none exists', async () => {
        await syncContactFollowUpTask('project-1', makeContact())

        expect(uploadTask).toHaveBeenCalledTimes(1)
        const createdTask = uploadTask.mock.calls[0][2]
        expect(createdTask.autoFollowUpContactId).toBe('contact-1')
        expect(createdTask.autoFollowUpStatusId).toBe('status1')
        expect(createdTask.dueDate).toBe(Date.UTC(2026, 2, 14, 8, 0, 0))
    })

    test('updates only the future managed follow-up task when one exists', async () => {
        mockFirestoreState.tasks = [
            makeTask({
                id: 'future-task',
                dueDate: Date.UTC(2026, 2, 14, 8, 0, 0),
            }),
        ]

        await syncContactFollowUpTask('project-1', makeContact({ lastEditionDate: Date.UTC(2026, 2, 12, 9, 0, 0) }))

        expect(uploadTask).not.toHaveBeenCalled()
        expect(mockFirestoreState.updates).toHaveLength(1)
        expect(mockFirestoreState.updates[0]).toMatchObject({
            path: 'items/project-1/tasks/future-task',
        })
        expect(mockFirestoreState.updates[0].data.dueDate).toBe(Date.UTC(2026, 2, 15, 9, 0, 0))
    })

    test('creates a future task when only a current overdue task exists', async () => {
        mockFirestoreState.tasks = [
            makeTask({
                id: 'current-task',
                created: Date.UTC(2026, 2, 5, 8, 0, 0),
                dueDate: Date.UTC(2026, 2, 10, 8, 0, 0),
            }),
        ]

        await syncContactFollowUpTask('project-1', makeContact())

        expect(uploadTask).toHaveBeenCalledTimes(1)
        const createdTask = uploadTask.mock.calls[0][2]
        expect(createdTask.id).toBe('generated-task-1')
        expect(createdTask.dueDate).toBe(Date.UTC(2026, 2, 14, 8, 0, 0))
        expect(mockFirestoreState.updates).toHaveLength(0)
    })

    test('does not move the current task when a future task also exists', async () => {
        mockFirestoreState.tasks = [
            makeTask({
                id: 'current-task',
                created: Date.UTC(2026, 2, 5, 8, 0, 0),
                dueDate: Date.UTC(2026, 2, 10, 8, 0, 0),
            }),
            makeTask({
                id: 'future-task',
                created: Date.UTC(2026, 2, 11, 8, 0, 0),
                dueDate: Date.UTC(2026, 2, 14, 8, 0, 0),
            }),
        ]

        await syncContactFollowUpTask('project-1', makeContact({ lastEditionDate: Date.UTC(2026, 2, 12, 9, 0, 0) }))

        expect(uploadTask).not.toHaveBeenCalled()
        expect(mockFirestoreState.updates).toHaveLength(1)
        expect(mockFirestoreState.updates[0].path).toBe('items/project-1/tasks/future-task')
        expect(mockFirestoreState.updates[0].data.dueDate).toBe(Date.UTC(2026, 2, 15, 9, 0, 0))
    })

    test('keeps at most one current task and one future task after sync', async () => {
        mockFirestoreState.tasks = [
            makeTask({
                id: 'current-1',
                created: Date.UTC(2026, 2, 5, 8, 0, 0),
                dueDate: Date.UTC(2026, 2, 10, 8, 0, 0),
            }),
            makeTask({
                id: 'current-2',
                created: Date.UTC(2026, 2, 6, 8, 0, 0),
                dueDate: Date.UTC(2026, 2, 10, 9, 0, 0),
            }),
            makeTask({
                id: 'future-1',
                created: Date.UTC(2026, 2, 11, 8, 0, 0),
                dueDate: Date.UTC(2026, 2, 14, 8, 0, 0),
            }),
            makeTask({
                id: 'future-2',
                created: Date.UTC(2026, 2, 12, 8, 0, 0),
                dueDate: Date.UTC(2026, 2, 15, 8, 0, 0),
            }),
        ]

        await syncContactFollowUpTask('project-1', makeContact({ lastEditionDate: Date.UTC(2026, 2, 12, 9, 0, 0) }))

        expect(onDeleteTask).toHaveBeenCalledTimes(2)
        expect(deleteTask).toHaveBeenCalledTimes(2)
        expect(onDeleteTask.mock.calls.map(call => call[1].id).sort()).toEqual(['current-2', 'future-2'])
        expect(mockFirestoreState.updates).toHaveLength(1)
        expect(mockFirestoreState.updates[0].path).toBe('items/project-1/tasks/future-1')
    })

    test('deletes all open managed tasks when follow-up config becomes invalid', async () => {
        mockFirestoreState.tasks = [
            makeTask({
                id: 'current-task',
                dueDate: Date.UTC(2026, 2, 10, 8, 0, 0),
            }),
            makeTask({
                id: 'future-task',
                dueDate: Date.UTC(2026, 2, 14, 8, 0, 0),
            }),
        ]

        await syncContactFollowUpTask('project-1', makeContact({ contactStatusId: 'missing-status' }))

        expect(onDeleteTask).toHaveBeenCalledTimes(2)
        expect(deleteTask).toHaveBeenCalledTimes(2)
        expect(uploadTask).not.toHaveBeenCalled()
        expect(mockFirestoreState.updates).toHaveLength(0)
    })

    test('treats later-today tasks as current and tomorrow tasks as future in assignee timezone', async () => {
        mockFirestoreState.tasks = [
            makeTask({
                id: 'later-today',
                created: Date.UTC(2026, 2, 11, 8, 0, 0),
                dueDate: Date.UTC(2026, 2, 11, 20, 0, 0),
            }),
            makeTask({
                id: 'tomorrow',
                created: Date.UTC(2026, 2, 12, 8, 0, 0),
                dueDate: Date.UTC(2026, 2, 12, 8, 0, 0),
            }),
        ]

        await syncContactFollowUpTask('project-1', makeContact({ lastEditionDate: Date.UTC(2026, 2, 12, 9, 0, 0) }))

        expect(mockFirestoreState.updates).toHaveLength(1)
        expect(mockFirestoreState.updates[0].path).toBe('items/project-1/tasks/tomorrow')
        expect(onDeleteTask).not.toHaveBeenCalled()
    })
})
