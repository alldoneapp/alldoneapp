// AT-2829: moving a task through its workflow from a conversation ("merge it").

const mockStore = new Map()

const makeRef = path => ({
    path,
    id: path.split('/').pop(),
    get: async () => ({ exists: mockStore.has(path), id: path.split('/').pop(), data: () => mockStore.get(path) }),
    set: async (data, options) => {
        mockStore.set(path, options && options.merge ? { ...(mockStore.get(path) || {}), ...data } : data)
    },
    update: async data => mockStore.set(path, { ...(mockStore.get(path) || {}), ...data }),
})

const collectionQuery = collectionPath => {
    const filters = []
    const query = {
        where: (field, op, expected) => {
            filters.push({ field, op, expected })
            return query
        },
        orderBy: () => query,
        limit: () => query,
        get: async () => {
            const docs = [...mockStore.entries()]
                .filter(
                    ([path]) =>
                        path.startsWith(`${collectionPath}/`) && !path.slice(collectionPath.length + 1).includes('/')
                )
                .map(([path, data]) => ({ id: path.split('/').pop(), ref: makeRef(path), data: () => data }))
                .filter(doc =>
                    filters.every(({ field, op, expected }) =>
                        op === 'array-contains'
                            ? (doc.data()[field] || []).includes(expected)
                            : doc.data()[field] === expected
                    )
                )
            return { empty: docs.length === 0, docs }
        },
    }
    return query
}

const mockDb = {
    doc: path => makeRef(path),
    collection: path => collectionQuery(path),
    runTransaction: async handler =>
        handler({
            get: ref => ref.get(),
            set: (ref, data, options) => ref.set(data, options),
            update: (ref, data) => ref.update(data),
        }),
}

jest.mock('firebase-admin', () => ({ firestore: jest.fn(() => mockDb) }))
jest.mock('../Utils/HelperFunctionsCloud', () => ({
    OPEN_STEP: -1,
    DONE_STEP: -2,
    FEED_PUBLIC_FOR_ALL: 0,
    STAYWARD_COMMENT: 2,
    WORKSTREAM_ID_PREFIX: 'ws@',
    getBaseUrl: () => 'https://my.alldone.app',
}))

const mockWriteMovedInWorkflowFeed = jest.fn(async () => {})
jest.mock('./workflowAiStep', () => ({ writeMovedInWorkflowFeed: mockWriteMovedInWorkflowFeed }))

const mockCreateInitialStatusMessage = jest.fn(async () => {})
jest.mock('../Assistant/assistantStatusHelper', () => ({ createInitialStatusMessage: mockCreateInitialStatusMessage }))
jest.mock('../shared/privacyAccess', () => ({
    assertObjectAccess: jest.fn(async (db, userId, projectId) => {
        const project = mockStore.get(`projects/${projectId}`)
        if (!project || !project.userIds.includes(userId)) throw new Error('denied')
    }),
}))

const {
    checkMovePermission,
    describeTaskWorkflow,
    formatWorkflowLine,
    getWorkflowMoverRunLockId,
    moveTaskWorkflowStep,
    resolveTarget,
} = require('./workflowStepMove')
const { executeMoveTaskWorkflowStepTool } = require('../Assistant/workflowStepMoveTool')
const { notifyDelegationOriginOnHumanStep } = require('../Assistant/delegationReviewNotice')

const PROJECT = 'p1'
const TASK = 't1'
const OWNER = 'karsten'
const COLLEAGUE = 'colleague'
const CTO = 'cto-assistant'
const IMPLEMENT = '-A-implement'
const REVIEW = '-B-review'
const MERGE = '-C-merge'

const workflow = () => ({
    [IMPLEMENT]: {
        description: 'Implement',
        reviewerUid: CTO,
        reviewerType: 'assistant',
        aiPrompt: 'Implement it',
        sortIndex: 0,
    },
    [REVIEW]: { description: 'Review', reviewerUid: OWNER, reviewerType: 'user', sortIndex: 1 },
    [MERGE]: {
        description: 'Merge',
        reviewerUid: CTO,
        reviewerType: 'assistant',
        aiPrompt: 'Merge the MR',
        sortIndex: 2,
    },
})

