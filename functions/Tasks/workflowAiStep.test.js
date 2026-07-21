const mockStore = new Map()

const makeRef = path => ({
    __path: path,
    get: async () => ({
        exists: mockStore.has(path),
        data: () => mockStore.get(path),
    }),
    set: async (data, options) => {
        mockStore.set(path, options && options.merge ? { ...(mockStore.get(path) || {}), ...data } : data)
    },
    create: async data => {
        if (mockStore.has(path)) {
            const error = new Error('Document already exists')
            error.code = 6
            throw error
        }
        mockStore.set(path, data)
    },
})

const matchesFilter = (value, { op, expected }) => {
    if (op === '==') return value === expected
    if (op === '<') return value < expected
    if (op === 'in') return expected.includes(value)
    return true
}

const collectionQuery = (collectionPath = '') => {
    const filters = []
    let orderField = null
    let maxDocs = Infinity

    const query = {
        where: jest.fn((field, op, expected) => {
            filters.push({ field, op, expected })
            return query
        }),
        orderBy: jest.fn(field => {
            orderField = field
            return query
        }),
        limit: jest.fn(count => {
            maxDocs = count
            return query
        }),
        get: jest.fn(async () => {
            let docs = [...mockStore.entries()]
                .filter(([docPath]) => docPath.startsWith(`${collectionPath}/`))
                .map(([docPath, data]) => ({
                    id: docPath.slice(collectionPath.length + 1),
                    ref: makeRef(docPath),
                    data: () => data,
                }))
                .filter(doc => filters.every(filter => matchesFilter(doc.data()[filter.field], filter)))

            if (orderField) docs.sort((a, b) => (a.data()[orderField] || 0) - (b.data()[orderField] || 0))
            docs = docs.slice(0, maxDocs)

            return { empty: docs.length === 0, size: docs.length, docs }
        }),
    }
    return query
}

const mockDb = {
    doc: jest.fn(path => makeRef(path)),
    collection: jest.fn(path => collectionQuery(path)),
    // Transactions run inline: the tests exercise the claim's decision, not Firestore's contention.
    runTransaction: jest.fn(async handler =>
        handler({
            get: async ref => ref.get(),
            set: async (ref, data, options) => ref.set(data, options),
        })
    ),
    batch: () => {
        const writes = []
        return {
            set: (ref, data, options) => writes.push({ ref, data, options }),
            commit: async () => {
                for (const { ref, data, options } of writes) await ref.set(data, options)
            },
        }
    },
}

jest.mock('firebase-admin', () => ({
    firestore: Object.assign(
        jest.fn(() => mockDb),
        { Timestamp: { now: jest.fn(() => 'ts') } }
    ),
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    OPEN_STEP: -1,
    DONE_STEP: -2,
    FEED_PUBLIC_FOR_ALL: 0,
    STAYWARD_COMMENT: 2,
    WORKSTREAM_ID_PREFIX: 'ws@',
}))

const mockGeneratePreConfigTaskResult = jest.fn(async () => ({ success: true }))
const mockEnsureChatExists = jest.fn(async () => {})

const mockPostUserRequestComment = jest.fn(async () => 'trigger-comment-1')

jest.mock('../Assistant/assistantPreConfigTaskTopic', () => ({
    generatePreConfigTaskResult: mockGeneratePreConfigTaskResult,
}))
jest.mock('../Assistant/assistantStatusHelper', () => ({ ensureChatExists: mockEnsureChatExists }))
jest.mock('../Assistant/assistantHelper', () => ({ postUserRequestComment: mockPostUserRequestComment }))

const mockCreateTaskMovedInWorkflowFeed = jest.fn(async () => {})

jest.mock('../Feeds/tasksFeeds', () => ({ createTaskMovedInWorkflowFeed: mockCreateTaskMovedInWorkflowFeed }))
jest.mock('../GlobalState/globalState', () => ({ loadFeedsGlobalState: jest.fn() }))
jest.mock('../BatchWrapper/batchWrapper', () => ({
    BatchWrapper: jest.fn(() => ({ commit: jest.fn(async () => {}) })),
}))

