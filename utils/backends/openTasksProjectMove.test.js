/**
 * AT-3156: a task moved to another project leaves the source board at once and
 * appears in the destination board at once, through the REAL open-tasks watcher pipeline. The
 * Firestore traffic of a real move (the server's marker write, then the source deletion) must not
 * bring the row back or corrupt the per-day count, and a rolled-back move must restore it.
 * The harness is the one of openTasksOptimisticCreate.test.js.
 */

const mockDispatch = jest.fn()

const mockState = {
    currentUser: { uid: 'user-1', workstreams: {} },
    loggedUser: { uid: 'user-1', isAnonymous: false, numberTodayTasks: 10 },
    globalDataByProject: {},
    taskListWatchersVars: {},
    hashtagFilters: new Map(),
    taskPriorityFilters: [],
    taskVmStateFilters: [],
    taskVmStatesByTask: {},
    subtaskByTaskStore: {},
    taskListSingleLoading: {},
}

jest.mock('../../redux/store', () => ({
    dispatch: (...args) => mockDispatch(...args),
    getState: () => mockState,
}))

jest.mock('../../components/TaskListView/Utils/TasksHelper', () => ({
    BACKLOG_DATE_NUMERIC: Number.MAX_SAFE_INTEGER,
    BACKLOG_DATE_STRING: 'Someday',
}))

jest.mock('../../components/Workstreams/WorkstreamHelper', () => ({
    DEFAULT_WORKSTREAM_ID: 'default',
    WORKSTREAM_ID_PREFIX: 'ws_',
}))

jest.mock('../../components/GoalsView/GoalsHelper', () => ({
    BACKLOG_MILESTONE_ID: 'backlog',
    DYNAMIC_PERCENT: 'dynamic',
    getOwnerId: jest.fn(),
}))

jest.mock('../../components/HashtagFilters/FilterHelpers/FilterTasks', () => ({
    filterOpenTasks: jest.fn(tasks => tasks),
}))

jest.mock('../../components/TaskListView/PriorityFilters/taskPriorityFilterHelper', () => ({
    filterOpenTasksSectionsByPriority: jest.fn(tasks => tasks),
    filterOpenTasksSectionsByVmState: jest.fn(tasks => tasks),
}))

jest.mock('../EstimationHelper', () => ({
    ESTIMATION_0_MIN: 0,
    getEstimationRealValue: jest.fn((projectId, estimation) => estimation),
}))

// Every listener registered by watchOpenTasks lands here so a test can drive the one it wants.
const listeners = []
const listenerUnsubscribes = []
const listenerErrors = []
const queryRegistrations = []

const buildQuery = () => {
    const registration = { limits: [], where: [] }
    queryRegistrations.push(registration)
    const query = {
        where: (...args) => {
            registration.where.push(args)
            return query
        },
        orderBy: () => query,
        limit: value => {
            registration.limits.push(value)
            return query
        },
        onSnapshot: (...args) => {
            // Called either as (handler) or as (options, handler).
            const handler = typeof args[0] === 'function' ? args[0] : args[1]
            const unsubscribe = jest.fn()
            listeners.push(handler)
            listenerErrors.push(typeof args[0] === 'function' ? args[1] : args[2])
            listenerUnsubscribes.push(unsubscribe)
            return unsubscribe
        },
    }
    return query
}

/**
 * The task documents `optimisticTaskSettlement` reads and watches, keyed by path, so a test can
 * drive the REAL settlement window end to end into the REAL watcher instead of hand-publishing the
 * events it is supposed to produce.
 */
const documents = new Map()

const documentState = path => {
    if (!documents.has(path)) documents.set(path, { data: null, listeners: [], unsubscribes: [] })
    return documents.get(path)
}

const buildDocument = path => ({
    get: async () => {
        const { data } = documentState(path)
        return { exists: !!data, data: () => data }
    },
    onSnapshot: (options, handler) => {
        const state = documentState(path)
        const unsubscribe = jest.fn()
        state.listeners.push(handler)
        state.unsubscribes.push(unsubscribe)
        return unsubscribe
    },
})

