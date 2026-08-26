const mockTaskServiceInitialize = jest.fn()
const mockUpdateAndPersistTask = jest.fn()
const mockTaskService = jest.fn().mockImplementation(() => ({
    initialize: mockTaskServiceInitialize,
    updateAndPersistTask: mockUpdateAndPersistTask,
}))
const mockTaskGet = jest.fn()
const mockUserGet = jest.fn()
const mockFirestoreDoc = jest.fn(path => ({
    get: path.startsWith('users/') ? mockUserGet : mockTaskGet,
}))
const mockFirestore = jest.fn(() => ({ doc: mockFirestoreDoc }))

jest.mock('firebase-admin', () => ({
    firestore: (...args) => mockFirestore(...args),
}))

jest.mock('../shared/TaskService', () => ({
    TaskService: mockTaskService,
}))

const { buildOnDemandAssistantTaskMetadata } = require('../shared/assistantTaskCompletionContract')
const {
    completeOnDemandAssistantTaskAfterRun,
    finalizeOnDemandAssistantTask,
} = require('./generatedAssistantTaskCompletion')

const taskMetadata = buildOnDemandAssistantTaskMetadata({ executionMode: 'direct' })
const baseTask = {
    id: 'task-1',
    creatorId: 'user-1',
    assistantId: 'assistant-1',
    userId: 'assistant-1',
    executionMode: 'direct',
    workflowTask: false,
    taskMetadata,
    done: false,
    inDone: false,
    estimations: { Open: 0 },
}
const input = {
    taskResult: { success: true },
    projectId: 'project-1',
    taskId: 'task-1',
    userId: 'user-1',
    assistantId: 'assistant-1',
    taskMetadata,
}

describe('generated on-demand assistant task completion', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockTaskServiceInitialize.mockResolvedValue(undefined)
        mockUpdateAndPersistTask.mockResolvedValue({ success: true, persisted: true, taskId: 'task-1' })
        mockTaskGet.mockResolvedValue({ exists: true, data: () => ({ ...baseTask }) })
        mockUserGet.mockResolvedValue({
            exists: true,
            data: () => ({ displayName: 'Karsten', email: 'karsten@example.com' }),
        })
    })

    test('completes a successful generated task through the shared TaskService path', async () => {
        const result = await finalizeOnDemandAssistantTask(input)

        expect(mockFirestoreDoc).toHaveBeenCalledWith('items/project-1/tasks/task-1')
        expect(mockFirestoreDoc).toHaveBeenCalledWith('users/user-1')
        expect(mockUpdateAndPersistTask).toHaveBeenCalledWith(
            expect.objectContaining({
                taskId: 'task-1',
                projectId: 'project-1',
                completed: true,
                currentTask: expect.objectContaining({ creatorId: 'user-1', done: false }),
                feedUser: expect.objectContaining({ uid: 'user-1', displayName: 'Karsten' }),
            }),
            expect.objectContaining({ userId: 'user-1', lastEditorId: 'user-1' }),
            expect.objectContaining({ projectId: 'project-1' })
        )
        expect(result).toEqual({
            status: 'succeeded',
            taskId: 'task-1',
            persisted: true,
            alreadyCompleted: false,
        })
    })

    test('is idempotent when the generated task is already done', async () => {
        mockTaskGet.mockResolvedValue({
            exists: true,
            data: () => ({ ...baseTask, done: true, inDone: true }),
        })

        await expect(finalizeOnDemandAssistantTask(input)).resolves.toEqual({
            status: 'succeeded',
            taskId: 'task-1',
            persisted: false,
            alreadyCompleted: true,
        })
        expect(mockTaskService).not.toHaveBeenCalled()
    })

    test('rejects completion when persisted provenance is missing', async () => {
        mockTaskGet.mockResolvedValue({
            exists: true,
            data: () => ({ ...baseTask, taskMetadata: { executionMode: 'direct' } }),
        })
        const logger = { error: jest.fn() }

        await expect(completeOnDemandAssistantTaskAfterRun(input, logger)).resolves.toEqual({
            status: 'rejected',
            taskId: 'task-1',
            errorCode: 'invalid_task_provenance',
        })
        expect(mockTaskService).not.toHaveBeenCalled()
        expect(logger.error).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ status: 'rejected', taskId: 'task-1' })
        )
    })

    test('rejects completion for a task created by a different user', async () => {
        mockTaskGet.mockResolvedValue({
            exists: true,
            data: () => ({ ...baseTask, creatorId: 'user-2' }),
        })

        await expect(finalizeOnDemandAssistantTask(input)).rejects.toMatchObject({
            code: 'invalid_task_provenance',
        })
        expect(mockTaskService).not.toHaveBeenCalled()
    })

    test('returns a recoverable failure when server persistence fails', async () => {
        mockUpdateAndPersistTask.mockRejectedValue(new Error('Firestore unavailable'))
        const logger = { error: jest.fn() }

        await expect(completeOnDemandAssistantTaskAfterRun(input, logger)).resolves.toEqual({
            status: 'failed',
            taskId: 'task-1',
            errorCode: 'task_completion_failed',
        })
        expect(logger.error).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ status: 'failed', errorMessage: 'Firestore unavailable' })
        )
    })

    test('does nothing for ordinary assistant prompts and unsuccessful runs', async () => {
        await expect(
            completeOnDemandAssistantTaskAfterRun({ ...input, taskMetadata: { executionMode: 'direct' } })
        ).resolves.toBeNull()
        await expect(
            completeOnDemandAssistantTaskAfterRun({ ...input, taskResult: { success: false } })
        ).resolves.toBeNull()
        expect(mockFirestoreDoc).not.toHaveBeenCalled()
    })
})