const {
    AWAITING_VM_TIMEOUT_MS,
    MAX_RUNS_PER_TICK,
    RUN_STATUS_AWAITING_VM,
    advanceTaskFromWorkflowStep,
    claimWorkflowAiRun,
    dispatchPendingWorkflowAiRuns,
    enqueueWorkflowAiRunIfNeeded,
    resolveAwaitingVmRuns,
    runWorkflowAiStep,
} = require('./workflowAiStep')

const PROJECT = 'p1'
const TASK = 't1'
const ASSIGNEE = 'u1'
const ASSISTANT = 'a1'
const HUMAN_REVIEWER = 'u2'

// Steps are keyed by push ids and ordered by their lexical sort.
const AI_STEP = '-AAA'
const NEXT_STEP = '-BBB'

const aiStep = () => ({
    description: 'Draft review',
    reviewerUid: ASSISTANT,
    reviewerType: 'assistant',
    aiPreConfigTaskId: null,
    aiPrompt: 'Summarize this task',
    aiVariableValues: {},
})

const humanStep = () => ({ description: 'Final approval', reviewerUid: HUMAN_REVIEWER })

const seedAssignee = (workflow = { [AI_STEP]: aiStep(), [NEXT_STEP]: humanStep() }) => {
    mockStore.set(`users/${ASSIGNEE}`, { uid: ASSIGNEE, language: 'en', workflow: { [PROJECT]: workflow } })
}

const taskOnAiStep = (overrides = {}) => ({
    id: TASK,
    userId: ASSIGNEE,
    userIds: [ASSIGNEE, ASSISTANT],
    stepHistory: [-1, AI_STEP],
    isPublicFor: [0],
    extendedName: 'Write the spec',
    ...overrides,
})

beforeEach(() => {
    mockStore.clear()
    jest.clearAllMocks()
})

describe('enqueueWorkflowAiRunIfNeeded', () => {
    const oldTask = { userId: ASSIGNEE, userIds: [ASSIGNEE], stepHistory: [-1] }

    it('enqueues a run when a task lands on an AI step', async () => {
        seedAssignee()

        const runId = await enqueueWorkflowAiRunIfNeeded(PROJECT, TASK, oldTask, taskOnAiStep({ completed: 1000 }))

        expect(runId).toBe(`${PROJECT}__${TASK}__${AI_STEP}__1000`)
        expect(mockStore.get(`workflowAiRuns/${runId}`)).toMatchObject({
            projectId: PROJECT,
            taskId: TASK,
            stepId: AI_STEP,
            assistantId: ASSISTANT,
            assigneeUserId: ASSIGNEE,
            status: 'pending',
        })
    })

    it('is idempotent, so a redelivered task update does not pay for the run twice', async () => {
        seedAssignee()
        const newTask = taskOnAiStep({ completed: 1000 })

        const first = await enqueueWorkflowAiRunIfNeeded(PROJECT, TASK, oldTask, newTask)
        const second = await enqueueWorkflowAiRunIfNeeded(PROJECT, TASK, oldTask, newTask)

        expect(first).not.toBeNull()
        expect(second).toBeNull()
    })

    it('stays idempotent when the move left no completed stamp', async () => {
        seedAssignee()
        const newTask = taskOnAiStep()
        delete newTask.completed

        const first = await enqueueWorkflowAiRunIfNeeded(PROJECT, TASK, oldTask, newTask)
        const second = await enqueueWorkflowAiRunIfNeeded(PROJECT, TASK, oldTask, newTask)

        expect(first).toBe(`${PROJECT}__${TASK}__${AI_STEP}__s2`)
        expect(second).toBeNull()
    })

    it('skips subtasks, which mirror their parent stepHistory', async () => {
        seedAssignee()

        const runId = await enqueueWorkflowAiRunIfNeeded(
            PROJECT,
            'sub1',
            oldTask,
            taskOnAiStep({ parentId: TASK, completed: 1000 })
        )

        expect(runId).toBeNull()
    })

    it('skips when the step is reviewed by a human', async () => {
        seedAssignee({ [AI_STEP]: humanStep(), [NEXT_STEP]: humanStep() })

        expect(await enqueueWorkflowAiRunIfNeeded(PROJECT, TASK, oldTask, taskOnAiStep())).toBeNull()
    })

    it('skips when the current step did not change', async () => {
        seedAssignee()
        const task = taskOnAiStep()

        expect(await enqueueWorkflowAiRunIfNeeded(PROJECT, TASK, task, task)).toBeNull()
    })

    it('skips workstream-assigned tasks, which have no personal workflow', async () => {
        seedAssignee()

        const runId = await enqueueWorkflowAiRunIfNeeded(PROJECT, TASK, oldTask, taskOnAiStep({ userId: 'ws@default' }))

        expect(runId).toBeNull()
    })
})