jest.mock('./firestore', () => ({
    getDb: () => ({ collection: () => buildQuery(), doc: path => buildDocument(path) }),
    globalWatcherUnsub: {},
    mapGoalData: jest.fn(),
    mapMilestoneData: jest.fn(),
    // The pipeline maps the raw document itself; the id is the doc key, never a stored field.
    mapTaskData: (id, data) => ({ id, ...data }),
}))

import { AMOUNT_TASKS_INDEX, MAIN_TASK_INDEX, unwatchOpenTasks, watchOpenTasks } from './openTasks'
import { resetOpenTasksBackgroundHydrationQueue } from './openTasksBackgroundQueue'
import { resetOptimisticTaskCreates } from './Tasks/optimisticTaskCreate'
import { stopAllOptimisticTaskSettlements } from './Tasks/optimisticTaskSettlement'
import { resetLocalTaskProjectMoves } from './Tasks/localTaskProjectMoves'
import { startOptimisticTaskProjectMove } from './Tasks/optimisticTaskProjectMove'

const SOURCE = 'project-a'
const TARGET = 'project-b'

const buildRawTask = (overrides = {}) => ({
    name: 'buy milk',
    extendedName: 'buy milk',
    inDone: false,
    done: false,
    completed: null,
    currentReviewerId: 'user-1',
    userId: 'user-1',
    userIds: ['user-1'],
    isPublicFor: [0, 'user-1'],
    observersIds: [],
    dueDateByObserversIds: {},
    estimationsByObserverIds: {},
    dueDate: Date.now(),
    estimations: { open: 0 },
    stepHistory: ['open'],
    sortIndex: 100,
    parentId: null,
    parentGoalId: null,
    parentGoalIsPublicFor: null,
    genericData: null,
    suggestedBy: null,
    subtaskIds: [],
    priority: 'none',
    ...overrides,
})

const markedAsMoving = (requestedAt = Date.now()) => ({
    ...buildRawTask(),
    movingToOtherProjectId: TARGET,
    projectMove: { status: 'moving', sourceProjectId: SOURCE, targetProjectId: TARGET, requestedAt },
})

const taskIdsOf = dayTuples =>
    (dayTuples?.[0]?.[MAIN_TASK_INDEX] || []).flatMap(([, tasks]) => tasks.map(task => task.id))
const flush = () => new Promise(resolve => setImmediate(resolve))