const taskAt = (stepId, overrides = {}) => ({
    userId: OWNER,
    userIds: stepId === -1 ? [OWNER] : [OWNER, CTO, OWNER].slice(0, [IMPLEMENT, REVIEW, MERGE].indexOf(stepId) + 2),
    stepHistory:
        stepId === -1
            ? [-1]
            : [-1, ...[IMPLEMENT, REVIEW, MERGE].slice(0, [IMPLEMENT, REVIEW, MERGE].indexOf(stepId) + 1)],
    currentReviewerId: OWNER,
    name: 'Fix the popup',
    humanReadableId: 'AT-1',
    isPublicFor: [0],
    done: false,
    ...overrides,
})

const seed = (task, steps = workflow()) => {
    mockStore.set(`projects/${PROJECT}`, { userIds: [OWNER, COLLEAGUE] })
    mockStore.set(`users/${OWNER}`, { displayName: 'Karsten', workflow: { [PROJECT]: steps } })
    mockStore.set(`items/${PROJECT}/tasks/${TASK}`, task)
}

const storedTask = () => mockStore.get(`items/${PROJECT}/tasks/${TASK}`)

beforeEach(() => {
    mockStore.clear()
    jest.clearAllMocks()
})

describe('resolveTarget', () => {
    const resolve = (to, task = taskAt(REVIEW)) => resolveTarget(to, { workflow: workflow(), task })

    it('maps next and back to the neighbouring steps', () => {
        expect(resolve('next')).toEqual({ stepId: MERGE })
        expect(resolve('back')).toEqual({ stepId: IMPLEMENT })
        expect(resolve('next', taskAt(MERGE))).toEqual({ stepId: -2 })
        expect(resolve('back', taskAt(IMPLEMENT))).toEqual({ stepId: -1 })
    })

    it('finds a step by its name, exactly or by a unique part', () => {
        expect(resolve('merge')).toEqual({ stepId: MERGE })
        expect(resolve('“Implement”')).toEqual({ stepId: IMPLEMENT })
        expect(resolve('done')).toEqual({ stepId: -2 })
    })

    it('names the steps when the target is unknown', () => {
        expect(resolve('deploy').error).toMatchObject({ code: 'unknown_step' })
        expect(resolve('deploy').error.message).toContain('“Merge”')
    })

    it('refuses an ambiguous name', () => {
        const steps = {
            ...workflow(),
            '-D': { description: 'Merge docs', reviewerUid: CTO, reviewerType: 'assistant', sortIndex: 3 },
        }
        expect(resolveTarget('merg', { workflow: steps, task: taskAt(REVIEW) }).error).toMatchObject({
            code: 'ambiguous_step',
        })
    })
})

describe('checkMovePermission', () => {
    const check = (overrides = {}) =>
        checkMovePermission({
            task: taskAt(REVIEW),
            workflow: workflow(),
            targetStepId: MERGE,
            actorUserId: OWNER,
            humanTurn: true,
            skipSteps: false,
            ...overrides,
        })

    it('lets the reviewer of the current step approve it', () => {
        expect(check()).toBeNull()
    })

    it('refuses any move outside a turn the user typed', () => {
        expect(check({ humanTurn: false })).toMatchObject({ code: 'needs_human_request' })
    })

    it('refuses a member who neither owns the task nor reviews its current step', () => {
        expect(check({ actorUserId: COLLEAGUE })).toMatchObject({ code: 'not_your_step' })
    })

    it('lets only the owner move the task off an assistant step', () => {
        const task = taskAt(IMPLEMENT, { userId: COLLEAGUE })
        expect(check({ task, targetStepId: REVIEW })).toMatchObject({ code: 'not_your_step' })
        expect(check({ task: taskAt(IMPLEMENT), targetStepId: REVIEW })).toBeNull()
    })

    it('asks before jumping over a step, and allows it when the user said so', () => {
        expect(check({ targetStepId: -2 })).toMatchObject({ code: 'would_skip_steps' })
        expect(check({ targetStepId: -2 }).message).toContain('“Merge”')
        expect(check({ targetStepId: -2, skipSteps: true })).toBeNull()
    })

    it("lets only the owner skip another member's review", () => {
        const steps = {
            ...workflow(),
            [MERGE]: { description: 'QA', reviewerUid: COLLEAGUE, reviewerType: 'user', sortIndex: 2 },
        }
        const task = taskAt(REVIEW, { userId: 'someone-else' })
        const asReviewer = {
            task: { ...task, userIds: [task.userId, CTO, OWNER] },
            workflow: steps,
            targetStepId: -2,
            skipSteps: true,
        }
        expect(check(asReviewer)).toMatchObject({ code: 'not_your_step' })
    })

    it('allows sending the task back to any earlier step', () => {
        expect(check({ targetStepId: IMPLEMENT })).toBeNull()
        expect(check({ targetStepId: -1 })).toBeNull()
    })

    it('does not reopen a completed task', () => {
        expect(check({ task: taskAt(MERGE, { done: true }), targetStepId: MERGE })).toMatchObject({ code: 'task_done' })
    })
})

