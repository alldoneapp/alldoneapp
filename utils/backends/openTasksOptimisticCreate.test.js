/**
 * AT-2342 - a newly created task must be on screen immediately, not one Firestore round trip later.
 *
 * These tests drive the REAL open-tasks watcher pipeline (`watchOpenTasks` ->
 * `processTaskChanges` -> `generateOpenTasksArray`) with a fake Firestore, because the two things
 * worth pinning only exist in that pipeline:
 *
 *  1. an optimistically published task reaches the rendered day tuple in the same tick, and
 *  2. when the real snapshot for the SAME id arrives afterwards, the task is still listed once.
 *
 * (2) is the whole risk of an optimistic insert and it is invisible in a unit test of the bus:
 * the de-dupe lives in `processTaskChange`'s `added` branch (`!tasksMap.userTasksById[task.id]`),
 * which only runs when the change actually travels through the pipeline.
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
            listenerUnsubscribes.push(unsubscribe)
            return unsubscribe
        },
    }
    return query
}

jest.mock('./firestore', () => ({
    getDb: () => ({ collection: () => buildQuery(), doc: () => buildQuery() }),
    globalWatcherUnsub: {},
    mapGoalData: jest.fn(),
    mapMilestoneData: jest.fn(),
    // The pipeline maps the raw document itself; the id is the doc key, never a stored field.
    mapTaskData: (id, data) => ({ id, ...data }),
}))

import {
    AMOUNT_TASKS_INDEX,
    DEFERRED_FULL_ASSIGNED_TASK_STREAM_DELAY_MS,
    DEFERRED_OBSERVED_TASK_STREAM_DELAY_MS,
    DEFERRED_REMAINING_TASK_STREAMS_DELAY_MS,
    MAIN_TASK_INDEX,
    matchesOpenTasksQuery,
    unwatchOpenTasks,
    watchOpenTasks,
} from './openTasks'
import { resetOpenTasksBackgroundHydrationQueue } from './openTasksBackgroundQueue'
import {
    publishOptimisticTaskCreateFailed,
    publishOptimisticTaskCreated,
    resetOptimisticTaskCreates,
} from './Tasks/optimisticTaskCreate'

const PROJECT_ID = 'project-1'

const buildRawTask = (overrides = {}) => ({
    name: 'buy milk',
    extendedName: 'buy milk',
    inDone: false,
    done: false,
    completed: null,
    currentReviewerId: 'user-1',
    userId: 'user-1',
    userIds: ['user-1'],
    isPublicFor: [0],
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
    priority: 'none',
    ...overrides,
})

/** The `[goalId, tasks]` groups of the main bucket of the first (today) day tuple. */
const mainTasksOf = dayTuples => {
    const today = dayTuples && dayTuples[0]
    if (!today) return []
    return today[MAIN_TASK_INDEX] || []
}

const taskIdsOf = dayTuples => mainTasksOf(dayTuples).flatMap(([, tasks]) => tasks.map(task => task.id))