describe('advanceTaskFromWorkflowStep', () => {
    it('hands the task to the next step reviewer', async () => {
        const workflow = { [AI_STEP]: aiStep(), [NEXT_STEP]: humanStep() }

        const next = await advanceTaskFromWorkflowStep(PROJECT, TASK, taskOnAiStep(), AI_STEP, workflow)

        expect(next).toBe(NEXT_STEP)
        const saved = mockStore.get(`items/${PROJECT}/tasks/${TASK}`)
        expect(saved.currentReviewerId).toBe(HUMAN_REVIEWER)
        expect(saved.stepHistory).toEqual([-1, AI_STEP, NEXT_STEP])
        expect(saved.userIds).toEqual([ASSIGNEE, ASSISTANT, HUMAN_REVIEWER])
        expect(saved.done).toBe(false)
    })

    it('completes the task when the AI step is the last one', async () => {
        const workflow = { [AI_STEP]: aiStep() }

        const next = await advanceTaskFromWorkflowStep(PROJECT, TASK, taskOnAiStep(), AI_STEP, workflow)

        expect(next).toBe(-2)
        const saved = mockStore.get(`items/${PROJECT}/tasks/${TASK}`)
        expect(saved.currentReviewerId).toBe(-2)
        expect(saved.done).toBe(true)
        expect(saved.inDone).toBe(true)
        expect(saved.userIds).toEqual([ASSIGNEE])
    })

    it('propagates completion to subtasks', async () => {
        const workflow = { [AI_STEP]: aiStep() }

        await advanceTaskFromWorkflowStep(PROJECT, TASK, taskOnAiStep({ subtaskIds: ['sub1'] }), AI_STEP, workflow)

        expect(mockStore.get(`items/${PROJECT}/tasks/sub1`)).toMatchObject({ parentDone: true, inDone: true })
    })

    it('records the move in the activity feed, attributed to the assistant', async () => {
        const workflow = { [AI_STEP]: aiStep(), [NEXT_STEP]: humanStep() }

        await advanceTaskFromWorkflowStep(PROJECT, TASK, taskOnAiStep(), AI_STEP, workflow)

        const [, , , fromStep, toStep, , feedUser] = mockCreateTaskMovedInWorkflowFeed.mock.calls[0]
        expect(fromStep).toEqual({ description: 'Draft review', userId: ASSISTANT })
        expect(toStep).toEqual({ description: 'Final approval', userId: HUMAN_REVIEWER })
        expect(feedUser).toEqual({ uid: ASSISTANT })
    })

    it('leaves the task alone when the step is gone from the workflow', async () => {
        const next = await advanceTaskFromWorkflowStep(PROJECT, TASK, taskOnAiStep(), AI_STEP, {
            [NEXT_STEP]: humanStep(),
        })

        expect(next).toBeNull()
        expect(mockStore.has(`items/${PROJECT}/tasks/${TASK}`)).toBe(false)
    })
})

