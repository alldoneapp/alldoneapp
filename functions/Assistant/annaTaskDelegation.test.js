// A delegated task's VM work belongs to its workflow. When the run of its current AI step failed, a
// request the user typed restarts that run instead of ending in a refusal (2026-11-18).

const mockRetryFailedWorkflowAiRun = jest.fn()
const mockIsHumanTurn = jest.fn()
const mockEnqueueWorkflowAiRunIfNeeded = jest.fn()
const mockPlanDoneTaskReactivation = jest.fn()
const mockReactivateDoneTaskForAssistantWork = jest.fn()

jest.mock('../Tasks/workflowAiStep', () => ({
    retryFailedWorkflowAiRun: (...args) => mockRetryFailedWorkflowAiRun(...args),
    enqueueWorkflowAiRunIfNeeded: (...args) => mockEnqueueWorkflowAiRunIfNeeded(...args),
}))
jest.mock('../Tasks/doneTaskReactivation', () => ({
    planDoneTaskReactivation: (...args) => mockPlanDoneTaskReactivation(...args),
    reactivateDoneTaskForAssistantWork: (...args) => mockReactivateDoneTaskForAssistantWork(...args),
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
    mockEnqueueWorkflowAiRunIfNeeded.mockReset().mockResolvedValue('reopened-run')
    mockPlanDoneTaskReactivation.mockReset().mockResolvedValue({ targetStepId: 'build', landsOnAiStep: true })
    mockReactivateDoneTaskForAssistantWork.mockReset()
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

    test('ordinary tasks are not guarded', async () => {
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
                db: dbWithTask({ ...ordinary, done: true }),
                projectId: 'project-1',
                taskId: 'task-1',
                retryAs,
            })
        ).toBeNull()
        expect(mockRetryFailedWorkflowAiRun).not.toHaveBeenCalled()
        expect(mockReactivateDoneTaskForAssistantWork).not.toHaveBeenCalled()
    })
})

// AT-3098: the user comments on a done delegated task and the assistant wants to work on it again.
// The VM stays the workflow's to start, so the task goes back to its AI step instead of the VM
// running while the task stays Done.
describe('VM work asked for on a done delegated task', () => {
    const doneTask = (overrides = {}) =>
        delegatedTask({
            done: true,
            stepHistory: [-1, 'build', 'check', 'merge', 'test'],
            completed: 5000,
            ...overrides,
        })
    const reopenedTask = { ...doneTask(), done: false, stepHistory: [-1, 'build'], completed: 9000 }
    // The task as Firestore holds it across the guard's reads: done first, reopened afterwards.
    const dbWithReads = (...tasks) => {
        let read = 0
        return {
            doc: path => ({
                path,
                get: async () => {
                    const task = tasks[Math.min(read++, tasks.length - 1)]
                    return { exists: !!task, data: () => task }
                },
            }),
        }
    }
    const reactivation = { note: 'Fix the bug the user found', resolveEditorName: async () => 'Alldone CTO' }

    test("the owner's request reopens it into the AI step, whose workflow run then does the work", async () => {
        mockReactivateDoneTaskForAssistantWork.mockResolvedValue({
            reactivated: true,
            stepId: 'build',
            stepLabel: 'AI: please build',
            landsOnAiStep: true,
            oldTask: doneTask(),
            task: reopenedTask,
        })

        const result = await getDelegatedTaskExecution({
            db: dbWithReads(doneTask()),
            projectId: 'project-1',
            taskId: 'task-1',
            retryAs,
            reactivation,
        })

        expect(mockPlanDoneTaskReactivation).toHaveBeenCalledWith(
            expect.objectContaining({ projectId: 'project-1', taskId: 'task-1', assistantId: 'assistant-1' })
        )
        expect(mockReactivateDoneTaskForAssistantWork).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: 'project-1',
                taskId: 'task-1',
                assistantId: 'assistant-1',
                actorUserId: 'user-1',
                note: 'Fix the bug the user found',
                editorName: 'Alldone CTO',
                // Asked for in the task's own chat: no other conversation to spare the notice.
                fromConversation: null,
            })
        )
        // Enqueued at once, like a delegation start, so a second look sees the workflow working.
        expect(mockEnqueueWorkflowAiRunIfNeeded).toHaveBeenCalledWith('project-1', 'task-1', doneTask(), reopenedTask)
        expect(result).toMatchObject({
            success: true,
            taskId: 'task-1',
            status: 'workflow_step_reopened',
            stepId: 'build',
        })
        expect(result.message).toContain('AI: please build')
        expect(result.message).toContain('Do not start a VM yourself')
        expect(result.message).toContain('review steps again')
    })

    test('a request from another conversation (Anna) is named as where the move was asked for', async () => {
        mockReactivateDoneTaskForAssistantWork.mockResolvedValue({
            reactivated: true,
            stepId: 'build',
            stepLabel: 'AI: please build',
            oldTask: doneTask(),
            task: reopenedTask,
        })
        const annaRuntime = { humanTurn: true, projectId: 'private', objectType: 'topics', objectId: 'anna-daily' }

        await getDelegatedTaskExecution({
            db: dbWithReads(doneTask()),
            projectId: 'project-1',
            taskId: 'task-1',
            retryAs: { requestUserId: 'user-1', runtime: annaRuntime },
        })

        expect(mockReactivateDoneTaskForAssistantWork).toHaveBeenCalledWith(
            expect.objectContaining({
                fromConversation: { projectId: 'private', objectType: 'topics', objectId: 'anna-daily' },
            })
        )
    })

    test("another member's request does not reopen the owner's workflow, nor start a VM", async () => {
        const result = await getDelegatedTaskExecution({
            db: dbWithReads(doneTask()),
            projectId: 'project-1',
            taskId: 'task-1',
            retryAs: { requestUserId: 'colleague', runtime },
        })

        expect(mockReactivateDoneTaskForAssistantWork).not.toHaveBeenCalled()
        expect(result).toMatchObject({ success: true, status: 'task_done' })
        expect(result.message).toContain('Do not start a VM')
    })

    test('a workflow without an assistant step is not reopened for nothing', async () => {
        mockPlanDoneTaskReactivation.mockResolvedValue({ targetStepId: -1, landsOnAiStep: false })

        const result = await getDelegatedTaskExecution({
            db: dbWithReads(doneTask()),
            projectId: 'project-1',
            taskId: 'task-1',
            retryAs,
        })

        expect(mockReactivateDoneTaskForAssistantWork).not.toHaveBeenCalled()
        expect(result.status).toBe('task_done')
    })

    test('reopened by someone else meanwhile: the workflow handles it and no second VM starts', async () => {
        mockReactivateDoneTaskForAssistantWork.mockResolvedValue({ reactivated: false, reason: 'not_done' })

        const result = await getDelegatedTaskExecution({
            db: dbWithReads(doneTask(), reopenedTask),
            projectId: 'project-1',
            taskId: 'task-1',
            retryAs,
        })

        expect(mockEnqueueWorkflowAiRunIfNeeded).not.toHaveBeenCalled()
        expect(result.status).toBe('workflow_managed')
    })

    test('a task that is still done after a failed reopen is refused, never looped on', async () => {
        mockReactivateDoneTaskForAssistantWork.mockResolvedValue({ reactivated: false, reason: 'task_changed' })

        const result = await getDelegatedTaskExecution({
            db: dbWithReads(doneTask()),
            projectId: 'project-1',
            taskId: 'task-1',
            retryAs,
        })

        expect(mockReactivateDoneTaskForAssistantWork).toHaveBeenCalledTimes(1)
        expect(result.status).toBe('task_done')
    })

    test('a failed enqueue still reports the reopen; the task trigger enqueues the step', async () => {
        mockReactivateDoneTaskForAssistantWork.mockResolvedValue({
            reactivated: true,
            stepId: 'build',
            stepLabel: 'AI: please build',
            oldTask: doneTask(),
            task: reopenedTask,
        })
        mockEnqueueWorkflowAiRunIfNeeded.mockRejectedValue(new Error('Firestore unavailable'))

        const result = await getDelegatedTaskExecution({
            db: dbWithReads(doneTask()),
            projectId: 'project-1',
            taskId: 'task-1',
            retryAs,
        })

        expect(result.status).toBe('workflow_step_reopened')
    })
})

