const mockTaskServiceInitialize = jest.fn()
const mockUpdateAndPersistTask = jest.fn()
const mockTaskService = jest.fn().mockImplementation(() => ({
    initialize: mockTaskServiceInitialize,
    updateAndPersistTask: mockUpdateAndPersistTask,
}))
const mockTaskGet = jest.fn()
const mockFirestoreDoc = jest.fn(() => ({ get: mockTaskGet }))
const mockFirestore = jest.fn(() => ({ doc: mockFirestoreDoc }))

jest.mock('firebase-admin', () => ({
    firestore: (...args) => mockFirestore(...args),
}))

jest.mock('../Firestore/templatesFirestore', () => ({
    getAssistantTasks: jest.fn(),
}))

jest.mock('./assistantPreConfigTaskTopic', () => ({
    generatePreConfigTaskResult: jest.fn(),
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    FEED_PUBLIC_FOR_ALL: 0,
    STAYWARD_COMMENT: 'STAYWARD_COMMENT',
}))

jest.mock('../Firestore/generalFirestoreCloud', () => ({
    getId: jest.fn(() => 'generated-task-1'),
}))

jest.mock('../Firestore/assistantsFirestore', () => ({
    GLOBAL_PROJECT_ID: 'global-project',
}))

jest.mock('../shared/TaskService', () => ({
    TaskService: mockTaskService,
}))

const { __private__ } = require('./assistantRecurringTasks')

describe('recurring assistant generated task completion', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockTaskServiceInitialize.mockResolvedValue(undefined)
        mockUpdateAndPersistTask.mockResolvedValue({
            success: true,
            persisted: true,
            taskId: 'generated-task-1',
        })
        mockTaskGet.mockResolvedValue({
            exists: true,
            data: () => ({
                id: 'generated-task-1',
                name: 'Weekly Project Descriptions Update',
                userId: 'assistant-1',
                userIds: ['assistant-1'],
                done: false,
                inDone: false,
                estimations: { Open: 0 },
            }),
        })
    })

    test('marks the generated task complete through TaskService after a successful run', async () => {
        const result = await __private__.completeGeneratedAssistantTask('project-1', 'generated-task-1', 'user-1', {
            displayName: 'Karsten',
            email: 'karsten@example.com',
        })

        expect(mockFirestoreDoc).toHaveBeenCalledWith('items/project-1/tasks/generated-task-1')
        expect(mockTaskService).toHaveBeenCalledWith(
            expect.objectContaining({
                database: expect.any(Object),
                enableFeeds: true,
                enableValidation: false,
                isCloudFunction: true,
            })
        )
        expect(mockTaskServiceInitialize).toHaveBeenCalledTimes(1)
        expect(mockUpdateAndPersistTask).toHaveBeenCalledWith(
            expect.objectContaining({
                taskId: 'generated-task-1',
                projectId: 'project-1',
                completed: true,
                currentTask: expect.objectContaining({
                    id: 'generated-task-1',
                    done: false,
                    inDone: false,
                }),
                feedUser: expect.objectContaining({
                    uid: 'user-1',
                    displayName: 'Karsten',
                }),
            }),
            expect.objectContaining({
                projectId: 'project-1',
                userId: 'user-1',
            }),
            expect.objectContaining({ projectId: 'project-1' })
        )
        expect(result).toEqual(expect.objectContaining({ success: true, persisted: true }))
    })

    test('does not write an already completed generated task again', async () => {
        mockTaskGet.mockResolvedValue({
            exists: true,
            data: () => ({ done: true, inDone: true }),
        })

        const result = await __private__.completeGeneratedAssistantTask('project-1', 'generated-task-1', 'user-1')

        expect(mockTaskService).not.toHaveBeenCalled()
        expect(result).toEqual(
            expect.objectContaining({
                success: true,
                persisted: false,
                alreadyCompleted: true,
            })
        )
    })

    test('only finalizes generated tasks for successful assistant results', async () => {
        const completeTask = jest.fn().mockResolvedValue({ success: true })
        const input = {
            taskResult: { success: true },
            projectId: 'project-1',
            generatedTaskId: 'generated-task-1',
            activatorUserId: 'user-1',
            activatorData: { name: 'Karsten' },
        }

        await expect(__private__.finalizeGeneratedAssistantTask(input, completeTask)).resolves.toEqual({
            success: true,
        })
        expect(completeTask).toHaveBeenCalledWith('project-1', 'generated-task-1', 'user-1', input.activatorData)
    })

    test('keeps the generated task open when assistant execution is unsuccessful', async () => {
        const completeTask = jest.fn()

        await expect(
            __private__.finalizeGeneratedAssistantTask(
                {
                    taskResult: { success: false },
                    projectId: 'project-1',
                    generatedTaskId: 'generated-task-1',
                    activatorUserId: 'user-1',
                    activatorData: {},
                },
                completeTask
            )
        ).rejects.toThrow('did not return a successful execution result')
        expect(completeTask).not.toHaveBeenCalled()
    })
})