describe('runWorkflowAiStep', () => {
    const run = { projectId: PROJECT, taskId: TASK, stepId: AI_STEP, assistantId: ASSISTANT, assigneeUserId: ASSIGNEE }
    const RUN_ID = 'run1'

    beforeEach(() => {
        seedAssignee()
        mockStore.set(`items/${PROJECT}/tasks/${TASK}`, taskOnAiStep())
    })

    it('runs the assistant against the task and moves it on', async () => {
        await runWorkflowAiStep(RUN_ID, run)

        expect(mockEnsureChatExists).toHaveBeenCalledWith(PROJECT, 'tasks', TASK, ASSISTANT, expect.any(Array), [0])

        const args = mockGeneratePreConfigTaskResult.mock.calls[0]
        expect(args[0]).toBe(ASSIGNEE) // the assignee owns the workflow, so the assignee pays
        expect(args[2]).toBe(TASK)
        expect(args[5]).toBe(ASSISTANT)
        expect(args[6]).toBe('Summarize this task')
        expect(args[11]).toBe('tasks')

        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBe(HUMAN_REVIEWER)
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`).status).toBe('completed')
    })

    it('reactivates the workflow assistant on both task and chat for the next step comment', async () => {
        mockStore.set(
            `items/${PROJECT}/tasks/${TASK}`,
            taskOnAiStep({ assistantId: 'previous-assistant', isAssistantEnabled: false })
        )
        mockStore.set(`chatObjects/${PROJECT}/chats/${TASK}`, {
            assistantId: 'previous-assistant',
            isAssistantEnabled: false,
            title: 'Write the spec',
        })

        await runWorkflowAiStep(RUN_ID, run)

        expect(mockGeneratePreConfigTaskResult).toHaveBeenCalledTimes(1)
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`)).toMatchObject({
            assistantId: ASSISTANT,
            isAssistantEnabled: true,
            currentReviewerId: HUMAN_REVIEWER,
        })
        expect(mockStore.get(`chatObjects/${PROJECT}/chats/${TASK}`)).toMatchObject({
            assistantId: ASSISTANT,
            isAssistantEnabled: true,
            title: 'Write the spec',
        })
    })

    it('grounds the run in the task by seeding the thread with the prompt', async () => {
        await runWorkflowAiStep(RUN_ID, run)

        // Posted as the workflow owner, so it reads as their request and the user can see what the
        // step asked.
        expect(mockPostUserRequestComment).toHaveBeenCalledWith({
            projectId: PROJECT,
            objectType: 'tasks',
            objectId: TASK,
            creatorId: ASSIGNEE,
            text: 'Summarize this task',
        })

        // The trigger message is what makes generatePreConfigTaskResult assemble the full task and
        // thread context instead of running on the bare prompt.
        expect(mockGeneratePreConfigTaskResult.mock.calls[0][12]).toEqual({
            triggerMessageId: 'trigger-comment-1',
        })
    })

    it('still runs when the thread could not be seeded', async () => {
        mockPostUserRequestComment.mockRejectedValueOnce(new Error('firestore unavailable'))

        await runWorkflowAiStep(RUN_ID, run)

        expect(mockGeneratePreConfigTaskResult).toHaveBeenCalledTimes(1)
        expect(mockGeneratePreConfigTaskResult.mock.calls[0][12]).toEqual({ triggerMessageId: null })
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`).status).toBe('completed')
    })

    it('substitutes $variable values captured when the step was configured', async () => {
        seedAssignee({
            [AI_STEP]: { ...aiStep(), aiPrompt: 'Review for $AUDIENCE', aiVariableValues: { AUDIENCE: 'execs' } },
            [NEXT_STEP]: humanStep(),
        })

        await runWorkflowAiStep(RUN_ID, run)

        expect(mockGeneratePreConfigTaskResult.mock.calls[0][6]).toBe('Review for execs')
    })

    it('still advances the task when the assistant run fails', async () => {
        mockGeneratePreConfigTaskResult.mockRejectedValueOnce(new Error('out of gold'))

        await runWorkflowAiStep(RUN_ID, run)

        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBe(HUMAN_REVIEWER)
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`)).toMatchObject({
            status: 'failed',
            failureReason: 'out of gold',
        })
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).isAssistantEnabled).toBeUndefined()
        expect(mockStore.has(`chatObjects/${PROJECT}/chats/${TASK}`)).toBe(false)
    })

    it('does not run or advance when the task already moved off the step', async () => {
        mockStore.set(`items/${PROJECT}/tasks/${TASK}`, taskOnAiStep({ stepHistory: [-1, AI_STEP, NEXT_STEP] }))

        await runWorkflowAiStep(RUN_ID, run)

        expect(mockGeneratePreConfigTaskResult).not.toHaveBeenCalled()
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`)).toMatchObject({ status: 'skipped', reason: 'task_moved' })
    })

    it('does not move the task back when it is moved away mid-run', async () => {
        mockGeneratePreConfigTaskResult.mockImplementationOnce(async () => {
            // A human (or the assistant's own update_task) moves the task while the run is in flight.
            mockStore.set(`items/${PROJECT}/tasks/${TASK}`, taskOnAiStep({ stepHistory: [-1] }))
            return { success: true }
        })

        await runWorkflowAiStep(RUN_ID, run)

        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).stepHistory).toEqual([-1])
    })

    it('advances without running anything when the step is no longer an AI step', async () => {
        seedAssignee({ [AI_STEP]: humanStep(), [NEXT_STEP]: humanStep() })

        await runWorkflowAiStep(RUN_ID, run)

        expect(mockGeneratePreConfigTaskResult).not.toHaveBeenCalled()
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBe(HUMAN_REVIEWER)
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`)).toMatchObject({
            status: 'failed',
            failureReason: 'step_no_longer_ai',
        })
    })
})