describe('optimistic task project move in the open board', () => {
    const published = { [SOURCE]: [], [TARGET]: [] }
    const listenerIndexByProject = {}
    const latest = projectId => published[projectId][published[projectId].length - 1]

    const deliver = (projectId, changes) => {
        listeners[listenerIndexByProject[projectId]]({
            docChanges: () => changes,
            docs: changes.filter(item => item.type !== 'removed').map(item => item.doc),
            size: changes.length,
            empty: changes.length === 0,
            forEach: callback => changes.forEach(item => callback(item.doc)),
            metadata: { fromCache: false, hasPendingWrites: false },
        })
    }
    const change = (type, id, data) => ({ type, doc: { id, data: () => data } })

    beforeEach(() => {
        listeners.length = 0
        listenerUnsubscribes.length = 0
        queryRegistrations.length = 0
        documents.clear()
        stopAllOptimisticTaskSettlements()
        resetOptimisticTaskCreates()
        resetLocalTaskProjectMoves()
        resetOpenTasksBackgroundHydrationQueue()
        mockDispatch.mockClear()
        mockState.globalDataByProject = {}
        published[SOURCE] = []
        published[TARGET] = []

        // Each project registers its assigned-task listener first; remember which one is which.
        listenerIndexByProject[SOURCE] = listeners.length
        watchOpenTasks(SOURCE, tasks => published[SOURCE].push(tasks), false, false, false, `${SOURCE}user-1`)
        listenerIndexByProject[TARGET] = listeners.length
        watchOpenTasks(TARGET, tasks => published[TARGET].push(tasks), false, false, false, `${TARGET}user-1`)

        const raw = buildRawTask()
        documentState(`items/${SOURCE}/tasks/task-1`).data = raw
        deliver(SOURCE, [change('added', 'task-1', raw)])
        deliver(TARGET, [])
    })

    afterEach(() => {
        unwatchOpenTasks(SOURCE, 'user-1')
        unwatchOpenTasks(TARGET, 'user-1')
        resetLocalTaskProjectMoves()
    })

    const startMove = () =>
        startOptimisticTaskProjectMove({
            sourceProjectId: SOURCE,
            targetProject: { id: TARGET, userIds: ['user-1'] },
            task: { id: 'task-1', subtaskIds: [] },
            actorId: 'user-1',
        })

    it('takes the row out of the source and shows it in the destination at once', async () => {
        expect(taskIdsOf(latest(SOURCE))).toEqual(['task-1'])

        startMove()
        expect(taskIdsOf(latest(SOURCE))).toEqual([])
        expect(latest(SOURCE)[0][AMOUNT_TASKS_INDEX]).toBe(0)

        await flush()
        expect(taskIdsOf(latest(TARGET))).toEqual(['task-1'])
        const [[, [arriving]]] = latest(TARGET)[0][MAIN_TASK_INDEX]
        expect(arriving.projectMove).toEqual(
            expect.objectContaining({ status: 'moving', sourceProjectId: SOURCE, targetProjectId: TARGET })
        )
    })

    it('keeps the row away through the server marker and the source deletion, counting it once', async () => {
        const move = startMove()
        await flush()

        deliver(SOURCE, [change('modified', 'task-1', markedAsMoving())])
        expect(taskIdsOf(latest(SOURCE))).toEqual([])

        documentState(`items/${SOURCE}/tasks/task-1`).data = null
        deliver(SOURCE, [change('removed', 'task-1', markedAsMoving())])
        move.complete()
        await flush()

        expect(taskIdsOf(latest(SOURCE))).toEqual([])
        expect(latest(SOURCE)[0][AMOUNT_TASKS_INDEX]).toBe(0)
    })

    it('lists the destination task once when the real copy arrives', async () => {
        startMove()
        await flush()

        const realCopy = {
            ...buildRawTask({ sortIndex: 500 }),
            projectMove: { status: 'completed', sourceProjectId: SOURCE, targetProjectId: TARGET },
        }
        deliver(TARGET, [change('added', 'task-1', realCopy)])

        expect(taskIdsOf(latest(TARGET))).toEqual(['task-1'])
        expect(latest(TARGET)[0][AMOUNT_TASKS_INDEX]).toBe(1)
        const [[, [settled]]] = latest(TARGET)[0][MAIN_TASK_INDEX]
        expect(settled.projectMove.status).toBe('completed')
    })

    it('hides a task another tab is moving as soon as the server marker arrives', () => {
        deliver(SOURCE, [change('modified', 'task-1', markedAsMoving())])

        expect(taskIdsOf(latest(SOURCE))).toEqual([])
        expect(latest(SOURCE)[0][AMOUNT_TASKS_INDEX]).toBe(0)
    })

    it('still shows a task whose move marker is long stale', () => {
        deliver(SOURCE, [change('modified', 'task-1', markedAsMoving(1))])

        expect(taskIdsOf(latest(SOURCE))).toEqual(['task-1'])
    })

    it('shows the task again when the server records the move as failed', () => {
        deliver(SOURCE, [change('modified', 'task-1', markedAsMoving())])
        deliver(SOURCE, [
            change('modified', 'task-1', {
                ...buildRawTask(),
                movingToOtherProjectId: null,
                projectMove: { status: 'failed', sourceProjectId: SOURCE, targetProjectId: TARGET },
            }),
        ])

        expect(taskIdsOf(latest(SOURCE))).toEqual(['task-1'])
        expect(latest(SOURCE)[0][AMOUNT_TASKS_INDEX]).toBe(1)
    })

    it('puts the row back and removes the destination copy when the move is rolled back', async () => {
        const move = startMove()
        await flush()

        move.rollback()
        await flush()

        expect(taskIdsOf(latest(SOURCE))).toEqual(['task-1'])
        expect(latest(SOURCE)[0][AMOUNT_TASKS_INDEX]).toBe(1)
        expect(taskIdsOf(latest(TARGET))).toEqual([])
    })
})
