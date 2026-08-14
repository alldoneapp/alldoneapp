/**
 * AT-2251 — the optimistic focus pick must apply the imminent-calendar rule the authoritative
 * pickers already apply.
 *
 * Both of those (findAndSetNewFocusedTask on the client, FocusTaskService Phase 1 in the Cloud
 * Function) look ACROSS ALL PROJECTS for a calendar task starting within the next 15 minutes and
 * let it beat every other candidate. The optimistic pick filtered calendar tasks out entirely and
 * never left the current project, so completing a focus task shortly before a meeting showed an
 * ordinary task and then visibly flipped to the meeting.
 *
 * Same harness as focusPostponeRace.test.js: the REAL setTaskDueDate against the REAL Redux store,
 * with the backend held so only the optimistic pick is observed.
 */

import moment from 'moment'

const PROJECT_ID = 'project-1'
const CALENDAR_PROJECT_ID = 'project-2'
const USER_ID = 'user-1'

// __mocks__/moment.js pins Date.now, so "today" is deterministic and cannot straddle a real
// midnight. Deriving the fixtures from it keeps them on the right side of endOf('day').
const NOW = moment().valueOf()
const END_OF_TODAY = moment().endOf('day').valueOf()
const TODAY = moment().startOf('day').valueOf()
const TOMORROW = END_OF_TODAY + 1000

// A > B > C > D in display order (same priority, descending sortIndex).
const TASK_IDS = ['task-a', 'task-b', 'task-c', 'task-d']

const buildTask = (id, sortIndex) => ({
    id,
    name: id,
    userId: USER_ID,
    userIds: [USER_ID],
    done: false,
    inDone: false,
    isSubtask: false,
    parentId: null,
    parentGoalId: null,
    subtaskIds: [],
    priority: 'none',
    timesPostponed: 0,
    dueDate: TODAY + 3600000,
    sortIndex,
    estimations: {},
})

const tasksById = {
    'task-a': buildTask('task-a', 4000),
    'task-b': buildTask('task-b', 3000),
    'task-c': buildTask('task-c', 2000),
    'task-d': buildTask('task-d', 1000),
}

/** Every write any batch committed, so the test can assert what actually reached Firestore. */
let committedWrites = []
/** Writes queued on batches that were never committed (a superseded handoff must land here). */
let batchesCreated = []
/** Held open while the test wants "the backend has not answered yet" to be true. */
let releaseBackend = null
let backendBarrier = null

const holdBackend = () => {
    backendBarrier = new Promise(resolve => {
        releaseBackend = resolve
    })
}

const letBackendRespond = () => {
    const release = releaseBackend
    backendBarrier = null
    releaseBackend = null
    release()
}

const afterBarrier = value => (backendBarrier ? backendBarrier.then(() => value) : Promise.resolve(value))

/**
 * The server answer is deliberately stale: it still reports every task as due today, exactly as a
 * query served before the postpone writes land would.
 */
const buildTasksSnapshot = () => {
    const docs = TASK_IDS.map(id => ({ id, data: () => ({ ...tasksById[id] }) }))
    return { empty: false, docs, forEach: callback => docs.forEach(callback) }
}

const emptySnapshot = { empty: true, docs: [], forEach: () => {} }

const buildQuery = path => {
    const query = {}
    query.where = () => query
    query.orderBy = () => query
    query.limit = () => query
    // The calendar pre-emption query filters on sortIndex windows; nothing here is a calendar task.
    query.get = () => afterBarrier(path.startsWith('items/') ? buildTasksSnapshot() : emptySnapshot)
    return query
}

const fakeDb = {
    collection: path => buildQuery(path),
    doc: path => ({
        path,
        get: () => afterBarrier({ exists: false, data: () => ({}) }),
        update: jest.fn(),
    }),
    runTransaction: async () => {
        throw new Error('runTransaction should not be used with a batch')
    },
}