describe('dispatchPendingWorkflowAiRuns', () => {
    const seedRun = (runId, overrides = {}) => {
        mockStore.set(`workflowAiRuns/${runId}`, {
            projectId: PROJECT,
            taskId: TASK,
            stepId: AI_STEP,
            assistantId: ASSISTANT,
            assigneeUserId: ASSIGNEE,
            status: 'pending',
            createdAt: 1000,
            ...overrides,
        })
    }

    beforeEach(() => {
        seedAssignee()
        mockStore.set(`items/${PROJECT}/tasks/${TASK}`, taskOnAiStep())
    })

    it('runs a queued run and settles it', async () => {
        seedRun('run1')

        const dispatched = await dispatchPendingWorkflowAiRuns()

        expect(dispatched).toBe(1)
        expect(mockGeneratePreConfigTaskResult).toHaveBeenCalledTimes(1)
        expect(mockStore.get('workflowAiRuns/run1').status).toBe('completed')
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBe(HUMAN_REVIEWER)
    })

    it('leaves alone a run another tick is already working on', async () => {
        // Ticks overlap: the schedule fires every minute and a run can last most of an hour.
        seedRun('run1', { status: 'running', leaseOwner: 'other-tick' })

        const dispatched = await dispatchPendingWorkflowAiRuns()

        expect(dispatched).toBe(0)
        expect(mockGeneratePreConfigTaskResult).not.toHaveBeenCalled()
        expect(mockStore.get('workflowAiRuns/run1').leaseOwner).toBe('other-tick')
    })

    it('takes no more than one tick of work, leaving the rest for the next tick', async () => {
        for (let i = 0; i < MAX_RUNS_PER_TICK + 3; i++) seedRun(`run${i}`, { createdAt: 1000 + i })

        const dispatched = await dispatchPendingWorkflowAiRuns()

        expect(dispatched).toBe(MAX_RUNS_PER_TICK)
        const stillPending = [...mockStore.entries()].filter(
            ([path, data]) => path.startsWith('workflowAiRuns/') && data.status === 'pending'
        )
        expect(stillPending).toHaveLength(3)
    })

    it('claims the oldest runs first', async () => {
        seedRun('newest', { createdAt: 3000 })
        seedRun('oldest', { createdAt: 1000 })

        await dispatchPendingWorkflowAiRuns()

        expect(mockStore.get('workflowAiRuns/oldest').status).toBe('completed')
    })

    it('does nothing when there is no queued work', async () => {
        expect(await dispatchPendingWorkflowAiRuns()).toBe(0)
        expect(mockGeneratePreConfigTaskResult).not.toHaveBeenCalled()
    })
})

