// A delegated task's VM work belongs to its workflow. When the run of its current AI step failed, a
// request the user typed restarts that run instead of ending in a refusal (2026-11-18).

const mockRetryFailedWorkflowAiRun = jest.fn()
const mockIsHumanTurn = jest.fn()

jest.mock('../Tasks/workflowAiStep', () => ({
    retryFailedWorkflowAiRun: (...args) => mockRetryFailedWorkflowAiRun(...args),
}))
jest.mock('./workflowStepMoveTool', () => ({
    isHumanTurn: (...args) => mockIsHumanTurn(...args),
}))

const { getDelegatedTaskExecution } = require('./annaTaskDelegation')

const delegatedTask = (overrides = {}) => ({
    name: 'Improve Historical Fact of the Day',
    userId: 'user-1',
    assistantId: 'assistant-1',
    executionMode: 'workflow',
    stepHistory: [-1, 'build'],
    taskMetadata: { delegation: { ownerId: 'user-1', assistantId: 'assistant-1', requiresReview: true } },
    ...overrides,
})

const failedBuildStep = { runId: 'run-1', stepId: 'build', status: 'failed', failureReason: 'vm_interrupted' }

const dbWithTask = task => ({
    doc: path => ({
        path,
        get: async () => ({ exists: !!task, data: () => task }),
    }),
})

const runtime = {
    humanTurn: true,
    projectId: 'project-1',
    objectType: 'tasks',
    objectId: 'task-1',
    messageId: 'msg-1',
}
const retryAs = { requestUserId: 'user-1', runtime }

beforeEach(() => {
    mockRetryFailedWorkflowAiRun.mockReset().mockResolvedValue('run-2')
    mockIsHumanTurn.mockReset().mockResolvedValue(true)
})

describe('getDelegatedTaskExecution', () => {
    test('a user asking to continue restarts the failed step instead of being refused', async () => {
        const db = dbWithTask(delegatedTask({ workflowAiStatus: failedBuildStep }))

        const result = await getDelegatedTaskExecution({ db, projectId: 'project-1', taskId: 'task-1', retryAs })

        expect(mockIsHumanTurn).toHaveBeenCalledWith(db, runtime, 'user-1')
        expect(mockRetryFailedWorkflowAiRun).toHaveBeenCalledWith('project-1', 'task-1', 'user-1')
        expect(result).toMatchObject({
            success: true,
            taskId: 'task-1',
            status: 'workflow_step_restarted',
            runId: 'run-2',
        })
        expect(result.message).toContain('Do not start a VM yourself')
    })

    test('a turn the user did not type (heartbeat, email, workflow prompt) does not restart the step', async () => {
        mockIsHumanTurn.mockResolvedValue(false)
        const db = dbWithTask(delegatedTask({ workflowAiStatus: failedBuildStep }))

        const result = await getDelegatedTaskExecution({ db, projectId: 'project-1', taskId: 'task-1', retryAs })

        expect(mockRetryFailedWorkflowAiRun).not.toHaveBeenCalled()
        expect(result.status).toBe('workflow_managed')
        expect(result.message).toContain('failed')
        expect(result.message).toContain('Needs attention')
    })

    test('a step that is still running is left to the workflow', async () => {
        const db = dbWithTask(delegatedTask({ workflowAiStatus: { ...failedBuildStep, status: 'awaiting_vm' } }))

        const result = await getDelegatedTaskExecution({ db, projectId: 'project-1', taskId: 'task-1', retryAs })

        expect(mockIsHumanTurn).not.toHaveBeenCalled()
        expect(mockRetryFailedWorkflowAiRun).not.toHaveBeenCalled()
        expect(result).toMatchObject({ status: 'workflow_managed' })
        expect(result.message).not.toContain('failed')
    })

    test('a failure recorded for an earlier step does not restart the current one', async () => {
        const db = dbWithTask(
            delegatedTask({ stepHistory: [-1, 'build', 'deploy'], workflowAiStatus: failedBuildStep })
        )

        const result = await getDelegatedTaskExecution({ db, projectId: 'project-1', taskId: 'task-1', retryAs })

        expect(mockRetryFailedWorkflowAiRun).not.toHaveBeenCalled()
        expect(result.status).toBe('workflow_managed')
    })

    test('without the requesting user the guard only refuses', async () => {
        const db = dbWithTask(delegatedTask({ workflowAiStatus: failedBuildStep }))

        const result = await getDelegatedTaskExecution({ db, projectId: 'project-1', taskId: 'task-1' })

        expect(mockIsHumanTurn).not.toHaveBeenCalled()
        expect(mockRetryFailedWorkflowAiRun).not.toHaveBeenCalled()
        expect(result.status).toBe('workflow_managed')
    })

    test('a restart that cannot happen falls back to the refusal', async () => {
        mockRetryFailedWorkflowAiRun.mockRejectedValue(new Error('Only failed assistant workflow runs can be retried'))
        const db = dbWithTask(delegatedTask({ workflowAiStatus: failedBuildStep }))

        const result = await getDelegatedTaskExecution({ db, projectId: 'project-1', taskId: 'task-1', retryAs })

        expect(result.status).toBe('workflow_managed')
    })

    test('a step that is no longer an AI step (no run enqueued) falls back to the refusal', async () => {
        mockRetryFailedWorkflowAiRun.mockResolvedValue(null)
        const db = dbWithTask(delegatedTask({ workflowAiStatus: failedBuildStep }))

        const result = await getDelegatedTaskExecution({ db, projectId: 'project-1', taskId: 'task-1', retryAs })

        expect(result.status).toBe('workflow_managed')
    })

    test('an Open delegated task still asks for a workflow choice', async () => {
        const db = dbWithTask(delegatedTask({ stepHistory: [-1] }))

        const result = await getDelegatedTaskExecution({ db, projectId: 'project-1', taskId: 'task-1', retryAs })

        expect(mockRetryFailedWorkflowAiRun).not.toHaveBeenCalled()
        expect(result.status).toBe('needs_workflow_choice')
    })

    test('ordinary and finished tasks are not guarded', async () => {
        const ordinary = delegatedTask({ taskMetadata: {}, workflowAiStatus: failedBuildStep })
        expect(
            await getDelegatedTaskExecution({
                db: dbWithTask(ordinary),
                projectId: 'project-1',
                taskId: 'task-1',
                retryAs,
            })
        ).toBeNull()
        expect(
            await getDelegatedTaskExecution({
                db: dbWithTask(delegatedTask({ done: true, workflowAiStatus: failedBuildStep })),
                projectId: 'project-1',
                taskId: 'task-1',
                retryAs,
            })
        ).toBeNull()
        expect(mockRetryFailedWorkflowAiRun).not.toHaveBeenCalled()
    })
})
