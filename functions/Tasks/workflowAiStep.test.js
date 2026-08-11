const mockStore = new Map()

const makeRef = path => ({
    __path: path,
    path,
    id: path.split('/').pop(),
    get firestore() {
        return mockDb
    },
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
    resolveWorkflowRunsForAssistantRunUpdate,
    resolveWorkflowRunsForSettledVmJob,
    retryFailedWorkflowAiRun,
    runWorkflowAiStep,
} = require('./workflowAiStep')
const { SCHEDULED_PROMPT_MAX_RUN_WALL_CLOCK_MS } = require('../Assistant/assistantRunLimits')

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

    it('copies the persisted popup comment into the run for this AI-step entry', async () => {
        seedAssignee()
        const newTask = taskOnAiStep({
            completed: 1000,
            workflowAiPromptOverride: {
                stepId: AI_STEP,
                prompt: 'Rewrite this as a concise memo',
                triggerMessageId: 'popup-comment-1',
            },
        })

        const runId = await enqueueWorkflowAiRunIfNeeded(PROJECT, TASK, oldTask, newTask)

        expect(mockStore.get(`workflowAiRuns/${runId}`)).toMatchObject({
            promptOverride: 'Rewrite this as a concise memo',
            triggerMessageId: 'popup-comment-1',
        })
    })

    it.each([
        ['an empty comment', { stepId: AI_STEP, prompt: '   ', triggerMessageId: 'comment-1' }],
        [
            'a comment for another step',
            { stepId: NEXT_STEP, prompt: 'Do something else', triggerMessageId: 'comment-2' },
        ],
    ])('keeps the configured prompt for %s', async (_label, workflowAiPromptOverride) => {
        seedAssignee()

        const runId = await enqueueWorkflowAiRunIfNeeded(
            PROJECT,
            TASK,
            oldTask,
            taskOnAiStep({ completed: 1000, workflowAiPromptOverride })
        )

        expect(mockStore.get(`workflowAiRuns/${runId}`)).not.toHaveProperty('promptOverride')
        expect(mockStore.get(`workflowAiRuns/${runId}`)).not.toHaveProperty('triggerMessageId')
    })

    it('enqueues a creator-funded run from a project assistant workflow', async () => {
        mockStore.set(`assistants/${PROJECT}/items/${ASSISTANT}`, {
            uid: ASSISTANT,
            workflow: { [PROJECT]: { [AI_STEP]: aiStep(), [NEXT_STEP]: humanStep() } },
        })
        mockStore.set(`users/${ASSIGNEE}`, { uid: ASSIGNEE, language: 'en' })
        const task = taskOnAiStep({
            userId: ASSISTANT,
            userIds: [ASSISTANT],
            stepHistory: [AI_STEP],
            currentReviewerId: ASSISTANT,
            assigneeType: 'ASSISTANT',
            workflowTask: true,
            workflowPayerUserId: ASSIGNEE,
            creatorId: ASSIGNEE,
            completed: 1000,
        })

        const runId = await enqueueWorkflowAiRunIfNeeded(PROJECT, TASK, {}, task)

        expect(mockStore.get(`workflowAiRuns/${runId}`)).toMatchObject({
            assistantId: ASSISTANT,
            assigneeUserId: ASSIGNEE,
            workflowOwnerId: ASSISTANT,
            workflowOwnerType: 'assistant',
            payerUserId: ASSIGNEE,
        })
    })

    it('does not apply an assistant workflow to an ordinary assistant task', async () => {
        mockStore.set(`assistants/${PROJECT}/items/${ASSISTANT}`, {
            uid: ASSISTANT,
            workflow: { [PROJECT]: { [AI_STEP]: aiStep() } },
        })
        const task = taskOnAiStep({
            userId: ASSISTANT,
            assigneeType: 'ASSISTANT',
            workflowTask: false,
            completed: 1000,
        })

        await expect(enqueueWorkflowAiRunIfNeeded(PROJECT, TASK, {}, task)).resolves.toBeNull()
        expect(mockStore.has(`workflowAiRuns/${PROJECT}__${TASK}__${AI_STEP}__1000`)).toBe(false)
    })

    it('enqueues a new run when a task is sent back from a later step to an AI step', async () => {
        seedAssignee()
        const oldTask = {
            ...taskOnAiStep(),
            userIds: [ASSIGNEE, ASSISTANT, HUMAN_REVIEWER],
            stepHistory: [-1, AI_STEP, NEXT_STEP],
            currentReviewerId: HUMAN_REVIEWER,
            completed: 1000,
        }
        const sentBackTask = taskOnAiStep({
            completed: 2000,
            workflowAiPromptOverride: {
                stepId: AI_STEP,
                prompt: 'Use this backward-transition instruction',
                triggerMessageId: 'backward-comment',
            },
        })

        const runId = await enqueueWorkflowAiRunIfNeeded(PROJECT, TASK, oldTask, sentBackTask)

        expect(runId).toBe(`${PROJECT}__${TASK}__${AI_STEP}__2000`)
        expect(mockStore.get(`workflowAiRuns/${runId}`)).toMatchObject({
            stepId: AI_STEP,
            assistantId: ASSISTANT,
            promptOverride: 'Use this backward-transition instruction',
            triggerMessageId: 'backward-comment',
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

    // Whether the assistant is already working the task is decided here, when the task lands on the
    // step, not a minute later in the dispatcher. A VM job stays live for hours so the dispatcher
    // always still saw it; a normal assistant answer is usually over within that minute, and the
    // step then posted its configured prompt straight after the answer the user had just read.
    describe('when the task already has live AI work', () => {
        const liveChatRun = (lockId = 'comment-run-1', overrides = {}) => {
            mockStore.set(`assistantRunLocks/${lockId}`, {
                projectId: PROJECT,
                objectType: 'tasks',
                objectId: TASK,
                status: 'running',
                lockExpiresAt: Date.now() + 60_000,
                ...overrides,
            })
        }

        const liveVmJob = (correlationId = 'live-vm-run', overrides = {}) => {
            mockStore.set(`pendingWebhooks/${correlationId}`, {
                kind: 'vm_job',
                projectId: PROJECT,
                objectType: 'tasks',
                objectId: TASK,
                status: 'running',
                createdAt: Date.now() - 1000,
                ...overrides,
            })
        }

        beforeEach(() => {
            seedAssignee()
            mockStore.set(`items/${PROJECT}/tasks/${TASK}`, taskOnAiStep())
        })

        it('parks the run instead of queueing the configured prompt behind a normal assistant answer', async () => {
            liveChatRun()

            const runId = await enqueueWorkflowAiRunIfNeeded(PROJECT, TASK, oldTask, taskOnAiStep({ completed: 1000 }))

            expect(mockStore.get(`workflowAiRuns/${runId}`)).toMatchObject({
                status: RUN_STATUS_AWAITING_VM,
                awaitingAssistantRunIds: ['comment-run-1'],
                awaitingCorrelationIds: [],
                awaitingSkipReason: 'task_ai_run_already_active',
            })
            expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).workflowAiStatus).toMatchObject({
                runId,
                stepId: AI_STEP,
                status: RUN_STATUS_AWAITING_VM,
            })
        })

        it('keeps the parked run away from the dispatcher, so the configured prompt is never posted', async () => {
            liveChatRun()
            await enqueueWorkflowAiRunIfNeeded(PROJECT, TASK, oldTask, taskOnAiStep({ completed: 1000 }))

            // The answer finishes inside the poller's one-minute gap — the window the bug lived in.
            mockStore.set('assistantRunLocks/comment-run-1', {
                ...mockStore.get('assistantRunLocks/comment-run-1'),
                status: 'completed',
            })

            expect(await dispatchPendingWorkflowAiRuns({ now: Date.now() })).toBe(0)
            expect(mockPostUserRequestComment).not.toHaveBeenCalled()
            expect(mockGeneratePreConfigTaskResult).not.toHaveBeenCalled()
        })

        it('advances the step when the live answer finishes, without ever using the configured prompt', async () => {
            liveChatRun()
            const runId = await enqueueWorkflowAiRunIfNeeded(PROJECT, TASK, oldTask, taskOnAiStep({ completed: 1000 }))

            const lock = { projectId: PROJECT, objectType: 'tasks', objectId: TASK }
            mockStore.set('assistantRunLocks/comment-run-1', { ...lock, status: 'completed', lockExpiresAt: 0 })
            await resolveWorkflowRunsForAssistantRunUpdate(
                { ...lock, status: 'running' },
                { ...lock, status: 'completed' }
            )

            expect(mockGeneratePreConfigTaskResult).not.toHaveBeenCalled()
            expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBe(HUMAN_REVIEWER)
            expect(mockStore.get(`workflowAiRuns/${runId}`)).toMatchObject({
                status: 'skipped',
                reason: 'task_ai_run_already_active',
            })
        })

        it('parks the run behind a live VM job too', async () => {
            liveVmJob()

            const runId = await enqueueWorkflowAiRunIfNeeded(PROJECT, TASK, oldTask, taskOnAiStep({ completed: 1000 }))

            expect(mockStore.get(`workflowAiRuns/${runId}`)).toMatchObject({
                status: RUN_STATUS_AWAITING_VM,
                awaitingCorrelationIds: ['live-vm-run'],
                awaitingSkipReason: 'task_ai_run_already_active',
            })
        })

        // Only live work blocks a step. Anything already settled is history, not a reason to drop
        // the action the step was configured to perform.
        it.each([
            ['a finished assistant answer', () => liveChatRun('comment-run-1', { status: 'completed' })],
            ['an expired assistant lock', () => liveChatRun('comment-run-1', { lockExpiresAt: Date.now() - 1 })],
            ['an answer in another project', () => liveChatRun('comment-run-1', { projectId: 'other-project' })],
            ['a terminal VM job', () => liveVmJob('live-vm-run', { status: 'completed' })],
        ])('keeps the configured prompt when the task only has %s', async (_label, seedWork) => {
            seedWork()

            const runId = await enqueueWorkflowAiRunIfNeeded(PROJECT, TASK, oldTask, taskOnAiStep({ completed: 1000 }))

            expect(mockStore.get(`workflowAiRuns/${runId}`).status).toBe('pending')
            expect(await dispatchPendingWorkflowAiRuns({ now: Date.now() })).toBe(1)
            expect(mockGeneratePreConfigTaskResult.mock.calls[0][6]).toBe('Summarize this task')
            expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBe(HUMAN_REVIEWER)
        })

        // An AI step advances the task from inside its own run, so its coarse task slot is still
        // held when the next step is enqueued. Parking on that would stall every AI→AI workflow.
        it('does not park behind the AI step that just handed the task over', async () => {
            mockStore.set(`assistantTaskRunLocks/${PROJECT}__tasks__${TASK}`, {
                projectId: PROJECT,
                objectType: 'tasks',
                objectId: TASK,
                ownerId: 'previous-step-run',
                kind: 'workflow',
                workflowStepId: NEXT_STEP,
                status: 'running',
                lockExpiresAt: Date.now() + 60_000,
            })

            const runId = await enqueueWorkflowAiRunIfNeeded(PROJECT, TASK, oldTask, taskOnAiStep({ completed: 1000 }))

            expect(mockStore.get(`workflowAiRuns/${runId}`).status).toBe('pending')
        })
    })
})

describe('retryFailedWorkflowAiRun', () => {
    it('queues a fresh run without moving the task off the assistant step', async () => {
        seedAssignee()
        mockStore.set(
            `items/${PROJECT}/tasks/${TASK}`,
            taskOnAiStep({ workflowAiStatus: { status: 'failed', runId: 'old-run', stepId: AI_STEP } })
        )

        const runId = await retryFailedWorkflowAiRun(PROJECT, TASK)

        expect(runId).toContain(`${PROJECT}__${TASK}__${AI_STEP}__`)
        expect(mockStore.get(`workflowAiRuns/${runId}`)).toMatchObject({
            projectId: PROJECT,
            taskId: TASK,
            stepId: AI_STEP,
            status: 'pending',
        })
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`)).toMatchObject({
            stepHistory: [-1, AI_STEP],
            workflowAiStatus: { status: 'pending', runId, stepId: AI_STEP },
        })
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

    it('replaces the configured prompt with the persisted popup comment without posting it twice', async () => {
        const overrideRun = {
            ...run,
            promptOverride: 'Use $AUDIENCE and only the popup request',
            triggerMessageId: 'popup-comment-1',
        }

        await runWorkflowAiStep(RUN_ID, overrideRun)

        expect(mockGeneratePreConfigTaskResult.mock.calls[0][6]).toBe('Use $AUDIENCE and only the popup request')
        expect(mockGeneratePreConfigTaskResult.mock.calls[0][12]).toEqual({
            triggerMessageId: 'popup-comment-1',
            maxRunWallClockMs: SCHEDULED_PROMPT_MAX_RUN_WALL_CLOCK_MS,
        })
        expect(mockPostUserRequestComment).not.toHaveBeenCalled()
    })

    it('loads an assistant-owned workflow while charging the creating project member', async () => {
        mockStore.set(`assistants/${PROJECT}/items/${ASSISTANT}`, {
            uid: ASSISTANT,
            workflow: { [PROJECT]: { [AI_STEP]: aiStep(), [NEXT_STEP]: humanStep() } },
        })
        mockStore.set(`users/${ASSIGNEE}`, { uid: ASSIGNEE, language: 'de' })
        mockStore.set(
            `items/${PROJECT}/tasks/${TASK}`,
            taskOnAiStep({
                userId: ASSISTANT,
                userIds: [ASSISTANT],
                stepHistory: [AI_STEP],
                workflowTask: true,
                workflowPayerUserId: ASSIGNEE,
            })
        )

        await runWorkflowAiStep(RUN_ID, {
            ...run,
            workflowOwnerId: ASSISTANT,
            workflowOwnerType: 'assistant',
            payerUserId: ASSIGNEE,
        })

        const args = mockGeneratePreConfigTaskResult.mock.calls[0]
        expect(args[0]).toBe(ASSIGNEE)
        expect(args[7]).toBe('de')
        expect(mockPostUserRequestComment).toHaveBeenCalledWith(expect.objectContaining({ creatorId: ASSIGNEE }))
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBe(HUMAN_REVIEWER)
    })

    it('parks in the pre-VM window when a chat-triggered assistant run already owns the task', async () => {
        mockStore.set(`assistantTaskRunLocks/${PROJECT}__tasks__${TASK}`, {
            projectId: PROJECT,
            objectType: 'tasks',
            objectId: TASK,
            ownerId: 'comment-run-1',
            kind: 'chat',
            status: 'running',
            lockExpiresAt: Date.now() + 60_000,
        })
        mockStore.set('assistantRunLocks/comment-run-1', {
            projectId: PROJECT,
            objectType: 'tasks',
            objectId: TASK,
            status: 'starting',
            lockExpiresAt: Date.now() + 60_000,
        })

        await runWorkflowAiStep(RUN_ID, run)

        expect(mockPostUserRequestComment).not.toHaveBeenCalled()
        expect(mockGeneratePreConfigTaskResult).not.toHaveBeenCalled()
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBeUndefined()
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`)).toMatchObject({
            status: RUN_STATUS_AWAITING_VM,
            awaitingAssistantRunIds: ['comment-run-1'],
            awaitingCorrelationIds: [],
            awaitingSkipReason: 'task_ai_run_already_active',
        })
    })

    it('keeps waiting when a pre-VM chat run creates its VM, then advances after both settle', async () => {
        mockStore.set(`workflowAiRuns/${RUN_ID}`, { ...run, status: 'running', createdAt: 1000 })
        mockStore.set(`assistantTaskRunLocks/${PROJECT}__tasks__${TASK}`, {
            projectId: PROJECT,
            objectType: 'tasks',
            objectId: TASK,
            ownerId: 'comment-run-1',
            kind: 'chat',
            status: 'running',
            lockExpiresAt: Date.now() + 60_000,
        })
        mockStore.set('assistantRunLocks/comment-run-1', {
            projectId: PROJECT,
            objectType: 'tasks',
            objectId: TASK,
            status: 'queued',
            lockExpiresAt: Date.now() + 60_000,
        })

        await runWorkflowAiStep(RUN_ID, run)

        // No VM exists yet: the assistant execution itself keeps the step open.
        expect(await resolveAwaitingVmRuns({ now: Date.now() })).toBe(0)

        // execute_task_in_vm persists the VM before the chat run can report completion.
        mockStore.set('pendingWebhooks/chat-vm-run', {
            kind: 'vm_job',
            projectId: PROJECT,
            objectType: 'tasks',
            objectId: TASK,
            status: 'pending',
            createdAt: Date.now(),
        })
        mockStore.set('assistantRunLocks/comment-run-1', {
            ...mockStore.get('assistantRunLocks/comment-run-1'),
            status: 'completed',
        })
        mockStore.set(`assistantTaskRunLocks/${PROJECT}__tasks__${TASK}`, {
            ...mockStore.get(`assistantTaskRunLocks/${PROJECT}__tasks__${TASK}`),
            status: 'released',
            lockExpiresAt: 0,
        })

        // The assistant lock has settled, but its VM has taken over as the blocker.
        expect(await resolveAwaitingVmRuns({ now: Date.now() })).toBe(0)
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBeUndefined()

        mockStore.set('pendingWebhooks/chat-vm-run', {
            ...mockStore.get('pendingWebhooks/chat-vm-run'),
            status: 'completed',
        })

        expect(await resolveAwaitingVmRuns({ now: Date.now() })).toBe(1)
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBe(HUMAN_REVIEWER)
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`)).toMatchObject({
            status: 'skipped',
            reason: 'task_ai_run_already_active',
        })
    })

    it('waits when sent back to the AI step while a separate chat-triggered VM is active', async () => {
        mockStore.set('pendingWebhooks/existing-vm-run', {
            kind: 'vm_job',
            projectId: PROJECT,
            objectType: 'tasks',
            objectId: TASK,
            assistantId: 'different-chat-assistant',
            status: 'running',
            createdAt: Date.now() - 1000,
        })

        await runWorkflowAiStep(RUN_ID, run)

        expect(mockPostUserRequestComment).not.toHaveBeenCalled()
        expect(mockGeneratePreConfigTaskResult).not.toHaveBeenCalled()
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBeUndefined()
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`)).toMatchObject({
            status: RUN_STATUS_AWAITING_VM,
            awaitingCorrelationIds: ['existing-vm-run'],
            awaitingSkipReason: 'task_ai_run_already_active',
        })
    })

    it('resumes and advances only after the separate chat-triggered VM finishes', async () => {
        mockStore.set(`workflowAiRuns/${RUN_ID}`, { ...run, status: 'running', createdAt: 1000 })
        mockStore.set('pendingWebhooks/existing-vm-run', {
            kind: 'vm_job',
            projectId: PROJECT,
            objectType: 'tasks',
            objectId: TASK,
            assistantId: 'different-chat-assistant',
            status: 'running',
            createdAt: Date.now() - 1000,
        })

        await runWorkflowAiStep(RUN_ID, run)

        expect(await resolveAwaitingVmRuns({ now: Date.now() })).toBe(0)
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBeUndefined()

        mockStore.set('pendingWebhooks/existing-vm-run', {
            ...mockStore.get('pendingWebhooks/existing-vm-run'),
            status: 'completed',
        })

        expect(await resolveAwaitingVmRuns({ now: Date.now() })).toBe(1)
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBe(HUMAN_REVIEWER)
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`)).toMatchObject({
            status: 'skipped',
            reason: 'task_ai_run_already_active',
        })
    })

    it('ignores unrelated and terminal assistant executions and VM jobs', async () => {
        mockStore.set('assistantRunLocks/unrelated-run', {
            projectId: 'another-project',
            objectType: 'tasks',
            objectId: TASK,
            status: 'running',
            lockExpiresAt: Date.now() + 60_000,
        })
        mockStore.set('assistantRunLocks/terminal-run', {
            projectId: PROJECT,
            objectType: 'tasks',
            objectId: TASK,
            status: 'completed',
            lockExpiresAt: Date.now() + 60_000,
        })
        mockStore.set('pendingWebhooks/terminal-vm', {
            kind: 'vm_job',
            projectId: PROJECT,
            objectType: 'tasks',
            objectId: TASK,
            status: 'failed',
            createdAt: Date.now(),
        })

        await runWorkflowAiStep(RUN_ID, run)

        expect(mockGeneratePreConfigTaskResult).toHaveBeenCalledTimes(1)
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBe(HUMAN_REVIEWER)
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`).status).toBe('completed')
    })

    it('does not let a duplicate workflow run advance the task owned by the first run', async () => {
        mockStore.set(`assistantTaskRunLocks/${PROJECT}__tasks__${TASK}`, {
            projectId: PROJECT,
            objectType: 'tasks',
            objectId: TASK,
            ownerId: 'other-workflow-run',
            kind: 'workflow',
            workflowStepId: AI_STEP,
            status: 'running',
            lockExpiresAt: Date.now() + 60_000,
        })

        await runWorkflowAiStep(RUN_ID, run)

        expect(mockGeneratePreConfigTaskResult).not.toHaveBeenCalled()
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBeUndefined()
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`)).toMatchObject({
            status: 'skipped',
            reason: 'workflow_run_already_active',
        })
    })

    it('activates the workflow reviewer as the task thread assistant', async () => {
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
        mockPostUserRequestComment.mockImplementationOnce(async () => {
            expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`)).toMatchObject({
                assistantId: ASSISTANT,
                isAssistantEnabled: true,
            })
            expect(mockStore.get(`chatObjects/${PROJECT}/chats/${TASK}`)).toMatchObject({
                assistantId: ASSISTANT,
                isAssistantEnabled: true,
            })
            return 'trigger-comment-1'
        })

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
        // The wall clock is the scheduled one: this run executes inside runWorkflowAiStepsSecondGen,
        // whose Cloud Scheduler attempt deadline would otherwise retry it into a second concurrent
        // invocation.
        expect(mockGeneratePreConfigTaskResult.mock.calls[0][12]).toEqual({
            triggerMessageId: 'trigger-comment-1',
            maxRunWallClockMs: SCHEDULED_PROMPT_MAX_RUN_WALL_CLOCK_MS,
        })
    })

    it('still runs when the thread could not be seeded', async () => {
        mockPostUserRequestComment.mockRejectedValueOnce(new Error('firestore unavailable'))

        await runWorkflowAiStep(RUN_ID, run)

        expect(mockGeneratePreConfigTaskResult).toHaveBeenCalledTimes(1)
        expect(mockGeneratePreConfigTaskResult.mock.calls[0][12]).toEqual({
            triggerMessageId: null,
            maxRunWallClockMs: SCHEDULED_PROMPT_MAX_RUN_WALL_CLOCK_MS,
        })
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

    it('keeps the task active when the assistant run fails', async () => {
        mockGeneratePreConfigTaskResult.mockRejectedValueOnce(new Error('out of gold'))

        await runWorkflowAiStep(RUN_ID, run)

        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBeUndefined()
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`)).toMatchObject({
            status: 'failed',
            failureReason: 'out of gold',
        })
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`)).toMatchObject({
            assistantId: ASSISTANT,
            isAssistantEnabled: true,
            workflowAiStatus: {
                status: 'failed',
                failureReason: 'out of gold',
            },
        })
        expect(mockStore.get(`chatObjects/${PROJECT}/chats/${TASK}`)).toMatchObject({
            assistantId: ASSISTANT,
            isAssistantEnabled: true,
        })
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

    it('keeps the task active when the configured step is no longer an AI step', async () => {
        seedAssignee({ [AI_STEP]: humanStep(), [NEXT_STEP]: humanStep() })

        await runWorkflowAiStep(RUN_ID, run)

        expect(mockGeneratePreConfigTaskResult).not.toHaveBeenCalled()
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBeUndefined()
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
        mockStore.set(
            `items/${PROJECT}/tasks/${TASK}`,
            taskOnAiStep({ assistantId: 'previous-assistant', isAssistantEnabled: false })
        )
        mockStore.set(`chatObjects/${PROJECT}/chats/${TASK}`, {
            assistantId: 'previous-assistant',
            isAssistantEnabled: false,
        })
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

        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`)).toMatchObject({
            assistantId: ASSISTANT,
            isAssistantEnabled: true,
            currentReviewerId: HUMAN_REVIEWER,
        })
        expect(mockStore.get(`chatObjects/${PROJECT}/chats/${TASK}`)).toMatchObject({
            assistantId: ASSISTANT,
            isAssistantEnabled: true,
        })
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`).status).toBe('completed')
    })

    it('advances immediately from the VM terminal event without waiting for a poll tick', async () => {
        await runWorkflowAiStep(RUN_ID, run)
        seedVmJob('completed')

        expect(
            await resolveWorkflowRunsForSettledVmJob(mockStore.get(`pendingWebhooks/${CORRELATION}`), Date.now())
        ).toBe(1)
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBe(HUMAN_REVIEWER)
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`).status).toBe('completed')
    })

    it('does not advance twice when a VM terminal event is redelivered', async () => {
        await runWorkflowAiStep(RUN_ID, run)
        seedVmJob('completed')
        const settledJob = mockStore.get(`pendingWebhooks/${CORRELATION}`)

        expect(await resolveWorkflowRunsForSettledVmJob(settledJob, Date.now())).toBe(1)
        expect(await resolveWorkflowRunsForSettledVmJob(settledJob, Date.now())).toBe(0)
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).stepHistory).toEqual([-1, AI_STEP, NEXT_STEP])
        expect(mockCreateTaskMovedInWorkflowFeed).toHaveBeenCalledTimes(1)
    })

    it('ignores non-terminal and unrelated settled jobs', async () => {
        await runWorkflowAiStep(RUN_ID, run)
        const initiated = mockStore.get(`pendingWebhooks/${CORRELATION}`)

        expect(await resolveWorkflowRunsForSettledVmJob(initiated, Date.now())).toBe(0)
        expect(
            await resolveWorkflowRunsForSettledVmJob(
                { ...initiated, status: 'completed', objectType: 'notes' },
                Date.now()
            )
        ).toBe(0)
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`).status).toBe(RUN_STATUS_AWAITING_VM)
    })

    it('keeps the task active when the VM job failed', async () => {
        await runWorkflowAiStep(RUN_ID, run)
        seedVmJob('failed')

        await resolveAwaitingVmRuns({ now: Date.now() })

        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBeUndefined()
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).workflowAiStatus.status).toBe('failed')
    })

    it('times out without completing the task once the VM has had its full budget', async () => {
        await runWorkflowAiStep(RUN_ID, run)

        // Still 'initiated' well past the point a healthy VM job must have settled.
        await resolveAwaitingVmRuns({ now: Date.now() + AWAITING_VM_TIMEOUT_MS + 1000 })

        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBeUndefined()
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

describe('the pre-VM assistant/VM completion ordering', () => {
    const RUN_ID = 'run-pre-vm'
    const CORRELATION = 'fast-vm'
    const ASSISTANT_RUN_ID = 'chat-run'
    const run = {
        projectId: PROJECT,
        taskId: TASK,
        stepId: AI_STEP,
        assistantId: ASSISTANT,
        assigneeUserId: ASSIGNEE,
        status: RUN_STATUS_AWAITING_VM,
        awaitingAnyTaskExecution: true,
        awaitingAnyTaskVm: true,
        awaitingUntil: Date.now() + AWAITING_VM_TIMEOUT_MS,
    }

    beforeEach(() => {
        seedAssignee()
        mockStore.set(`items/${PROJECT}/tasks/${TASK}`, taskOnAiStep())
        mockStore.set(`workflowAiRuns/${RUN_ID}`, run)
        mockStore.set(`pendingWebhooks/${CORRELATION}`, {
            kind: 'vm_job',
            projectId: PROJECT,
            objectType: 'tasks',
            objectId: TASK,
            status: 'completed',
        })
        mockStore.set(`assistantRunLocks/${ASSISTANT_RUN_ID}`, {
            projectId: PROJECT,
            objectType: 'tasks',
            objectId: TASK,
            status: 'running',
            lockExpiresAt: Date.now() + 60_000,
        })
    })

    it('waits for the assistant lock when the VM settles first, then advances on the lock event', async () => {
        expect(
            await resolveWorkflowRunsForSettledVmJob(mockStore.get(`pendingWebhooks/${CORRELATION}`), Date.now())
        ).toBe(0)

        const assistantBefore = mockStore.get(`assistantRunLocks/${ASSISTANT_RUN_ID}`)
        const assistantAfter = { ...assistantBefore, status: 'completed' }
        mockStore.set(`assistantRunLocks/${ASSISTANT_RUN_ID}`, assistantAfter)

        expect(await resolveWorkflowRunsForAssistantRunUpdate(assistantBefore, assistantAfter, Date.now())).toBe(1)
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBe(HUMAN_REVIEWER)
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`).status).toBe('completed')
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

    it('leaves the task on its own step for the whole question, so the step can still complete', async () => {
        seedVmJob('awaiting_user', { interactionExpiresAt: Date.now() + INTERACTION_TTL_MS })

        expect(await resolveAwaitingVmRuns({ now: Date.now() })).toBe(0)

        // vmInteraction only holds the reviewer; the step itself is untouched. Advancing here would
        // consume the step (finalizeWorkflowAiRun only advances a task still on its own step) while
        // the agent is blocked on the answer.
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`)).toMatchObject({ stepHistory: [-1, AI_STEP] })
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).done).toBeUndefined()
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`).status).toBe('awaiting_vm')
    })

    it('keeps the task active once the question expired and the job still has not settled', async () => {
        const expiredAt = Date.now() - 1000
        seedVmJob('awaiting_user', { interactionExpiresAt: expiredAt })

        await resolveAwaitingVmRuns({ now: expiredAt + AWAITING_VM_TIMEOUT_MS + 1000 })

        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBeUndefined()
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`).failureReason).toBe('vm_timeout')
    })

    it('advances exactly one step once an answered question lets the job finish', async () => {
        seedVmJob('awaiting_user', { interactionExpiresAt: Date.now() + INTERACTION_TTL_MS })
        expect(await resolveAwaitingVmRuns({ now: Date.now() })).toBe(0)

        // The user answers, so vmInteraction gives the held step back to the assistant reviewer.
        mockStore.set(`items/${PROJECT}/tasks/${TASK}`, {
            ...mockStore.get(`items/${PROJECT}/tasks/${TASK}`),
            currentReviewerId: ASSISTANT,
            vmInteractionWorkflowStep: null,
        })
        // The VM resumes and completes.
        seedVmJob('completed', { interactionExpiresAt: 0 })

        expect(await resolveAwaitingVmRuns({ now: Date.now() })).toBe(1)
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`)).toMatchObject({
            currentReviewerId: HUMAN_REVIEWER,
            stepHistory: [-1, AI_STEP, NEXT_STEP],
        })
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`).status).toBe('completed')
    })

    it('does not advance again when the task was moved on independently while the VM ran', async () => {
        mockStore.set(
            `items/${PROJECT}/tasks/${TASK}`,
            taskOnAiStep({
                currentReviewerId: HUMAN_REVIEWER,
                stepHistory: [-1, AI_STEP, NEXT_STEP],
            })
        )
        seedVmJob('completed', { interactionExpiresAt: 0 })

        expect(await resolveAwaitingVmRuns({ now: Date.now() })).toBe(1)
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`)).toMatchObject({
            currentReviewerId: HUMAN_REVIEWER,
            stepHistory: [-1, AI_STEP, NEXT_STEP],
        })
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`).status).toBe('completed')
    })

    it('still fails a job that simply hangs, with no interaction to justify waiting', async () => {
        seedVmJob('initiated')

        await resolveAwaitingVmRuns({ now: Date.now() + AWAITING_VM_TIMEOUT_MS + 1000 })

        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).currentReviewerId).toBeUndefined()
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`).failureReason).toBe('vm_timeout')
    })
})

// The regression AT-2188 left behind. A run is bound to the VM job it parked on; when that job dies
// the run settles `failed` and the task correctly stays on the step. Retrying by starting another VM
// task in the thread produces a job that belongs to no run, so before this its success — Merge
// Request and all — moved nothing. It only looked fine while a VM *question* still performed a
// forward move of its own, which advanced the step whether or not the work had succeeded.
describe('a step retried by a later VM job after its own run failed', () => {
    const RUN_ID = 'run-vm-retry'
    const CORRELATION = 'vm-crashed'
    const RETRY_CORRELATION = 'vm-retry'
    const run = { projectId: PROJECT, taskId: TASK, stepId: AI_STEP, assistantId: ASSISTANT, assigneeUserId: ASSIGNEE }

    const seedJob = (correlationId, status, overrides = {}) => {
        const job = {
            kind: 'vm_job',
            correlationId,
            projectId: PROJECT,
            objectId: TASK,
            createdAt: Date.now(),
            status,
            ...overrides,
        }
        mockStore.set(`pendingWebhooks/${correlationId}`, job)
        return job
    }

    // Everything up to and including the crash: the step ran, dispatched its VM, the VM died, and the
    // run settled `failed` with the task still sitting on the assistant step.
    const failTheStep = async () => {
        mockGeneratePreConfigTaskResult.mockImplementationOnce(async () => {
            seedJob(CORRELATION, 'initiated')
            return { success: true }
        })
        await runWorkflowAiStep(RUN_ID, run)
        seedJob(CORRELATION, 'failed')
        await resolveAwaitingVmRuns({ now: Date.now() })
    }

    // The retry has to look like one: started after the step failed, on the same task.
    const seedRetry = (status, overrides = {}) =>
        seedJob(RETRY_CORRELATION, status, {
            createdAt: (mockStore.get(`workflowAiRuns/${RUN_ID}`).settledAt || Date.now()) + 1000,
            ...overrides,
        })

    beforeEach(async () => {
        seedAssignee()
        mockStore.set(`items/${PROJECT}/tasks/${TASK}`, taskOnAiStep())
        mockStore.set(`workflowAiRuns/${RUN_ID}`, { ...run, status: 'running', createdAt: 1000 })
        await failTheStep()
    })

    it('leaves the task on the failed step until something finishes its work', () => {
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`)).toMatchObject({ stepHistory: [-1, AI_STEP] })
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`)).toMatchObject({
            status: 'failed',
            failureReason: 'vm_failed',
        })
    })

    it('advances exactly one step when the retry succeeds', async () => {
        const retry = seedRetry('completed')

        expect(await resolveWorkflowRunsForSettledVmJob(retry, Date.now())).toBe(1)

        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`)).toMatchObject({
            stepHistory: [-1, AI_STEP, NEXT_STEP],
            currentReviewerId: HUMAN_REVIEWER,
        })
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`)).toMatchObject({
            status: 'completed',
            recoveredByCorrelationId: RETRY_CORRELATION,
        })
        expect(mockCreateTaskMovedInWorkflowFeed).toHaveBeenCalledTimes(1)
    })

    it('advances after the retry stopped to ask a question and the answer let it finish', async () => {
        // The question holds only the reviewer (see vmInteraction); the step itself never moves.
        seedRetry('awaiting_user', { interactionExpiresAt: Date.now() + 24 * 60 * 60 * 1000 })
        mockStore.set(`items/${PROJECT}/tasks/${TASK}`, {
            ...mockStore.get(`items/${PROJECT}/tasks/${TASK}`),
            currentReviewerId: ASSIGNEE,
            vmInteractionWorkflowStep: { correlationId: RETRY_CORRELATION, previousReviewerId: ASSISTANT },
        })
        expect(await resolveWorkflowRunsForSettledVmJob(mockStore.get(`pendingWebhooks/${RETRY_CORRELATION}`))).toBe(0)
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).stepHistory).toEqual([-1, AI_STEP])

        // Answered: the hold is released, the VM resumes, opens its Merge Request and completes.
        mockStore.set(`items/${PROJECT}/tasks/${TASK}`, {
            ...mockStore.get(`items/${PROJECT}/tasks/${TASK}`),
            currentReviewerId: ASSISTANT,
            vmInteractionWorkflowStep: null,
        })
        const finished = seedRetry('completed', { interactionExpiresAt: 0 })

        expect(await resolveWorkflowRunsForSettledVmJob(finished, Date.now())).toBe(1)
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`)).toMatchObject({
            stepHistory: [-1, AI_STEP, NEXT_STEP],
            currentReviewerId: HUMAN_REVIEWER,
        })
    })

    it('does not advance twice when the retry completion is redelivered', async () => {
        const retry = seedRetry('completed')

        expect(await resolveWorkflowRunsForSettledVmJob(retry, Date.now())).toBe(1)
        expect(await resolveWorkflowRunsForSettledVmJob(retry, Date.now())).toBe(0)

        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).stepHistory).toEqual([-1, AI_STEP, NEXT_STEP])
        expect(mockCreateTaskMovedInWorkflowFeed).toHaveBeenCalledTimes(1)
    })

    it('does not advance when the retry failed or was cancelled too', async () => {
        expect(await resolveWorkflowRunsForSettledVmJob(seedRetry('failed'), Date.now())).toBe(0)
        expect(await resolveWorkflowRunsForSettledVmJob(seedRetry('cancelled'), Date.now())).toBe(0)

        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).stepHistory).toEqual([-1, AI_STEP])
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`).status).toBe('failed')
    })

    it('ignores work that was already running when the step failed, which that settlement weighed', async () => {
        const older = seedJob('vm-older', 'completed', {
            createdAt: (mockStore.get(`workflowAiRuns/${RUN_ID}`).settledAt || Date.now()) - 1000,
        })

        expect(await resolveWorkflowRunsForSettledVmJob(older, Date.now())).toBe(0)
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).stepHistory).toEqual([-1, AI_STEP])
    })

    it('leaves a task a human already moved on where they put it', async () => {
        mockStore.set(`items/${PROJECT}/tasks/${TASK}`, {
            ...mockStore.get(`items/${PROJECT}/tasks/${TASK}`),
            stepHistory: [-1, AI_STEP, NEXT_STEP],
            currentReviewerId: HUMAN_REVIEWER,
        })

        expect(await resolveWorkflowRunsForSettledVmJob(seedRetry('completed'), Date.now())).toBe(0)
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).stepHistory).toEqual([-1, AI_STEP, NEXT_STEP])
    })

    it('never reopens a step that already completed, so a late VM job cannot double-advance it', async () => {
        expect(await resolveWorkflowRunsForSettledVmJob(seedRetry('completed'), Date.now())).toBe(1)

        const late = seedJob('vm-late', 'completed', { createdAt: Date.now() + 5000 })
        expect(await resolveWorkflowRunsForSettledVmJob(late, Date.now())).toBe(0)
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).stepHistory).toEqual([-1, AI_STEP, NEXT_STEP])
    })

    it('leaves a step its own parked run still owns to that run, unrecovered', async () => {
        // Rewind to a thread whose first job never crashed: the run is still parked, so the normal
        // path owns the advance and the recovery must not reach the same step behind it.
        mockStore.delete(`pendingWebhooks/${CORRELATION}`)
        mockStore.set(`workflowAiRuns/${RUN_ID}`, {
            ...run,
            status: RUN_STATUS_AWAITING_VM,
            createdAt: 1000,
            awaitingAnyTaskVm: true,
            awaitingCorrelationIds: [RETRY_CORRELATION],
            awaitingSince: Date.now(),
            awaitingUntil: Date.now() + AWAITING_VM_TIMEOUT_MS,
        })
        mockStore.set(`items/${PROJECT}/tasks/${TASK}`, {
            ...mockStore.get(`items/${PROJECT}/tasks/${TASK}`),
            workflowAiStatus: { runId: RUN_ID, stepId: AI_STEP, status: RUN_STATUS_AWAITING_VM },
        })

        expect(await resolveWorkflowRunsForSettledVmJob(seedRetry('completed'), Date.now())).toBe(1)
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).stepHistory).toEqual([-1, AI_STEP, NEXT_STEP])
        expect(mockStore.get(`workflowAiRuns/${RUN_ID}`).recoveredByCorrelationId).toBeUndefined()
        expect(mockCreateTaskMovedInWorkflowFeed).toHaveBeenCalledTimes(1)
    })

    it('stays out of the way when the step is no longer an AI step', async () => {
        seedAssignee({ [AI_STEP]: humanStep(), [NEXT_STEP]: humanStep() })

        expect(await resolveWorkflowRunsForSettledVmJob(seedRetry('completed'), Date.now())).toBe(0)
        expect(mockStore.get(`items/${PROJECT}/tasks/${TASK}`).stepHistory).toEqual([-1, AI_STEP])
    })
})
