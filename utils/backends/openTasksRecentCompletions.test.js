/**
 * A task completed on another device must leave this device's open board as soon as the
 * completion prefetch has proven it done - not after the complete per-project listener gets its
 * queue slot and Firestore has re-fetched the document on its own (limbo resolution).
 *
 * Drives the REAL watcher pipeline (`watchOpenTasks` -> `processTaskChanges` ->
 * `generateOpenTasksArray`) and the REAL prefetch module against a fake Firestore, because the
 * risks live in how they compose: the limited foreground listener may not remove absent rows on
 * its own, and Firestore's own later `removed` for the same task must not be applied twice
 * (`deleteTask` decrements the day's count every time it runs).
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

const listeners = []
let prefetchDocs = []

const buildQuery = () => {
    const query = {
        where: () => query,
        orderBy: () => query,
        limit: () => query,
        get: async () => ({ docs: prefetchDocs.map(({ id, data }) => ({ id, data: () => data })) }),
        onSnapshot: (...args) => {
            listeners.push(typeof args[0] === 'function' ? args[0] : args[1])
            return jest.fn()
        },
    }
    return query
}

jest.mock('./firestore', () => ({
    getDb: () => ({ collection: () => buildQuery() }),
    globalWatcherUnsub: {},
    mapGoalData: jest.fn(),
    mapMilestoneData: jest.fn(),
    mapTaskData: (id, data) => ({ id, ...data }),
}))

import {
    AMOUNT_TASKS_INDEX,
    MAIN_TASK_INDEX,
    buildCompletedElsewhereRemovals,
    dropEchoedCompletionRemovals,
    unwatchOpenTasks,
    watchOpenTasks,
} from './openTasks'
import { resetOpenTasksBackgroundHydrationQueue } from './openTasksBackgroundQueue'
import { resetOptimisticTaskCreates } from './Tasks/optimisticTaskCreate'
import { __resetRecentCompletionsPrefetchForTests, prefetchRecentCompletions } from './Tasks/recentCompletionsPrefetch'

const PROJECT_ID = 'project-1'
const INSTANCE_KEY = 'project-1user-1'

const buildRawTask = (overrides = {}) => ({
    name: 'task',
    extendedName: 'task',
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

const doneData = raw => ({ ...raw, inDone: true, done: true, completed: Date.now() })

const change = (type, id, raw) => ({ type, doc: { id, data: () => raw } })

const deliver = (listenerIndex, changes, docs = changes.map(item => item.doc)) =>
    listeners[listenerIndex]({
        docChanges: () => changes,
        docs,
        size: docs.length,
        empty: docs.length === 0,
        forEach: callback => docs.forEach(callback),
        metadata: { fromCache: false, hasPendingWrites: false },
    })

const today = published => published[published.length - 1][0]
const taskIdsOf = published => (today(published)[MAIN_TASK_INDEX] || []).flatMap(([, tasks]) => tasks.map(t => t.id))
const amountOf = published => today(published)[AMOUNT_TASKS_INDEX]

const prefetchCompleted = async tasks => {
    prefetchDocs = tasks
    await prefetchRecentCompletions({
        projectIds: [PROJECT_ID],
        userId: 'user-1',
        readerId: 'user-1',
        since: 0,
        reason: 'test',
    })
}

const latestGlobalData = () => {
    const actions = mockDispatch.mock.calls.flatMap(([payload]) => [payload].flat())
    const latest = actions.filter(action => action?.type === 'Set global data by project').pop()
    return latest.globalDataByProject
}

describe('recent completions prefetch in the open board', () => {
    let published
    const taskA = buildRawTask({ name: 'a', sortIndex: 2 })
    const taskB = buildRawTask({ name: 'b', sortIndex: 1 })

    beforeEach(() => {
        listeners.length = 0
        prefetchDocs = []
        published = []
        mockDispatch.mockClear()
        mockState.globalDataByProject = {}
        mockState.loggedUser.numberTodayTasks = 10
        resetOptimisticTaskCreates()
        resetOpenTasksBackgroundHydrationQueue()
        __resetRecentCompletionsPrefetchForTests()
    })

    afterEach(() => {
        unwatchOpenTasks(PROJECT_ID, 'user-1')
        jest.useRealTimers()
    })

    it('removes a listed task as soon as the prefetch reports it completed elsewhere', async () => {
        watchOpenTasks(PROJECT_ID, tasks => published.push(tasks), false, false, false, INSTANCE_KEY)
        deliver(0, [change('added', 'a', taskA), change('added', 'b', taskB)])
        expect(taskIdsOf(published)).toEqual(['a', 'b'])

        await prefetchCompleted([{ id: 'b', data: doneData(taskB) }])

        expect(taskIdsOf(published)).toEqual(['a'])
        expect(amountOf(published)).toBe(1)
    })

    it('ignores the later Firestore removal of the same task instead of counting it twice', async () => {
        watchOpenTasks(PROJECT_ID, tasks => published.push(tasks), false, false, false, INSTANCE_KEY)
        deliver(0, [change('added', 'a', taskA), change('added', 'b', taskB)])
        await prefetchCompleted([{ id: 'b', data: doneData(taskB) }])

        expect(() => deliver(0, [change('removed', 'b', taskB)], [{ id: 'a', data: () => taskA }])).not.toThrow()

        expect(taskIdsOf(published)).toEqual(['a'])
        expect(amountOf(published)).toBe(1)
    })

    it('lets a task that is reopened afterwards come back, and be removed again for real', async () => {
        watchOpenTasks(PROJECT_ID, tasks => published.push(tasks), false, false, false, INSTANCE_KEY)
        deliver(0, [change('added', 'a', taskA), change('added', 'b', taskB)])
        await prefetchCompleted([{ id: 'b', data: doneData(taskB) }])

        deliver(0, [change('added', 'b', taskB)])
        expect(taskIdsOf(published)).toEqual(['a', 'b'])
        expect(amountOf(published)).toBe(2)

        deliver(0, [change('removed', 'b', taskB)])
        expect(taskIdsOf(published)).toEqual(['a'])
        expect(amountOf(published)).toBe(1)
    })

    it('leaves the board alone for completions of tasks it does not hold', async () => {
        watchOpenTasks(PROJECT_ID, tasks => published.push(tasks), false, false, false, INSTANCE_KEY)
        deliver(0, [change('added', 'a', taskA)])
        const publishedBefore = published.length

        await prefetchCompleted([{ id: 'elsewhere', data: doneData(buildRawTask()) }])

        expect(published).toHaveLength(publishedBefore)
        expect(taskIdsOf(published)).toEqual(['a'])
    })

    describe('limited foreground listener after a resume', () => {
        // The resume path: the watcher is rebuilt with the rows it held before (keepMainDayData),
        // and its first listener is the LIMITED foreground query, which on its own may not remove
        // a retained row merely because it is absent from its window.
        const rebuildWithRetainedRows = () => {
            watchOpenTasks(PROJECT_ID, tasks => published.push(tasks), false, false, false, INSTANCE_KEY)
            deliver(0, [change('added', 'a', taskA), change('added', 'b', taskB)])
            mockState.globalDataByProject = latestGlobalData()
            listeners.length = 0
            watchOpenTasks(PROJECT_ID, tasks => published.push(tasks), false, false, true, INSTANCE_KEY, false, {
                deferSecondaryStreams: true,
            })
        }

        it('keeps an absent retained row when nothing proves it done (unchanged behaviour)', () => {
            rebuildWithRetainedRows()
            deliver(0, [change('added', 'a', taskA)])
            expect(taskIdsOf(published)).toEqual(['a', 'b'])
        })

        it('drops a retained row on the first delivery when the prefetch already proved it done', async () => {
            rebuildWithRetainedRows()
            await prefetchCompleted([{ id: 'b', data: doneData(taskB) }])

            deliver(0, [change('added', 'a', taskA)])

            expect(taskIdsOf(published)).toEqual(['a'])
            expect(amountOf(published)).toBe(1)
        })

        it('drops a retained row when the prefetch lands after the first delivery', async () => {
            rebuildWithRetainedRows()
            deliver(0, [change('added', 'a', taskA)])

            await prefetchCompleted([{ id: 'b', data: doneData(taskB) }])

            expect(taskIdsOf(published)).toEqual(['a'])
            expect(amountOf(published)).toBe(1)
        })

        it('leaves a row the first snapshot still contains to Firestore', async () => {
            rebuildWithRetainedRows()
            await prefetchCompleted([{ id: 'b', data: doneData(taskB) }])

            deliver(0, [change('added', 'a', taskA), change('added', 'b', taskB)])

            expect(taskIdsOf(published)).toEqual(['a', 'b'])
        })
    })
})

describe('buildCompletedElsewhereRemovals', () => {
    const retained = { a: { id: 'a', parentId: null }, sub: { id: 'sub', parentId: 'a' } }

    it('removes only retained top-level tasks the prefetch reports done', () => {
        const changes = buildCompletedElsewhereRemovals(
            [
                { id: 'a', data: { inDone: true } },
                { id: 'sub', data: { inDone: true } },
                { id: 'unknown', data: { inDone: true } },
            ],
            retained
        )
        expect(changes.map(item => [item.type, item.doc.id])).toEqual([['removed', 'a']])
        expect(changes[0].doc.data()).toBe(retained.a)
    })

    it('skips excluded ids and documents that are not done', () => {
        expect(
            buildCompletedElsewhereRemovals([{ id: 'a', data: { inDone: true } }], retained, new Set(['a']))
        ).toEqual([])
        expect(buildCompletedElsewhereRemovals([{ id: 'a', data: { inDone: false } }], retained)).toEqual([])
    })
})

describe('dropEchoedCompletionRemovals', () => {
    const removed = (id, type = 'removed') => ({ type, doc: { id, data: () => ({}) } })

    it('passes everything through when nothing was removed by the prefetch', () => {
        const changes = [removed('a')]
        expect(dropEchoedCompletionRemovals(changes, undefined, {})).toBe(changes)
    })

    it('drops the echo of a prefetch removal and keeps unrelated changes', () => {
        const ids = new Set(['b'])
        expect(dropEchoedCompletionRemovals([removed('a'), removed('b')], ids, { a: {} }).map(c => c.doc.id)).toEqual([
            'a',
        ])
        expect(ids.has('b')).toBe(true)
    })

    it('forgets the id once the task is added again', () => {
        const ids = new Set(['b'])
        const changes = [removed('b', 'added'), removed('b')]
        expect(dropEchoedCompletionRemovals(changes, ids, {})).toEqual(changes)
        expect(ids.has('b')).toBe(false)
    })

    it('keeps a removal for a task that is known again', () => {
        expect(dropEchoedCompletionRemovals([removed('b')], new Set(['b']), { b: {} })).toHaveLength(1)
    })
})
