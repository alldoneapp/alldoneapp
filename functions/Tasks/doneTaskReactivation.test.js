// AT-3098: a done task goes back into its workflow when the assistant works on it again.

const mockStore = new Map()

const makeRef = path => ({
    path,
    id: path.split('/').pop(),
    get: async () => ({ exists: mockStore.has(path), id: path.split('/').pop(), data: () => mockStore.get(path) }),
    set: async (data, options) => {
        mockStore.set(path, options && options.merge ? { ...(mockStore.get(path) || {}), ...data } : data)
    },
})

const mockTransactionWrites = []
const mockDb = {
    doc: path => makeRef(path),
    runTransaction: async handler =>
        handler({
            get: ref => ref.get(),
            set: (ref, data, options) => {
                mockTransactionWrites.push(ref.path)
                return ref.set(data, options)
            },
        }),
}

jest.mock('firebase-admin', () => ({ firestore: jest.fn(() => mockDb) }))
jest.mock('../Utils/HelperFunctionsCloud', () => ({
    OPEN_STEP: -1,
    DONE_STEP: -2,
    FEED_PUBLIC_FOR_ALL: 0,
    WORKSTREAM_ID_PREFIX: 'ws@',
    isWorkstream: id => typeof id === 'string' && id.startsWith('ws@'),
}))

const {
    buildDoneTaskReactivationUpdate,
    planDoneTaskReactivation,
    reactivateDoneTaskForAssistantWork,
    selectReactivationStepId,
} = require('./doneTaskReactivation')
const { buildCrossUserTaskStatusChange } = require('./taskStatusStatistics')
const { classifyStepChange } = require('../Assistant/delegationReviewNotice')

const PROJECT = 'product'
const TASK = 'at-3098'
const OWNER = 'karsten'
const CTO = 'alldone-cto'
const OTHER_ASSISTANT = 'researcher'
const BUILD = '-A-build'
const CHECK = '-B-check'
const MERGE = '-C-merge'
const TEST = '-D-test'

// The host task's own workflow: Open → AI build → owner check → AI merge → owner test → Done.
const hostWorkflow = () => ({
    [BUILD]: {
        description: 'AI: please build',
        reviewerUid: CTO,
        reviewerType: 'assistant',
        aiPrompt: 'Build it',
        sortIndex: 0,
    },
    [CHECK]: { description: 'Check what AI did', reviewerUid: OWNER, reviewerType: 'user', sortIndex: 1 },
    [MERGE]: {
        description: 'AI: Please merge',
        reviewerUid: CTO,
        reviewerType: 'assistant',
        aiPrompt: 'Merge it',
        sortIndex: 2,
    },
    [TEST]: { description: 'Test on Production', reviewerUid: OWNER, reviewerType: 'user', sortIndex: 3 },
})

const doneTask = (overrides = {}) => ({
    userId: OWNER,
    userIds: [OWNER],
    stepHistory: [-1, BUILD, CHECK, MERGE, TEST],
    currentReviewerId: -2,
    completed: 5000,
    completedTime: 4000,
    done: true,
    inDone: true,
    name: 'Reopen done tasks',
    estimations: { '-1': 3 },
    ...overrides,
})

const seed = (task = doneTask(), workflow = hostWorkflow()) => {
    mockStore.set(`users/${OWNER}`, { displayName: 'Karsten', workflow: { [PROJECT]: workflow } })
    mockStore.set(`items/${PROJECT}/tasks/${TASK}`, task)
}

const reopen = (overrides = {}) =>
    reactivateDoneTaskForAssistantWork({
        db: mockDb,
        projectId: PROJECT,
        taskId: TASK,
        assistantId: CTO,
        actorUserId: OWNER,
        now: () => 9000,
        createId: () => 'transition-1',
        ...overrides,
    })

const storedTask = () => mockStore.get(`items/${PROJECT}/tasks/${TASK}`)

beforeEach(() => {
    mockStore.clear()
    mockTransactionWrites.length = 0
})