describe('describeTaskWorkflow', () => {
    it('describes the steps from the viewer’s side and marks the current one', () => {
        const description = describeTaskWorkflow(taskAt(REVIEW), workflow(), OWNER)

        expect(description.current).toMatchObject({ id: REVIEW, label: 'Review', handledBy: 'you' })
        expect(description.next).toMatchObject({ id: MERGE, label: 'Merge', handledBy: 'assistant' })
        expect(formatWorkflowLine(description)).toBe(
            'Open → “Implement” (assistant) → [“Review” (you), current] → “Merge” (assistant) → Done'
        )
    })

    it('is null without a workflow', () => {
        expect(describeTaskWorkflow(taskAt(-1), {}, OWNER)).toBeNull()
    })
})

describe('moveTaskWorkflowStep', () => {
    const move = (overrides = {}) =>
        moveTaskWorkflowStep({
            db: mockDb,
            projectId: PROJECT,
            taskId: TASK,
            actorUserId: OWNER,
            to: 'next',
            humanTurn: true,
            now: () => 5000,
            ...overrides,
        })

    it('moves an approved review to the next assistant step, like the step picker does', async () => {
        seed(taskAt(REVIEW))

        const result = await move({ runLockId: 'chat-run-1' })

        expect(result).toMatchObject({ success: true, moved: true, from: { label: 'Review' }, to: { label: 'Merge' } })
        expect(storedTask()).toMatchObject({
            stepHistory: [-1, IMPLEMENT, REVIEW, MERGE],
            userIds: [OWNER, CTO, OWNER, CTO],
            currentReviewerId: CTO,
            completed: 5000,
            done: false,
            lastEditorId: OWNER,
            workflowAiPromptOverride: null,
            workflowStepMove: { stepId: MERGE, enteredAt: 5000, runLockId: 'chat-run-1', actorUserId: OWNER, at: 5000 },
        })
        expect(getWorkflowMoverRunLockId(storedTask(), MERGE)).toBe('chat-run-1')
        expect(mockWriteMovedInWorkflowFeed).toHaveBeenCalledWith(
            PROJECT,
            TASK,
            expect.any(Object),
            expect.objectContaining({ description: 'Review' }),
            MERGE,
            expect.any(Object),
            expect.objectContaining({ isForward: true })
        )
    })

    it('adds the note to the next assistant step instead of replacing its prompt', async () => {
        seed(taskAt(REVIEW))

        await move({ note: 'squash the commits' })

        expect(storedTask().workflowAiPromptOverride).toEqual({
            stepId: MERGE,
            prompt: 'squash the commits',
            mode: 'append',
            triggerMessageId: null,
            requestedByUserId: OWNER,
        })
    })

    it('sends the task back with the feedback for the assistant step', async () => {
        seed(taskAt(REVIEW))

        await move({ to: 'back', note: 'the button is still too big' })

        expect(storedTask()).toMatchObject({
            stepHistory: [-1, IMPLEMENT],
            userIds: [OWNER, CTO],
            currentReviewerId: CTO,
            workflowAiPromptOverride: { stepId: IMPLEMENT, prompt: 'the button is still too big', mode: 'append' },
        })
    })

    it('completes the task from its last step', async () => {
        seed(taskAt(MERGE))

        await move({ to: 'done' })

        expect(storedTask()).toMatchObject({ done: true, inDone: true, currentReviewerId: -2, userIds: [OWNER] })
    })

    it('moves subtasks along, without the parent-only fields', async () => {
        seed(taskAt(REVIEW, { subtaskIds: ['s1'] }))
        mockStore.set(`items/${PROJECT}/tasks/s1`, { parentId: TASK })

        await move()

        const subtask = mockStore.get(`items/${PROJECT}/tasks/s1`)
        expect(subtask).toMatchObject({ stepHistory: [-1, IMPLEMENT, REVIEW, MERGE], parentDone: false })
        expect(subtask).not.toHaveProperty('workflowStepMove')
    })

    it('refuses when the task moved since the user looked at it', async () => {
        seed(taskAt(MERGE))

        const result = await move({ expectedStepId: REVIEW })

        expect(result).toMatchObject({ success: false, code: 'task_moved' })
        expect(storedTask().stepHistory).toEqual([-1, IMPLEMENT, REVIEW, MERGE])
    })

    it('changes nothing when the move is not allowed', async () => {
        seed(taskAt(REVIEW))

        const result = await move({ humanTurn: false })

        expect(result).toMatchObject({ success: false, code: 'needs_human_request' })
        expect(storedTask().stepHistory).toEqual([-1, IMPLEMENT, REVIEW])
        expect(mockWriteMovedInWorkflowFeed).not.toHaveBeenCalled()
    })

    it('refuses someone outside the project', async () => {
        seed(taskAt(REVIEW))

        expect(await move({ actorUserId: 'stranger' })).toMatchObject({ success: false, code: 'not_a_member' })
    })
})