jest.mock('firebase/compat/app', () => ({
    __esModule: true,
    default: {
        firestore: {
            FieldValue: {
                increment: amount => ({ __increment: amount }),
                serverTimestamp: () => ({ __serverTimestamp: true }),
                delete: () => ({ __delete: true }),
                arrayUnion: (...values) => ({ __arrayUnion: values }),
                arrayRemove: (...values) => ({ __arrayRemove: values }),
            },
        },
    },
}))

jest.mock('../firestore', () => {
    const generated = {}
    let sortIndexCounter = 10000
    const overrides = {
        getDb: () => global.__AT2191_DB__,
        generateSortIndex: () => (sortIndexCounter += 1),
        generateNegativeSortIndex: () => -(sortIndexCounter += 1),
        generateNegativeSortTaskIndex: () => -(sortIndexCounter += 1),
        getId: () => `generated-${(sortIndexCounter += 1)}`,
        getObjectFollowersIds: () => [],
        getMentionedUsersIdsWhenEditText: () => [],
    }
    return new Proxy(
        {},
        {
            get: (target, prop) => {
                if (prop === '__esModule') return true
                if (Object.prototype.hasOwnProperty.call(overrides, prop)) return overrides[prop]
                if (typeof prop !== 'string') return undefined
                // Returns an object rather than undefined: unrelated modules in this (very large)
                // import graph read properties off these helpers at module-eval time.
                if (!generated[prop]) generated[prop] = jest.fn(() => ({}))
                return generated[prop]
            },
        }
    )
})

jest.mock('../../../functions/BatchWrapper/batchWrapper', () => ({
    BatchWrapper: class {
        constructor() {
            this.writes = []
            this.committed = false
            global.__AT2191_BATCHES__.push(this)
        }
        update(ref, data) {
            this.writes.push({ path: ref && ref.path, data })
        }
        set(ref, data) {
            this.writes.push({ path: ref && ref.path, data })
        }
        delete(ref) {
            this.writes.push({ path: ref && ref.path, deleted: true })
        }
        async commit() {
            this.committed = true
            global.__AT2191_WRITES__.push(...this.writes)
        }
    },
}))

jest.mock('../../undo/undoActions', () => ({
    __esModule: true,
    buildObjectUpdateOperation: jest.fn(),
    buildTaskCreateOperation: jest.fn(),
    buildTaskUpdateOperation: jest.fn(() => ({})),
    MAX_UNDO_OPERATIONS: 10,
    queueUndoAction: jest.fn(),
}))

import store from '../../../redux/store'
import { overrideStore } from '../../../redux/actions'
import { setTaskDueDate } from './tasksFirestore'
import { resetFocusHandoffTracking } from './focusHandoffRace'

const optimisticFocusTaskId = () => store.getState().optimisticFocusTaskId
const optimisticFocusActive = () => store.getState().optimisticFocusActive
const optimisticFocusProjectId = () => store.getState().optimisticFocusTaskProjectId

/** Every task id that any committed write declared as the user's confirmed focus task. */
const confirmedFocusWrites = () =>
    committedWrites.filter(write => write.data && write.data.inFocusTaskId !== undefined).map(w => w.data.inFocusTaskId)

const seedStore = ({ confirmedFocusTaskId, calendarTasksById = {} }) => {
    const member = {
        uid: USER_ID,
        inFocusTaskId: confirmedFocusTaskId,
        inFocusTaskProjectId: PROJECT_ID,
    }

    store.dispatch(
        overrideStore({
            ...store.getState(),
            currentUser: { uid: USER_ID },
            loggedUser: {
                uid: USER_ID,
                isAnonymous: false,
                inFocusTaskId: confirmedFocusTaskId,
                inFocusTaskProjectId: PROJECT_ID,
                projectIds: [PROJECT_ID],
            },
            projectUsers: { [PROJECT_ID]: [member] },
            loggedUserProjects: [{ id: PROJECT_ID, sortIndexByUser: { [USER_ID]: 1 } }],
            // Never refreshed during the test: this models the Firestore listener lagging behind.
            openTasksMap: {
                [PROJECT_ID]: { ...tasksById },
                [CALENDAR_PROJECT_ID]: calendarTasksById,
            },
            goalsByProjectInTasks: { [PROJECT_ID]: {}, [CALENDAR_PROJECT_ID]: {} },
            openMilestonesByProjectInTasks: { [PROJECT_ID]: [], [CALENDAR_PROJECT_ID]: [] },
            doneMilestonesByProjectInTasks: { [PROJECT_ID]: [], [CALENDAR_PROJECT_ID]: [] },
            optimisticFocusTaskId: null,
            optimisticFocusTaskProjectId: null,
            optimisticFocusGoalId: null,
            optimisticFocusUserId: null,
            optimisticFocusActive: false,
        })
    )
}