describe('claimWorkflowAiRun', () => {
    const runRef = () => mockDb.doc('workflowAiRuns/run1')

    it('takes the lease exactly once, so overlapping ticks cannot double-run a step', async () => {
        mockStore.set('workflowAiRuns/run1', { status: 'pending', createdAt: 1000 })

        expect(await claimWorkflowAiRun(runRef(), 'tick-a', 5000)).toMatchObject({ status: 'pending' })
        expect(await claimWorkflowAiRun(runRef(), 'tick-b', 6000)).toBeNull()

        expect(mockStore.get('workflowAiRuns/run1')).toMatchObject({ status: 'running', leaseOwner: 'tick-a' })
    })

    it('returns null for a run that no longer exists', async () => {
        expect(await claimWorkflowAiRun(runRef(), 'tick-a', 5000)).toBeNull()
    })
})

describe('a step whose assistant dispatched VM work', () => {
    const RUN_ID = 'run-vm'
    const CORRELATION = 'vm-correlation-1'
    const run = { projectId: PROJECT, taskId: TASK, stepId: AI_STEP, assistantId: ASSISTANT, assigneeUserId: ASSIGNEE }

    const seedVmJob = (status, overrides = {}) => {
        mockStore.set(`pendingWebhooks/${CORRELATION}`, {
            kind: 'vm_job',
            projectId: PROJECT,
            objectId: TASK,
            createdAt: Date.now(),
            status,
            ...overrides,
        })
    }

    beforeEach(() => {
        seedAssignee()
        mockStore.set(`items/${PROJECT}/tasks/${TASK}`, taskOnAiStep())
        // As enqueueWorkflowAiRunIfNeeded writes it: resolveAwaitingVmRuns picks the run back up from
        // this doc alone, so it has to carry the same fields in the test as it does in production.
        mockStore.set(`workflowAiRuns/${RUN_ID}`, { ...run, status: 'running', createdAt: 1000 })
        // execute_task_in_vm enqueues the job during the assistant run and returns immediately.
        mockGeneratePreConfigTaskResult.mockImplementationOnce(async () => {
            seedVmJob('initiated')
            return { success: true }
        })
    })

    it('holds the task on the step instead of advancing while the VM runs', async () => {
        await runWorkflowAiStep(RUN_ID, run)

        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBeUndefined()
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`)).toMatchObject({
            status: RUN_STATUS_AWAITING_VM,
            awaitingCorrelationIds: [CORRELATION],
        })
    })

    it('keeps waiting while the VM job is still going', async () => {
        await runWorkflowAiStep(RUN_ID, run)

        expect(await resolveAwaitingVmRuns({ now: Date.now() })).toBe(0)
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBeUndefined()
    })

    it('advances the step once the VM job completes', async () => {
        await runWorkflowAiStep(RUN_ID, run)
        seedVmJob('completed')

        expect(await resolveAwaitingVmRuns({ now: Date.now() })).toBe(1)

        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBe(HUMAN_REVIEWER)
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`).status).toBe('completed')
    })

    it('advances anyway when the VM job failed', async () => {
        await runWorkflowAiStep(RUN_ID, run)
        seedVmJob('failed')

        await resolveAwaitingVmRuns({ now: Date.now() })

        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBe(HUMAN_REVIEWER)
    })

    it('gives up and advances once the VM has had its full budget', async () => {
        await runWorkflowAiStep(RUN_ID, run)

        // Still 'initiated' well past the point a healthy VM job must have settled.
        await resolveAwaitingVmRuns({ now: Date.now() + AWAITING_VM_TIMEOUT_MS + 1000 })

        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBe(HUMAN_REVIEWER)
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`)).toMatchObject({
            status: 'failed',
            failureReason: 'vm_timeout',
        })
    })

    it('settles normally when the step dispatched no VM work', async () => {
        mockGeneratePreConfigTaskResult.mockReset()
        mockGeneratePreConfigTaskResult.mockResolvedValue({ success: true })

        await runWorkflowAiStep(RUN_ID, run)

        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`).status).toBe('completed')
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBe(HUMAN_REVIEWER)
    })
})