describe('AT-2342 optimistic task insert in the open board', () => {
    let published

    beforeEach(() => {
        listeners.length = 0
        listenerUnsubscribes.length = 0
        queryRegistrations.length = 0
        published = []
        mockDispatch.mockClear()
        resetOptimisticTaskCreates()
        mockState.globalDataByProject = {}
        mockState.loggedUser.numberTodayTasks = 10
        resetOpenTasksBackgroundHydrationQueue()

        watchOpenTasks(PROJECT_ID, tasks => published.push(tasks), false, false, false, 'project-1user-1')
    })

    afterEach(() => jest.useRealTimers())

    const deliverSnapshot = (listenerIndex, changes) => {
        listeners[listenerIndex]({
            docChanges: () => changes,
            docs: changes.map(change => change.doc),
            size: changes.length,
            empty: changes.length === 0,
            forEach: callback => changes.forEach(change => callback(change.doc)),
            // A snapshot the listener is in sync with the server for, i.e. not gate-buffered.
            metadata: { fromCache: false, hasPendingWrites: false },
        })
    }
    /** Feeds a change through the FIRST registered listener - the logged user's own open tasks. */
    const deliverRealSnapshot = changes => deliverSnapshot(0, changes)

    const realAddedChange = (taskId, raw) => ({ type: 'added', doc: { id: taskId, data: () => raw } })

    it('renders a just-created task without waiting for any snapshot', () => {
        const raw = buildRawTask()

        publishOptimisticTaskCreated(PROJECT_ID, 'task-1', raw)

        expect(published.length).toBeGreaterThan(0)
        expect(taskIdsOf(published[published.length - 1])).toEqual(['task-1'])
    })

    it('lists the task exactly once when the real snapshot arrives afterwards', () => {
        const raw = buildRawTask()

        publishOptimisticTaskCreated(PROJECT_ID, 'task-1', raw)
        deliverRealSnapshot([realAddedChange('task-1', raw)])

        expect(taskIdsOf(published[published.length - 1])).toEqual(['task-1'])
    })

    it('keeps the per-day task count at one across the optimistic insert and its echo', () => {
        // The count is what a double insert corrupts first, and it is what the "N tasks" header
        // and the all-projects summary read.
        const raw = buildRawTask()

        publishOptimisticTaskCreated(PROJECT_ID, 'task-1', raw)
        deliverRealSnapshot([realAddedChange('task-1', raw)])

        expect(published[published.length - 1][0][AMOUNT_TASKS_INDEX]).toBe(1)
    })

    it('groups an optimistic task under its goal, exactly like a snapshot would', () => {
        const raw = buildRawTask({ parentGoalId: 'goal-1', parentGoalIsPublicFor: [0] })

        publishOptimisticTaskCreated(PROJECT_ID, 'task-1', raw)

        expect(mainTasksOf(published[published.length - 1])[0][0]).toBe('goal-1')
    })

    it('marks an empty assigned stream ready when the observed stream populated the project first', () => {
        const observedTask = buildRawTask({
            currentReviewerId: 'user-2',
            observersIds: ['user-1'],
            dueDateByObserversIds: { 'user-1': Date.now() },
            estimationsByObserverIds: { 'user-1': 0 },
        })

        deliverSnapshot(1, [realAddedChange('observed-task-1', observedTask)])
        mockDispatch.mockClear()
        deliverSnapshot(0, [])

        const actions = mockDispatch.mock.calls.flatMap(([action]) => (Array.isArray(action) ? action : [action]))
        expect(actions).toContainEqual({
            type: 'Update initial loading end open tasks',
            instanceKey: 'project-1user-1',
            initialLoadingEndOpenTasks: true,
        })
    })

    it('stages secondary All Projects streams behind the first assigned snapshot', () => {
        jest.useFakeTimers()
        unwatchOpenTasks(PROJECT_ID, 'user-1')
        listeners.length = 0
        listenerUnsubscribes.length = 0
        queryRegistrations.length = 0

        watchOpenTasks(PROJECT_ID, tasks => published.push(tasks), false, false, false, 'project-1user-1', false, {
            deferSecondaryStreams: true,
        })

        expect(listeners).toHaveLength(1)
        deliverSnapshot(0, [])

        expect(queryRegistrations[0].where).toContainEqual(['parentId', '==', null])
        expect(queryRegistrations[0].limits).toEqual([10])

        jest.advanceTimersByTime(DEFERRED_FULL_ASSIGNED_TASK_STREAM_DELAY_MS - 1)
        expect(listeners).toHaveLength(1)
        jest.advanceTimersByTime(1)
        expect(listeners).toHaveLength(2)
        expect(queryRegistrations[1].where).not.toContainEqual(['parentId', '==', null])
        expect(queryRegistrations[1].limits).toEqual([])

        deliverSnapshot(1, [])
        expect(listenerUnsubscribes[0]).toHaveBeenCalledTimes(1)

        jest.advanceTimersByTime(DEFERRED_OBSERVED_TASK_STREAM_DELAY_MS)
        expect(listeners).toHaveLength(3)

        jest.advanceTimersByTime(DEFERRED_REMAINING_TASK_STREAMS_DELAY_MS - DEFERRED_OBSERVED_TASK_STREAM_DELAY_MS)
        expect(listeners).toHaveLength(5)

        unwatchOpenTasks(PROJECT_ID, 'user-1')
    })

    it('cancels staged streams when the project leaves the board', () => {
        jest.useFakeTimers()
        unwatchOpenTasks(PROJECT_ID, 'user-1')
        listeners.length = 0
        listenerUnsubscribes.length = 0
        queryRegistrations.length = 0

        watchOpenTasks(PROJECT_ID, tasks => published.push(tasks), false, false, false, 'project-1user-1', false, {
            deferSecondaryStreams: true,
        })
        deliverSnapshot(0, [])
        unwatchOpenTasks(PROJECT_ID, 'user-1')
        jest.runAllTimers()

        expect(listeners).toHaveLength(1)
    })

    it('publishes the small foreground page before merging the complete project in the background', () => {
        jest.useFakeTimers()
        unwatchOpenTasks(PROJECT_ID, 'user-1')
        listeners.length = 0
        listenerUnsubscribes.length = 0
        queryRegistrations.length = 0
        published = []

        watchOpenTasks(PROJECT_ID, tasks => published.push(tasks), false, false, false, 'project-1user-1', false, {
            deferSecondaryStreams: true,
        })

        const firstTask = buildRawTask({ name: 'foreground' })
        const secondTask = buildRawTask({ name: 'background', sortIndex: 90 })
        deliverSnapshot(0, [realAddedChange('task-1', firstTask)])
        expect(taskIdsOf(published[published.length - 1])).toEqual(['task-1'])

        jest.advanceTimersByTime(DEFERRED_FULL_ASSIGNED_TASK_STREAM_DELAY_MS)
        deliverSnapshot(1, [realAddedChange('task-1', firstTask), realAddedChange('task-2', secondTask)])

        expect(taskIdsOf(published[published.length - 1])).toEqual(['task-1', 'task-2'])
        expect(listenerUnsubscribes[0]).toHaveBeenCalledTimes(1)

        unwatchOpenTasks(PROJECT_ID, 'user-1')
    })

    it('keeps unlimited mode on one complete assigned-task query', () => {
        jest.useFakeTimers()
        unwatchOpenTasks(PROJECT_ID, 'user-1')
        listeners.length = 0
        listenerUnsubscribes.length = 0
        queryRegistrations.length = 0
        mockState.loggedUser.numberTodayTasks = 0

        watchOpenTasks(PROJECT_ID, jest.fn(), false, false, false, 'project-1user-1', false, {
            deferSecondaryStreams: true,
        })

        expect(queryRegistrations[0].where).not.toContainEqual(['parentId', '==', null])
        expect(queryRegistrations[0].limits).toEqual([])
        deliverSnapshot(0, [])
        jest.advanceTimersByTime(DEFERRED_FULL_ASSIGNED_TASK_STREAM_DELAY_MS)
        expect(listeners).toHaveLength(1)

        unwatchOpenTasks(PROJECT_ID, 'user-1')
    })

    it('reuses a same-session snapshot and reconciles it against the next complete listener', () => {
        jest.useFakeTimers()
        unwatchOpenTasks(PROJECT_ID, 'user-1')
        listeners.length = 0
        listenerUnsubscribes.length = 0
        queryRegistrations.length = 0
        published = []
        mockDispatch.mockClear()
        mockState.loggedUser.numberTodayTasks = 0

        watchOpenTasks(PROJECT_ID, tasks => published.push(tasks), false, false, false, 'project-1user-1')

        const retainedTask = buildRawTask({ name: 'cached name' })
        const removedTask = buildRawTask({ name: 'completed elsewhere', sortIndex: 90 })
        deliverSnapshot(0, [
            realAddedChange('retained-task', retainedTask),
            realAddedChange('removed-task', removedTask),
        ])

        const firstActions = mockDispatch.mock.calls.flatMap(([action]) => (Array.isArray(action) ? action : [action]))
        const retainedGlobalDataAction = firstActions
            .filter(action => action.type === 'Set global data by project')
            .pop()
        mockState.globalDataByProject = retainedGlobalDataAction.globalDataByProject

        mockDispatch.mockClear()
        unwatchOpenTasks(PROJECT_ID, 'user-1', { preserveData: true })
        expect(
            mockDispatch.mock.calls
                .flatMap(([action]) => (Array.isArray(action) ? action : [action]))
                .some(action => action.type === 'Set global data by project')
        ).toBe(false)

        listeners.length = 0
        listenerUnsubscribes.length = 0
        queryRegistrations.length = 0
        published = []

        watchOpenTasks(PROJECT_ID, tasks => published.push(tasks), false, false, true, 'project-1user-1')

        // Reattaching does not publish an empty replacement over the retained Redux rows.
        expect(published).toEqual([])

        const refreshedTask = buildRawTask({ name: 'fresh name' })
        const addedTask = buildRawTask({ name: 'created elsewhere', sortIndex: 80 })
        deliverSnapshot(0, [realAddedChange('retained-task', refreshedTask), realAddedChange('added-task', addedTask)])

        const latestTasks = mainTasksOf(published[published.length - 1]).flatMap(([, tasks]) => tasks)
        expect(latestTasks.map(task => task.id)).toEqual(['retained-task', 'added-task'])
        expect(latestTasks.find(task => task.id === 'retained-task').name).toBe('fresh name')

        unwatchOpenTasks(PROJECT_ID, 'user-1')
    })

    it('keeps a fourteen-project discovery window to one foreground query per project', () => {
        jest.useFakeTimers()
        unwatchOpenTasks(PROJECT_ID, 'user-1')
        listeners.length = 0
        listenerUnsubscribes.length = 0
        queryRegistrations.length = 0
        const projectIds = Array.from({ length: 14 }, (_, index) => `project-${index}`)

        projectIds.forEach(projectId =>
            watchOpenTasks(projectId, jest.fn(), false, false, false, `${projectId}user-1`, false, {
                deferSecondaryStreams: true,
            })
        )

        expect(listeners).toHaveLength(14)
        Array.from({ length: 14 }, (_, index) => index).forEach(listenerIndex => deliverSnapshot(listenerIndex, []))

        jest.advanceTimersByTime(DEFERRED_FULL_ASSIGNED_TASK_STREAM_DELAY_MS)
        expect(listeners).toHaveLength(16)

        // Completing one background snapshot releases exactly one slot for the next project.
        for (let index = 0; index < 14; index++) deliverSnapshot(14 + index, [])
        expect(listeners).toHaveLength(28)

        jest.advanceTimersByTime(DEFERRED_OBSERVED_TASK_STREAM_DELAY_MS)
        expect(listeners).toHaveLength(42)
        jest.advanceTimersByTime(DEFERRED_REMAINING_TASK_STREAMS_DELAY_MS - DEFERRED_OBSERVED_TASK_STREAM_DELAY_MS)
        expect(listeners).toHaveLength(70)

        projectIds.forEach(projectId => unwatchOpenTasks(projectId, 'user-1'))
    })

    it('removes the row again when the write is rejected', () => {
        const raw = buildRawTask()

        publishOptimisticTaskCreated(PROJECT_ID, 'task-1', raw)
        publishOptimisticTaskCreateFailed(PROJECT_ID, 'task-1', raw)

        expect(taskIdsOf(published[published.length - 1])).toEqual([])
    })

    it('treats the rollback as idempotent, so the double removal cannot corrupt the count', () => {
        // A rejected write is rolled back twice: once explicitly, and once by Firestore reverting
        // its own local mutation (which arrives as a real `removed` change). `deleteTask`
        // decrements the per-day counters every time it runs, so the second one must be a no-op.
        const raw = buildRawTask()

        publishOptimisticTaskCreated(PROJECT_ID, 'task-1', raw)
        publishOptimisticTaskCreateFailed(PROJECT_ID, 'task-1', raw)
        publishOptimisticTaskCreateFailed(PROJECT_ID, 'task-1', raw)

        expect(published[published.length - 1][0][AMOUNT_TASKS_INDEX]).toBe(0)
    })

    it('ignores a task that belongs to somebody else', () => {
        publishOptimisticTaskCreated(PROJECT_ID, 'task-1', buildRawTask({ currentReviewerId: 'user-2' }))

        expect(published).toHaveLength(0)
    })

    it('ignores a task published for a different project', () => {
        publishOptimisticTaskCreated('other-project', 'task-1', buildRawTask())

        expect(published).toHaveLength(0)
    })

    it('ignores a task due later than the window this list is showing', () => {
        // The collapsed board queries `dueDate <= endOfDay`; a task due next week is not "lost",
        // it is simply in a part of the list that is not on screen.
        const nextWeek = Date.now() + 7 * 24 * 60 * 60 * 1000
        publishOptimisticTaskCreated(PROJECT_ID, 'task-1', buildRawTask({ dueDate: nextWeek }))

        expect(published).toHaveLength(0)
    })
})