describe('which step a done task goes back to', () => {
    test('the first AI step of the working assistant, so every later review runs again', () => {
        expect(selectReactivationStepId(doneTask(), hostWorkflow(), CTO)).toBe(BUILD)
    })

    test("the working assistant's own step before another assistant's earlier one", () => {
        const workflow = { ...hostWorkflow(), [BUILD]: { ...hostWorkflow()[BUILD], reviewerUid: OTHER_ASSISTANT } }
        expect(selectReactivationStepId(doneTask(), workflow, CTO)).toBe(MERGE)
    })

    test('the first AI step when the working assistant has none', () => {
        expect(selectReactivationStepId(doneTask(), hostWorkflow(), 'someone-else')).toBe(BUILD)
    })

    test('Open when the workflow has no AI step, or there is no workflow', () => {
        const humanOnly = { [CHECK]: hostWorkflow()[CHECK], [TEST]: hostWorkflow()[TEST] }
        expect(selectReactivationStepId(doneTask(), humanOnly, CTO)).toBe(-1)
        expect(selectReactivationStepId(doneTask(), {}, CTO)).toBe(-1)
    })

    test('an assistant workflow task, which has no Open, goes to its first step', () => {
        const humanOnly = { [CHECK]: hostWorkflow()[CHECK] }
        expect(selectReactivationStepId(doneTask({ workflowTask: true }), humanOnly, CTO)).toBe(CHECK)
        expect(selectReactivationStepId(doneTask({ workflowTask: true }), {}, CTO)).toBeNull()
    })
})

describe('the reopen write', () => {
    test('mirrors moveTasksFromDone: the history up to the AI step, the rest to come again', () => {
        const update = buildDoneTaskReactivationUpdate({
            task: doneTask(),
            workflow: hostWorkflow(),
            targetStepId: BUILD,
            actorUserId: OWNER,
            assistantId: CTO,
            now: 9000,
            transitionId: 'transition-1',
        })

        expect(update).toMatchObject({
            stepHistory: [-1, BUILD],
            userIds: [OWNER, CTO],
            currentReviewerId: CTO,
            completed: 9000,
            dueDate: 9000,
            sortIndex: 9000,
            done: false,
            inDone: false,
            lastEditorId: CTO,
            workflowAiPromptOverride: null,
        })
        // No run lock: the chat run that started the VM is the work on the step, so the step parks
        // on it (AT-2222) instead of waiting for it and then running its prompt a second time.
        expect(update.workflowStepMove).toEqual({
            stepId: BUILD,
            enteredAt: 9000,
            runLockId: null,
            actorUserId: OWNER,
            at: 9000,
            fromConversation: null,
        })
    })

    test("reverses the owner's completion statistics through the fan-out's cross-user marker", () => {
        const oldTask = doneTask()
        const update = buildDoneTaskReactivationUpdate({
            task: oldTask,
            workflow: hostWorkflow(),
            targetStepId: BUILD,
            actorUserId: OWNER,
            assistantId: CTO,
            now: 9000,
            transitionId: 'transition-1',
        })

        expect(buildCrossUserTaskStatusChange(oldTask, { ...oldTask, ...update })).toEqual({
            ownerId: OWNER,
            actorId: CTO,
            transitionId: 'transition-1',
            estimation: 3,
            subtract: true,
            completed: 5000,
        })
    })

    test('a follow-up brief is appended to the AI step prompt, never replacing it', () => {
        const update = buildDoneTaskReactivationUpdate({
            task: doneTask(),
            workflow: hostWorkflow(),
            targetStepId: BUILD,
            actorUserId: OWNER,
            assistantId: CTO,
            now: 9000,
            note: '  Fix the regression the user found  ',
        })
        expect(update.workflowAiPromptOverride).toEqual({
            stepId: BUILD,
            prompt: 'Fix the regression the user found',
            mode: 'append',
            triggerMessageId: null,
            requestedByUserId: OWNER,
        })
    })

    test('Open hands the task back to its owner and clears the completion', () => {
        const update = buildDoneTaskReactivationUpdate({
            task: doneTask({ stepHistory: [-1] }),
            workflow: {},
            targetStepId: -1,
            actorUserId: OWNER,
            assistantId: CTO,
            now: 9000,
            note: 'ignored without an AI step',
        })
        expect(update).toMatchObject({
            stepHistory: [-1],
            userIds: [OWNER],
            currentReviewerId: OWNER,
            completed: null,
            completedTime: null,
            done: false,
            inDone: false,
            workflowAiPromptOverride: null,
        })
    })

    test('the origin conversation hears about the reopen once, and not when it asked for it itself', () => {
        const oldTask = doneTask()
        const fromTaskChat = buildDoneTaskReactivationUpdate({
            task: oldTask,
            workflow: hostWorkflow(),
            targetStepId: BUILD,
            actorUserId: OWNER,
            assistantId: CTO,
            now: 9000,
        })
        expect(
            classifyStepChange({ oldTask, newTask: { ...oldTask, ...fromTaskChat }, workflow: hostWorkflow() })
        ).toEqual({
            actorUserId: OWNER,
            fromConversation: null,
        })

        const fromAnna = buildDoneTaskReactivationUpdate({
            task: oldTask,
            workflow: hostWorkflow(),
            targetStepId: BUILD,
            actorUserId: OWNER,
            assistantId: CTO,
            now: 9000,
            fromConversation: { projectId: 'private', objectType: 'topics', objectId: 'anna-daily' },
        })
        expect(classifyStepChange({ oldTask, newTask: { ...oldTask, ...fromAnna }, workflow: hostWorkflow() })).toEqual(
            {
                actorUserId: OWNER,
                fromConversation: { projectId: 'private', objectType: 'topics', objectId: 'anna-daily' },
            }
        )
    })
})

