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
    ESTIMATION_TASKS_INDEX,
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
    publishOptimisticTaskSettled,
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
    /**
     * A snapshot whose result set is wider than its change list - the shape a cachedSnapshotGate
     * flush re-invokes the handler with (empty `docChanges()`, real `docs`).
     */
    const deliverSnapshotWithDocs = (changes, docs) => {
        listeners[0]({
            docChanges: () => changes,
            docs,
            size: docs.length,
            empty: docs.length === 0,
            forEach: callback => docs.forEach(callback),
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

    /**
     * AT-2500 - "I add a task and immediately move it to another date; the postpone happens but
     * the task is still shown in today's list."
     *
     * The optimistic row of AT-2342 is published from the document as it looked at CREATE time,
     * and both of the ways it used to become permanent live here. Every case therefore starts by
     * delivering an empty first snapshot: the initial snapshot goes through
     * `reconcileInitialSnapshotChanges`, which already rewrites a known `added` to `modified`, so
     * a test that publishes before the first snapshot exercises the one path that was never broken.
     */
    describe('AT-2500 a task postponed before its create was echoed', () => {
        const DAY = 24 * 60 * 60 * 1000
        /**
         * Settlement carries the document as the local cache holds it at ack time, which is the
         * create as amended by anything the user did since. `settle(id)` with no document is the
         * "cache could not be read" case and deliberately decides nothing.
         */
        const settle = (taskId, taskData) => publishOptimisticTaskSettled(PROJECT_ID, taskId, taskData)
        /** The document of a task postponed out of `dueDate <= endOfDay` before its first echo. */
        const postponedRaw = () => buildRawTask({ dueDate: Date.now() + DAY })

        const settledListener = () => {
            deliverRealSnapshot([])
            return buildRawTask({ dueDate: Date.now() })
        }

        it('re-buckets the row when the echo arrives as `added` carrying the postponed date', () => {
            // Firestore raises one `added` holding the FINAL document when the create and the
            // postpone are applied before the listener ever emitted. The old `notExistTask`
            // de-dupe threw that document away, keeping the create-time row in today's bucket.
            const todayRaw = settledListener()
            publishOptimisticTaskCreated(PROJECT_ID, 'task-1', todayRaw)
            expect(taskIdsOf(published[published.length - 1])).toEqual(['task-1'])

            deliverRealSnapshot([realAddedChange('task-1', buildRawTask({ dueDate: Date.now() + DAY }))])

            expect(taskIdsOf(published[published.length - 1])).toEqual([])
        })

        it('counts the row once, not twice, when that `added` keeps it in today', () => {
            // The de-dupe it replaces existed to stop a double insert, so the reconcile must not
            // reintroduce one - `amountOfTasksByDate` is what a double insert corrupts first.
            const todayRaw = settledListener()
            publishOptimisticTaskCreated(PROJECT_ID, 'task-1', todayRaw)
            deliverRealSnapshot([realAddedChange('task-1', { ...todayRaw, name: 'buy oat milk' })])

            const today = published[published.length - 1][0]
            expect(taskIdsOf(published[published.length - 1])).toEqual(['task-1'])
            expect(today[AMOUNT_TASKS_INDEX]).toBe(1)
        })

        it('retires the row on settlement when the postpone took it out of the query for good', () => {
            // The harder half: postponed past `dueDate <= endOfDay`, the document matches no
            // change this listener will ever receive - no `added` to correct it, no `removed` to
            // take it away. Only the write's server ack can say the echo is not coming.
            settledListener()
            publishOptimisticTaskCreated(PROJECT_ID, 'task-1', buildRawTask({ dueDate: Date.now() }))
            expect(taskIdsOf(published[published.length - 1])).toEqual(['task-1'])

            settle('task-1', postponedRaw())

            expect(taskIdsOf(published[published.length - 1])).toEqual([])
        })

        it('keeps the per-day totals honest when it retires that row', () => {
            settledListener()
            publishOptimisticTaskCreated(
                PROJECT_ID,
                'task-1',
                buildRawTask({ dueDate: Date.now(), estimations: { open: 30 } })
            )
            settle('task-1', buildRawTask({ dueDate: Date.now() + DAY, estimations: { open: 30 } }))

            const today = published[published.length - 1][0]
            expect(today[AMOUNT_TASKS_INDEX]).toBe(0)
            expect(today[ESTIMATION_TASKS_INDEX]).toBe(0)
        })

        it('leaves an ordinary create alone - settlement must not delete a task nobody moved', () => {
            // The regression this fix could most easily cause: every created task settles, so a
            // confirmed row must survive it untouched.
            const todayRaw = settledListener()
            publishOptimisticTaskCreated(PROJECT_ID, 'task-1', todayRaw)
            deliverRealSnapshot([realAddedChange('task-1', todayRaw)])

            settle('task-1')

            expect(taskIdsOf(published[published.length - 1])).toEqual(['task-1'])
            expect(published[published.length - 1][0][AMOUNT_TASKS_INDEX]).toBe(1)
        })

        it('treats a document seen in the result set as confirmed even with no change for it', () => {
            // Confirmation is read from `docs`, not `docChanges()`: a cachedSnapshotGate flush
            // re-invokes the handler with an empty `docChanges()` and the real `docs`, and that
            // flush must still count as "Firestore has offered this list the document".
            const todayRaw = settledListener()
            publishOptimisticTaskCreated(PROJECT_ID, 'task-1', todayRaw)
            deliverSnapshotWithDocs([], [{ id: 'task-1', data: () => todayRaw }])

            settle('task-1')

            expect(taskIdsOf(published[published.length - 1])).toEqual(['task-1'])
        })

        it('settling an unrelated task never touches the row', () => {
            const todayRaw = settledListener()
            publishOptimisticTaskCreated(PROJECT_ID, 'task-1', todayRaw)

            settle('some-other-task')

            expect(taskIdsOf(published[published.length - 1])).toEqual(['task-1'])
        })

        it('retires the row only once, however often the write settles', () => {
            // Cloud/undo paths can re-run a create; a second settlement must not decrement the
            // per-day counters again (the same idempotence the rollback publication needs).
            settledListener()
            publishOptimisticTaskCreated(PROJECT_ID, 'task-1', buildRawTask({ dueDate: Date.now() }))
            settle('task-1', postponedRaw())
            settle('task-1', postponedRaw())

            const today = published[published.length - 1][0]
            expect(today[AMOUNT_TASKS_INDEX]).toBe(0)
            expect(taskIdsOf(published[published.length - 1])).toEqual([])
        })

        it('does not let a LIMITED foreground window conclude the task is gone', () => {
            // Absence from a ten-document window says nothing about the project, so only a
            // complete listener may retire a row - the rule reconcileInitialSnapshotChanges
            // already applies to its own synthetic removals.
            jest.useFakeTimers()
            unwatchOpenTasks(PROJECT_ID, 'user-1')
            listeners.length = 0
            listenerUnsubscribes.length = 0
            queryRegistrations.length = 0
            published = []

            watchOpenTasks(PROJECT_ID, tasks => published.push(tasks), false, false, false, 'project-1user-1', false, {
                deferSecondaryStreams: true,
            })
            deliverSnapshot(0, [])
            expect(queryRegistrations[0].limits).toEqual([10])

            publishOptimisticTaskCreated(PROJECT_ID, 'task-1', buildRawTask({ dueDate: Date.now() }))
            settle('task-1', postponedRaw())

            expect(taskIdsOf(published[published.length - 1])).toEqual(['task-1'])
            unwatchOpenTasks(PROJECT_ID, 'user-1')
        })
    })

    /**
     * AT-2500 follow-up - "I add a task, it shows up, then it disappears for a second and comes
     * back."
     *
     * The first fix retired the optimistic row whenever the server had acknowledged the create and
     * no snapshot had mentioned the task yet, reasoning that a local `added` always beats the round
     * trip. In this codebase it never does, and not by a narrow margin: every query this watcher
     * runs filters on `readerIds` (or `roleIdsVisibleTo.<reader>`), a SERVER-derived projection
     * field the access rules forbid a client to write - see `utils/backends/accessProjection.js`.
     * A locally created task therefore carries no `readerIds`, matches nothing locally, and gets no
     * local echo at all; the first snapshot naming it is the one that follows `onCreateTask` ->
     * `synchronizeAccessProjection` writing the projection server-side. So the ack won that race on
     * EVERY create and the row was pulled out from under the user for a round trip.
     *
     * These cases therefore assert over the whole publish sequence rather than its last entry: the
     * defect is entirely an intermediate state, and every "final state" assertion above stayed
     * green all the way through it.
     */
    describe('AT-2500 follow-up: a create must never blink out', () => {
        const DAY_MS = 24 * 60 * 60 * 1000
        const settle = (taskId, taskData) => publishOptimisticTaskSettled(PROJECT_ID, taskId, taskData)
        const todayRaw = () => buildRawTask({ dueDate: Date.now() })

        /** Every rendered state since the create, as plain id lists. */
        const renderedStates = () => published.map(taskIdsOf)

        it('never renders a frame without the task, from the create to the echo', () => {
            deliverRealSnapshot([])
            const raw = todayRaw()
            published = []

            // Production order: publish, ack (no echo yet - see above), then the snapshot that
            // only becomes possible once the access projection has landed.
            publishOptimisticTaskCreated(PROJECT_ID, 'task-1', raw)
            settle('task-1', raw)
            deliverRealSnapshot([realAddedChange('task-1', raw)])

            expect(published.length).toBeGreaterThan(0)
            expect(renderedStates()).not.toContainEqual([])
            renderedStates().forEach(ids => expect(ids).toEqual(['task-1']))
        })

        it('never lets the per-day count dip to zero across that sequence', () => {
            // The count drives the "N tasks" header, so a dip is visible in its own right.
            deliverRealSnapshot([])
            const raw = todayRaw()
            published = []

            publishOptimisticTaskCreated(PROJECT_ID, 'task-1', raw)
            settle('task-1', raw)
            deliverRealSnapshot([realAddedChange('task-1', raw)])

            published.forEach(state => expect(state[0][AMOUNT_TASKS_INDEX]).toBe(1))
        })

        it('refreshes the row in place when the settled document changed but still belongs', () => {
            // A rename, or a postpone to later the same day: the row must pick the change up
            // without ever leaving the list. This is the upsert half of the contract.
            deliverRealSnapshot([])
            published = []
            publishOptimisticTaskCreated(PROJECT_ID, 'task-1', todayRaw())

            settle('task-1', { ...todayRaw(), name: 'buy oat milk', extendedName: 'buy oat milk' })

            renderedStates().forEach(ids => expect(ids).toEqual(['task-1']))
            const rendered = mainTasksOf(published[published.length - 1]).flatMap(([, tasks]) => tasks)
            expect(rendered).toHaveLength(1)
            expect(rendered[0].name).toBe('buy oat milk')
            expect(published[published.length - 1][0][AMOUNT_TASKS_INDEX]).toBe(1)
        })

        it('keeps the row when settlement carries no document at all', () => {
            // `null` means the local cache could not be read, i.e. no verdict. Removing on no
            // verdict is exactly the mistake being fixed, so the row has to stand.
            deliverRealSnapshot([])
            published = []
            publishOptimisticTaskCreated(PROJECT_ID, 'task-1', todayRaw())

            settle('task-1', null)

            renderedStates().forEach(ids => expect(ids).toEqual(['task-1']))
        })

        it('still removes the row in ONE step when the settled document was postponed away', () => {
            // The AT-2500 guarantee, restated over the sequence: the postponed task leaves today
            // and is never re-added afterwards by the projection snapshot.
            deliverRealSnapshot([])
            published = []
            publishOptimisticTaskCreated(PROJECT_ID, 'task-1', todayRaw())
            expect(taskIdsOf(published[published.length - 1])).toEqual(['task-1'])

            settle('task-1', buildRawTask({ dueDate: Date.now() + DAY_MS }))

            expect(taskIdsOf(published[published.length - 1])).toEqual([])
            expect(published[published.length - 1][0][AMOUNT_TASKS_INDEX]).toBe(0)
        })
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
