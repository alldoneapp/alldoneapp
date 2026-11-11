const mockDocuments = new Map()
let mockId = 0
function mockApply(path, patch) {
    const data = { ...mockDocuments.get(path) }
    for (const [key, value] of Object.entries(patch)) {
        const parts = key.split('.')
        let parent = data
        for (const part of parts.slice(0, -1)) parent = parent[part] = { ...parent[part] }
        parent[parts[parts.length - 1]] = value
    }
    mockDocuments.set(path, data)
}
const mockDb = {
    doc: path => ({
        path,
        get firestore() {
            return mockDb
        },
        get: async () => ({ exists: mockDocuments.has(path), data: () => mockDocuments.get(path) }),
        set: async data => {
            mockDocuments.set(path, data)
        },
        update: async patch => mockApply(path, patch),
    }),
    collection: path => ({ doc: id => mockDb.doc(`${path}/${id}`), get: async () => ({ forEach: () => {} }) }),
    runTransaction: async run => run({ get: ref => ref.get(), update: (ref, data) => mockApply(ref.path, data) }),
    batch: () => ({ set: (ref, data) => mockDocuments.set(ref.path, data), commit: async () => {} }),
}
const mockGenerate = jest.fn()
const mockComplete = jest.fn(async ({ projectId, generatedTaskId }) => {
    mockApply(`items/${projectId}/tasks/${generatedTaskId}`, { done: true })
})
const mockCreateTask = jest.fn(async task => {
    // TaskService uses the injected ID generator.
    const id = `run-${mockId}`
    mockDocuments.set(`items/project/tasks/${id}`, { ...task, done: false })
    return { success: true, taskId: id }
})
jest.mock('firebase-admin', () => ({ firestore: () => mockDb }))
jest.mock('./assistantHelper', () => ({ getAssistantForChat: async () => ({ uid: 'assistant', allowedTools: [] }) }))
jest.mock('./assistantPreConfigTaskTopic', () => ({ generatePreConfigTaskResult: (...args) => mockGenerate(...args) }))
jest.mock('./generatedAssistantTaskCompletion', () => ({
    finalizeGeneratedAssistantTask: (...args) => mockComplete(...args),
}))
jest.mock('../Firestore/templatesFirestore', () => ({ getAssistantTasks: jest.fn() }))
jest.mock('../Firestore/generalFirestoreCloud', () => ({ getId: () => `run-${++mockId}` }))
jest.mock('../Firestore/assistantsFirestore', () => ({ GLOBAL_PROJECT_ID: 'global' }))
jest.mock('../Utils/HelperFunctionsCloud', () => ({ FEED_PUBLIC_FOR_ALL: 0, STAYWARD_COMMENT: 2 }))
jest.mock('../shared/TaskService', () => ({
    TaskService: jest.fn(() => ({ initialize: async () => {}, createAndPersistTask: mockCreateTask })),
}))

const {
    __private__: { executeAssistantTask },
} = require('./assistantRecurringTasks')
const taskPath = 'assistantTasks/project/assistant/schedule'
const statePath = 'assistantThreadState/project_tasks_run-1_assistant'
const ids = Array.from({ length: 13 }, (_, i) => `p${i}`)
const currentTask = () => ({ id: 'schedule', ...mockDocuments.get(taskPath) })

test('the real scheduler refuses false success at 6/13, resumes the same thread, then starts a fresh next occurrence', async () => {
    mockDocuments.clear()
    mockId = 0
    mockDocuments.set(taskPath, {
        name: 'Project refresh',
        prompt: 'Update every project',
        recurrence: 'weekly',
        startDate: Date.now() - 86400000,
        startTime: '10:00',
        activatorUserId: 'user',
        lastExecuted: 100,
        lastExecutedByUser: { user: 100 },
    })
    mockDocuments.set('users/user', { uid: 'user', gold: 1000, timezone: 2, displayName: 'User' })
    mockGenerate.mockImplementationOnce(async () => {
        mockDocuments.set(statePath, { projectWorkflow: { expectedIds: ids, completedIds: ids.slice(0, 6) } })
        return { success: true, commentText: 'Six of thirteen, not finished.' }
    })
    await expect(executeAssistantTask('project', 'assistant', currentTask())).rejects.toMatchObject({
        code: 'ASSISTANT_WORKFLOW_INCOMPLETE',
    })
    expect(mockComplete).not.toHaveBeenCalled()
    expect(mockDocuments.get(taskPath).executionByUser.user).toMatchObject({ status: 'failed', taskId: 'run-1' })
    expect(mockDocuments.get('items/project/tasks/run-1').done).toBe(false)

    mockGenerate.mockImplementationOnce(async (...args) => {
        expect(args[2]).toBe('run-1')
        expect(args[12].resumeScheduledWorkflow).toBe(true)
        mockDocuments.set(statePath, { projectWorkflow: { expectedIds: ids, completedIds: ids } })
        return { success: true }
    })
    await executeAssistantTask('project', 'assistant', currentTask())
    expect(mockCreateTask).toHaveBeenCalledTimes(1)
    expect(mockComplete).toHaveBeenCalledTimes(1)
    expect(mockDocuments.get(taskPath).executionStatus).toBe('succeeded')
    expect([...mockDocuments.keys()].filter(path => path.includes('/comments/'))).toEqual([
        'chatComments/project/tasks/run-1/comments/scheduled-prompt',
    ])

    mockGenerate.mockImplementationOnce(async (...args) => {
        expect(args[2]).toBe('run-3')
        expect(args[12].resumeScheduledWorkflow).toBe(false)
        return { success: true }
    })
    await executeAssistantTask('project', 'assistant', currentTask())
    expect(mockCreateTask).toHaveBeenCalledTimes(2)
    expect(mockDocuments.get(taskPath).lastGeneratedTaskId).toBe('run-3')
})