const postpone = taskId => setTaskDueDate(PROJECT_ID, taskId, TOMORROW, { ...tasksById[taskId] }, false, null)

/** A meeting in ANOTHER project, starting `minutes` from now. */
const buildCalendarTask = (id, minutes) => ({
    ...buildTask(id, 5000),
    calendarData: {
        start: { dateTime: moment().add(minutes, 'minutes').toISOString() },
    },
})

describe('AT-2251 — the optimistic pick applies the imminent-calendar rule', () => {
    const setUp = calendarTasksById => {
        jest.spyOn(console, 'log').mockImplementation(() => {})
        jest.spyOn(console, 'warn').mockImplementation(() => {})

        committedWrites = []
        batchesCreated = []
        global.__AT2191_WRITES__ = committedWrites
        global.__AT2191_BATCHES__ = batchesCreated
        global.__AT2191_DB__ = fakeDb

        resetFocusHandoffTracking()
        seedStore({ confirmedFocusTaskId: 'task-a', calendarTasksById })
        holdBackend()
    }

    afterEach(() => {
        jest.restoreAllMocks()
    })

    it('prefers a meeting starting in 10 minutes over the next task in display order', async () => {
        setUp({ 'meeting-soon': buildCalendarTask('meeting-soon', 10) })

        const inFlight = postpone('task-a')

        // Without the rule this was 'task-b', and the backend then replaced it with the meeting.
        expect(optimisticFocusTaskId()).toBe('meeting-soon')
        expect(optimisticFocusActive()).toBe(true)

        letBackendRespond()
        await inFlight
    })

    it('carries the meeting own project, not the project the focus task was completed in', async () => {
        setUp({ 'meeting-soon': buildCalendarTask('meeting-soon', 10) })

        const inFlight = postpone('task-a')

        // The optimistic slice is read per project, so pointing it at PROJECT_ID would render the
        // pick nowhere at all.
        expect(optimisticFocusProjectId()).toBe(CALENDAR_PROJECT_ID)

        letBackendRespond()
        await inFlight
    })

    it('ignores a meeting that is still 40 minutes away', async () => {
        setUp({ 'meeting-later': buildCalendarTask('meeting-later', 40) })

        const inFlight = postpone('task-a')

        expect(optimisticFocusTaskId()).toBe('task-b')

        letBackendRespond()
        await inFlight
    })

    it('ignores a meeting that already started', async () => {
        setUp({ 'meeting-past': buildCalendarTask('meeting-past', -5) })

        const inFlight = postpone('task-a')

        expect(optimisticFocusTaskId()).toBe('task-b')

        letBackendRespond()
        await inFlight
    })

    it('takes the earliest of several imminent meetings', async () => {
        setUp({
            'meeting-in-12': buildCalendarTask('meeting-in-12', 12),
            'meeting-in-3': buildCalendarTask('meeting-in-3', 3),
            'meeting-in-8': buildCalendarTask('meeting-in-8', 8),
        })

        const inFlight = postpone('task-a')

        expect(optimisticFocusTaskId()).toBe('meeting-in-3')

        letBackendRespond()
        await inFlight
    })

    it('never hands back the very task that just lost focus, even if it is an imminent meeting', async () => {
        setUp({})
        // task-a itself is the one being postponed; a calendar shape must not resurrect it.
        const inFlight = postpone('task-a')

        expect(optimisticFocusTaskId()).not.toBe('task-a')

        letBackendRespond()
        await inFlight
    })
})