describe('reactivateDoneTaskForAssistantWork', () => {
    test('reopens a done task into the AI step and moves its subtasks with it', async () => {
        seed(doneTask({ subtaskIds: ['sub-1'] }))
        mockStore.set(`items/${PROJECT}/tasks/sub-1`, { parentId: TASK, done: true, parentDone: true, inDone: true })

        const result = await reopen({ editorName: 'Alldone CTO' })

        expect(result).toMatchObject({
            reactivated: true,
            stepId: BUILD,
            stepLabel: 'AI: please build',
            landsOnAiStep: true,
        })
        expect(storedTask()).toMatchObject({
            done: false,
            inDone: false,
            stepHistory: [-1, BUILD],
            currentReviewerId: CTO,
            lastEditorName: 'Alldone CTO',
        })
        expect(mockStore.get(`items/${PROJECT}/tasks/sub-1`)).toMatchObject({
            stepHistory: [-1, BUILD],
            currentReviewerId: CTO,
            parentDone: false,
            inDone: false,
            // The subtask's own completion is its own, as in moveTasksFromDone.
            done: true,
        })
        expect(result.oldTask.done).toBe(true)
        expect(result.task.done).toBe(false)
    })

    test('without an AI step the task goes back to Open with its owner', async () => {
        seed(doneTask({ stepHistory: [-1] }), {})

        const result = await reopen()

        expect(result).toMatchObject({ reactivated: true, stepId: -1, stepLabel: 'Open', landsOnAiStep: false })
        expect(storedTask()).toMatchObject({
            done: false,
            currentReviewerId: OWNER,
            stepHistory: [-1],
            completed: null,
        })
    })

    test('is idempotent: a retried or concurrent second call changes nothing', async () => {
        seed()

        expect((await reopen()).reactivated).toBe(true)
        const afterFirst = { ...storedTask() }
        mockTransactionWrites.length = 0

        expect(await reopen({ now: () => 9999, createId: () => 'transition-2' })).toEqual({
            reactivated: false,
            reason: 'not_done',
        })
        expect(storedTask()).toEqual(afterFirst)
        expect(mockTransactionWrites).toEqual([])
    })

    test('leaves a task the user reopened in the app in the meantime where they put it', async () => {
        seed()
        const plannedRead = mockDb.runTransaction
        // The user moves it to "Check what AI did" between the plan and the transaction.
        mockDb.runTransaction = async handler => {
            mockStore.set(`items/${PROJECT}/tasks/${TASK}`, {
                ...doneTask(),
                done: false,
                inDone: false,
                stepHistory: [-1, BUILD, CHECK],
                currentReviewerId: OWNER,
            })
            return plannedRead(handler)
        }
        try {
            expect(await reopen()).toEqual({ reactivated: false, reason: 'not_done' })
        } finally {
            mockDb.runTransaction = plannedRead
        }
        expect(storedTask().stepHistory).toEqual([-1, BUILD, CHECK])
        expect(mockTransactionWrites).toEqual([])
    })

    test('an open task, a subtask and a missing task are not touched', async () => {
        seed(doneTask({ done: false, inDone: false, stepHistory: [-1, BUILD, CHECK] }))
        expect(await reopen()).toEqual({ reactivated: false, reason: 'not_done' })

        seed(doneTask({ parentId: 'parent' }))
        expect(await reopen()).toEqual({ reactivated: false, reason: 'not_done' })

        mockStore.clear()
        expect(await reopen()).toEqual({ reactivated: false, reason: 'not_done' })
        expect(mockTransactionWrites).toEqual([])
    })

    test('plans without writing', async () => {
        seed()
        const plan = await planDoneTaskReactivation({ db: mockDb, projectId: PROJECT, taskId: TASK, assistantId: CTO })
        expect(plan).toMatchObject({ targetStepId: BUILD, landsOnAiStep: true })
        expect(storedTask().done).toBe(true)
    })
})