describe('resolveDelegationOrigin (AT-3096)', () => {
    const { resolveDelegationOrigin, startDelegatedTaskWorkflow } = require('./annaTaskDelegation')
    const forwarded = {
        projectId: 'cto-project',
        assistantId: 'cto',
        originProjectId: 'private-project',
        originObjectType: 'topics',
        originObjectId: 'anna-chat',
        originAssistantId: 'anna',
    }

    test('a tracked conversation is its own origin', () => {
        expect(
            resolveDelegationOrigin({
                annaConversation: true,
                projectId: 'p',
                objectType: 'topics',
                objectId: 'chat',
                assistantId: 'anna',
            })
        ).toEqual({ projectId: 'p', objectType: 'topics', objectId: 'chat', assistantId: 'anna' })
    })

    test("a delegate without a conversation reports to the caller's tracked conversation", () => {
        expect(resolveDelegationOrigin({ ...forwarded, originTracksWork: true })).toEqual({
            projectId: 'private-project',
            objectType: 'topics',
            objectId: 'anna-chat',
            assistantId: 'anna',
        })
    })

    test('an untracked caller, a task thread, or incomplete fields give no origin', () => {
        expect(resolveDelegationOrigin(forwarded)).toBeNull()
        expect(resolveDelegationOrigin({ ...forwarded, originTracksWork: 'true' })).toBeNull()
        expect(resolveDelegationOrigin({ ...forwarded, originTracksWork: true, originObjectId: '' })).toBeNull()
        // A conversation of its own that is not tracked (a task thread) stays without origin.
        expect(resolveDelegationOrigin({ ...forwarded, originTracksWork: true, objectId: 'task-thread' })).toBeNull()
        expect(resolveDelegationOrigin(null)).toBeNull()
    })

    test('the receipt records the forwarded origin so the result returns to that chat', async () => {
        const writes = []
        const db = {
            doc: path => ({
                path,
                set: async (data, options) => writes.push({ path, data, options }),
                get: async () => ({ exists: false, data: () => undefined }),
            }),
            runTransaction: async () => ({ task: {}, changed: true }),
        }
        const result = await startDelegatedTaskWorkflow({
            db,
            projectId: 'cto-project',
            taskId: 'task-9',
            ownerId: 'user-1',
            assistantId: 'cto',
            originConversation: { ...forwarded, originTracksWork: true },
            requestCommentId: 'request-1',
        })
        expect(result.status).toBe('task_changed')
        expect(writes[0]).toMatchObject({
            path: 'delegatedTaskOrigins/cto-project__task-9',
            data: {
                originProjectId: 'private-project',
                originObjectType: 'topics',
                originObjectId: 'anna-chat',
                originAssistantId: 'anna',
                requestCommentId: 'request-1',
            },
        })
    })
})