describe('move_task_workflow_step tool', () => {
    const userComment = (objectType, objectId, messageId, creatorId = OWNER, extra = {}) =>
        mockStore.set(`chatComments/${PROJECT}/${objectType}/${objectId}/comments/${messageId}`, {
            creatorId,
            fromAssistant: false,
            ...extra,
        })

    const runTool = (args, runtime, assistantId = CTO) =>
        executeMoveTaskWorkflowStepTool({
            db: mockDb,
            args,
            projectId: PROJECT,
            assistantId,
            requestUserId: OWNER,
            toolRuntimeContext: runtime,
            getFeedUser: async () => ({ uid: assistantId }),
        })

    it('approves the task of its own chat when the user typed "merge it"', async () => {
        seed(taskAt(REVIEW))
        userComment('tasks', TASK, 'm1')

        const result = await runTool(
            { to: 'next' },
            {
                projectId: PROJECT,
                objectType: 'tasks',
                objectId: TASK,
                messageId: 'm1',
                humanTurn: true,
                runLockId: 'lock-m1',
            }
        )

        expect(result).toMatchObject({ success: true, moved: true, to: { label: 'Merge' } })
        expect(storedTask().workflowStepMove.runLockId).toBe('lock-m1')
        // The assistant's own reply in this chat says so; no extra line.
        expect(mockCreateInitialStatusMessage).not.toHaveBeenCalled()
    })

    it('refuses when the message that started the run is not the user’s own', async () => {
        seed(taskAt(REVIEW))
        userComment('tasks', TASK, 'seeded', OWNER, { fromAssistant: true })

        const result = await runTool(
            { to: 'next' },
            { projectId: PROJECT, objectType: 'tasks', objectId: TASK, messageId: 'seeded', humanTurn: true }
        )

        expect(result).toMatchObject({ success: false, code: 'needs_human_request' })
    })

    it('refuses unattended runs, which carry no human turn', async () => {
        seed(taskAt(REVIEW))
        userComment('tasks', TASK, 'step-prompt')

        const result = await runTool(
            { to: 'next' },
            { projectId: PROJECT, objectType: 'tasks', objectId: TASK, messageId: 'step-prompt' }
        )

        expect(result).toMatchObject({ success: false, code: 'needs_human_request' })
    })

    it('treats an MCP call as the user acting', async () => {
        seed(taskAt(REVIEW))

        const result = await runTool(
            { taskId: 'AT-1', to: 'merge' },
            { sourceChannel: 'mcp', mcpClient: 'Claude' },
            null
        )

        expect(result).toMatchObject({ success: true, moved: true })
        expect(storedTask().workflowStepMove.runLockId).toBeNull()
    })

    it('reads the workflow without moving when no target is given', async () => {
        seed(taskAt(REVIEW))

        const result = await runTool({}, { projectId: PROJECT, objectType: 'tasks', objectId: TASK })

        expect(result).toMatchObject({ success: true, moved: false, workflow: { current: { label: 'Review' } } })
        expect(storedTask().stepHistory).toEqual([-1, IMPLEMENT, REVIEW])
    })

    describe("in Anna's conversation", () => {
        const TOPIC = 'anna-topic'
        const annaRuntime = {
            projectId: PROJECT,
            objectType: 'topics',
            objectId: TOPIC,
            messageId: 'm2',
            humanTurn: true,
            annaConversation: true,
        }

        const delegate = (taskId, task) => {
            mockStore.set(`items/${PROJECT}/tasks/${taskId}`, task)
            mockStore.set(`delegatedTaskOrigins/${PROJECT}__${taskId}`, {
                projectId: PROJECT,
                taskId,
                ownerId: OWNER,
                originProjectId: PROJECT,
                originObjectType: 'topics',
                originObjectId: TOPIC,
                originAssistantId: 'anna',
            })
        }

        it('finds the one delegated task waiting for the user and posts the move in its chat', async () => {
            seed(taskAt(REVIEW))
            delegate(TASK, taskAt(REVIEW))
            delegate('t-busy', taskAt(IMPLEMENT))
            userComment('topics', TOPIC, 'm2')

            const result = await runTool({ to: 'next', note: 'squash the commits' }, annaRuntime, 'anna')

            expect(result).toMatchObject({ success: true, moved: true, taskId: TASK })
            expect(storedTask().workflowStepMove.runLockId).toBeNull()
            expect(mockCreateInitialStatusMessage).toHaveBeenCalledWith(
                PROJECT,
                'tasks',
                TASK,
                'anna',
                'Karsten moved this task from “Review” to “Merge” in chat.\nInstruction: squash the commits',
                [],
                [0],
                []
            )
        })

        it('asks which task when several wait', async () => {
            seed(taskAt(REVIEW))
            delegate(TASK, taskAt(REVIEW))
            delegate('t2', taskAt(REVIEW, { humanReadableId: 'AT-2' }))
            userComment('topics', TOPIC, 'm2')

            const result = await runTool({ to: 'next' }, annaRuntime, 'anna')

            expect(result).toMatchObject({ success: false, code: 'needs_task_choice' })
            expect(result.tasks.map(task => task.humanReadableId).sort()).toEqual(['AT-1', 'AT-2'])
        })
    })
})