describe('the scan reserves an occurrence and the run claims what the scan wrote (2026-11-10)', () => {
    const { reserveScheduledOccurrence } = require('./scheduledAssistantContinuation')
    const taskRef = mockDb.doc(taskPath)

    beforeEach(() => {
        mockDocuments.clear()
        mockId = 0
        mockGenerate.mockReset()
        mockCreateTask.mockClear()
        mockComplete.mockClear()
        mockDocuments.set(taskPath, {
            name: 'Daily growth discovery',
            prompt: 'Daily discovery run',
            executionMode: 'direct',
            recurrence: 'everyWorkday',
            startDate: Date.now() - 86400000,
            startTime: '07:30',
            activatorUserId: 'user',
            lastExecuted: null,
        })
        mockDocuments.set('users/user', { uid: 'user', gold: 1000, timezone: 1, displayName: 'User' })
    })

    test('a queued run executes after the scan moved lastExecuted forward', async () => {
        // The scan reads first, then reserves; the run gets the snapshot it read.
        const scanned = currentTask()
        const reservedLastExecuted = await reserveScheduledOccurrence({ taskRef, userId: 'user', task: scanned })
        expect(reservedLastExecuted).toEqual(expect.any(Number))
        expect(mockDocuments.get(taskPath).lastExecutedByUser.user).toBe(reservedLastExecuted)

        mockGenerate.mockResolvedValueOnce({ success: true })
        await executeAssistantTask('project', 'assistant', scanned, null, { reservedLastExecuted })

        expect(mockGenerate).toHaveBeenCalledTimes(1)
        // Unattended, so it gets the scheduled research budget rather than the chat one.
        expect(mockGenerate.mock.calls[0][12].maxResearchCalls).toBe(
            require('./assistantResearchGuard').SCHEDULED_MAX_RESEARCH_CALLS
        )
        expect(mockCreateTask).toHaveBeenCalledTimes(1)
        expect(mockDocuments.get(taskPath).executionStatus).toBe('succeeded')
    })

    test('without the reserved value the claim refuses, which is what skipped every run', async () => {
        const scanned = currentTask()
        await reserveScheduledOccurrence({ taskRef, userId: 'user', task: scanned })

        await executeAssistantTask('project', 'assistant', scanned)

        expect(mockGenerate).not.toHaveBeenCalled()
        expect(mockCreateTask).not.toHaveBeenCalled()
    })

    test('two overlapping scans queue the occurrence once', async () => {
        const scanA = currentTask()
        const scanB = currentTask()
        const reservedA = await reserveScheduledOccurrence({ taskRef, userId: 'user', task: scanA, now: 1000 })
        const reservedB = await reserveScheduledOccurrence({ taskRef, userId: 'user', task: scanB, now: 2000 })
        expect(reservedA).toBe(1000)
        expect(reservedB).toBeNull()
    })

    test('a failed run restores the scanned lastExecuted so the next scan retries it', async () => {
        const scanned = currentTask()
        const reservedLastExecuted = await reserveScheduledOccurrence({ taskRef, userId: 'user', task: scanned })
        mockGenerate.mockResolvedValueOnce({ success: false })

        await expect(
            executeAssistantTask('project', 'assistant', scanned, null, { reservedLastExecuted })
        ).rejects.toThrow()

        const stored = mockDocuments.get(taskPath)
        expect(stored.executionByUser.user).toMatchObject({ status: 'failed' })
        expect(stored.lastExecuted).not.toBe(reservedLastExecuted)
    })
})