describe('AT-2342 matchesOpenTasksQuery mirrors getOpenTasksQuery', () => {
    const loggedUser = { uid: 'user-1', isAnonymous: false }
    const endOfDay = 1000
    const endOfTomorrow = 2000
    const base = {
        areObservedTasks: false,
        currentUserId: 'user-1',
        loggedUser,
        showLaterTasks: false,
        showSomedayTasks: false,
        endOfDay,
        endOfTomorrow,
    }
    const task = (overrides = {}) => ({
        inDone: false,
        currentReviewerId: 'user-1',
        isPublicFor: [0],
        observersIds: [],
        dueDate: 500,
        ...overrides,
    })

    it('accepts the logged user’s own open task due today', () => {
        expect(matchesOpenTasksQuery(task(), base)).toBe(true)
    })

    it('rejects a task already in done', () => {
        expect(matchesOpenTasksQuery(task({ inDone: true }), base)).toBe(false)
    })

    it('rejects a task whose current reviewer is somebody else', () => {
        expect(matchesOpenTasksQuery(task({ currentReviewerId: 'user-2' }), base)).toBe(false)
    })

    it('rejects a private task this user cannot see', () => {
        expect(matchesOpenTasksQuery(task({ isPublicFor: ['user-2'] }), base)).toBe(false)
    })

    it('accepts a private task this user is explicitly on', () => {
        expect(matchesOpenTasksQuery(task({ isPublicFor: ['user-1'] }), base)).toBe(true)
    })

    describe('the three date windows', () => {
        it('state 0 shows today only', () => {
            expect(matchesOpenTasksQuery(task({ dueDate: 1500 }), base)).toBe(false)
        })

        it('state 1 shows today and tomorrow but never Someday', () => {
            const state1 = { ...base, showLaterTasks: true }
            expect(matchesOpenTasksQuery(task({ dueDate: 1500 }), state1)).toBe(true)
            expect(matchesOpenTasksQuery(task({ dueDate: 2500 }), state1)).toBe(false)
            expect(matchesOpenTasksQuery(task({ dueDate: Number.MAX_SAFE_INTEGER }), state1)).toBe(false)
        })

        it('state 2 shows everything including Someday', () => {
            const state2 = { ...base, showLaterTasks: true, showSomedayTasks: true }
            expect(matchesOpenTasksQuery(task({ dueDate: Number.MAX_SAFE_INTEGER }), state2)).toBe(true)
        })
    })

    describe('the observed-tasks branch', () => {
        const observedBase = { ...base, areObservedTasks: true }

        it('accepts a task this user observes', () => {
            expect(matchesOpenTasksQuery(task({ observersIds: ['user-1'] }), observedBase)).toBe(true)
        })

        it('rejects a task this user does not observe', () => {
            expect(matchesOpenTasksQuery(task({ observersIds: ['user-2'] }), observedBase)).toBe(false)
        })
    })
})