describe('a VM job that stops to ask the user a question', () => {
    const RUN_ID = 'run-vm-question'
    const CORRELATION = 'vm-correlation-q'
    const run = { projectId: PROJECT, taskId: TASK, stepId: AI_STEP, assistantId: ASSISTANT, assigneeUserId: ASSIGNEE }

    // vmInteraction gives a question 24h to be answered, far beyond the plain VM run budget.
    const INTERACTION_TTL_MS = 24 * 60 * 60 * 1000

    const seedVmJob = (status, extra = {}) => {
        mockStore.set(`pendingWebhooks/${CORRELATION}`, {
            kind: 'vm_job',
            projectId: PROJECT,
            objectId: TASK,
            createdAt: Date.now(),
            status,
            ...extra,
        })
    }

    beforeEach(async () => {
        seedAssignee()
        mockStore.set(`items/${PROJECT}/tasks/${TASK}`, taskOnAiStep())
        mockStore.set(`workflowAiRuns/${RUN_ID}`, { ...run, status: 'running', createdAt: 1000 })
        mockGeneratePreConfigTaskResult.mockImplementationOnce(async () => {
            seedVmJob('initiated')
            return { success: true }
        })
        await runWorkflowAiStep(RUN_ID, run)
    })

    it('keeps waiting past the plain VM budget while the question is still answerable', async () => {
        seedVmJob('awaiting_user', { interactionExpiresAt: Date.now() + INTERACTION_TTL_MS })

        // Well past awaitingUntil, which on its own would have abandoned the step.
        const wellPastVmBudget = Date.now() + AWAITING_VM_TIMEOUT_MS + 60 * 1000
        expect(await resolveAwaitingVmRuns({ now: wellPastVmBudget })).toBe(0)

        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBeUndefined()
    })

    it('advances once the question expired and the job still has not settled', async () => {
        const expiredAt = Date.now() - 1000
        seedVmJob('awaiting_user', { interactionExpiresAt: expiredAt })

        await resolveAwaitingVmRuns({ now: expiredAt + AWAITING_VM_TIMEOUT_MS + 1000 })

        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBe(HUMAN_REVIEWER)
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`).failureReason).toBe('vm_timeout')
    })

    it('advances as soon as an answered question lets the job finish', async () => {
        seedVmJob('awaiting_user', { interactionExpiresAt: Date.now() + INTERACTION_TTL_MS })
        expect(await resolveAwaitingVmRuns({ now: Date.now() })).toBe(0)

        // The user answers, the VM resumes and completes.
        seedVmJob('completed', { interactionExpiresAt: 0 })

        expect(await resolveAwaitingVmRuns({ now: Date.now() })).toBe(1)
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBe(HUMAN_REVIEWER)
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`).status).toBe('completed')
    })

    it('still abandons a job that simply hangs, with no interaction to justify waiting', async () => {
        seedVmJob('initiated')

        await resolveAwaitingVmRuns({ now: Date.now() + AWAITING_VM_TIMEOUT_MS + 1000 })

        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBe(HUMAN_REVIEWER)
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`).failureReason).toBe('vm_timeout')
    })
})