describe('notifyDelegationOriginOnHumanStep', () => {
    const delegatedAt = (stepId, overrides = {}) =>
        taskAt(stepId, {
            taskMetadata: { delegation: { ownerId: OWNER, assistantId: CTO, requiresReview: true } },
            completed: 7000,
            ...overrides,
        })

    beforeEach(() => {
        seed(delegatedAt(REVIEW))
        mockStore.set(`delegatedTaskOrigins/${PROJECT}__${TASK}`, {
            ownerId: OWNER,
            originProjectId: PROJECT,
            originObjectType: 'topics',
            originObjectId: 'anna-topic',
            originAssistantId: 'anna',
        })
        mockStore.set(`chatComments/${PROJECT}/tasks/${TASK}/comments/c1`, {
            fromAssistant: true,
            created: 6000,
            commentText: 'Opened MR !45, tests pass.',
        })
    })

    const notify = (oldTask = delegatedAt(IMPLEMENT), newTask = delegatedAt(REVIEW)) =>
        notifyDelegationOriginOnHumanStep({ db: mockDb, projectId: PROJECT, taskId: TASK, oldTask, newTask })

    it("tells the user in Anna's conversation, once, when the task reaches their review", async () => {
        expect(await notify()).toBe(true)
        expect(await notify()).toBe(false)

        expect(mockCreateInitialStatusMessage).toHaveBeenCalledTimes(1)
        const [projectId, objectType, objectId, assistantId, text] = mockCreateInitialStatusMessage.mock.calls[0]
        expect([projectId, objectType, objectId, assistantId]).toEqual([PROJECT, 'topics', 'anna-topic', 'anna'])
        expect(text).toContain('AT-1 “Fix the popup” is ready for you at “Review”')
        expect(text).toContain('Opened MR !45, tests pass.')
        expect(text).toContain('Next: “Merge” (assistant)')
        expect(text).toContain(`https://my.alldone.app/projects/${PROJECT}/tasks/${TASK}/chat`)
    })

    it('stays quiet for assistant steps and for moves the user made from a chat', async () => {
        expect(await notify(delegatedAt(-1), delegatedAt(IMPLEMENT))).toBe(false)
        const movedByUser = delegatedAt(REVIEW, {
            workflowStepMove: { stepId: REVIEW, actorUserId: OWNER, enteredAt: 7000 },
        })
        expect(await notify(delegatedAt(IMPLEMENT), movedByUser)).toBe(false)
        expect(mockCreateInitialStatusMessage).not.toHaveBeenCalled()
    })

    it('still announces an assistant handover when an older chat move left its stamp', async () => {
        const stale = delegatedAt(REVIEW, { workflowStepMove: { stepId: REVIEW, actorUserId: OWNER, enteredAt: 1000 } })
        expect(await notify(delegatedAt(IMPLEMENT), stale)).toBe(true)
    })

    it('ignores tasks that were not delegated', async () => {
        expect(await notify(taskAt(IMPLEMENT), taskAt(REVIEW))).toBe(false)
    })
})
