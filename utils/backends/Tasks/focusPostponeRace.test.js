/**
 * AT-2191 — postponing the focus task several times in a row, each one faster than the backend can
 * confirm the previous swap.
 *
 * Drives the REAL setTaskDueDate against the REAL Redux store; only Firestore is faked, and it is
 * faked pessimistically: the local task map is never refreshed and every server query keeps
 * answering with the pre-postpone state. That is the situation the bug lives in — if the code only
 * believed `users/{uid}.inFocusTaskId` and the Redux task map, it would decide the second postpone
 * was not touching the focus task at all.
 */

import moment from 'moment'

const PROJECT_ID = 'project-1'
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

/** Every task id that any committed write declared as the user's confirmed focus task. */
const confirmedFocusWrites = () =>
    committedWrites.filter(write => write.data && write.data.inFocusTaskId !== undefined).map(w => w.data.inFocusTaskId)

const seedStore = ({ confirmedFocusTaskId }) => {
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
            openTasksMap: { [PROJECT_ID]: { ...tasksById } },
            goalsByProjectInTasks: { [PROJECT_ID]: {} },
            openMilestonesByProjectInTasks: { [PROJECT_ID]: [] },
            doneMilestonesByProjectInTasks: { [PROJECT_ID]: [] },
            optimisticFocusTaskId: null,
            optimisticFocusTaskProjectId: null,
            optimisticFocusGoalId: null,
            optimisticFocusUserId: null,
            optimisticFocusActive: false,
        })
    )
}

const postpone = taskId => setTaskDueDate(PROJECT_ID, taskId, TOMORROW, { ...tasksById[taskId] }, false, null)

describe('AT-2191 — repeated postponement of the focus task before the backend confirms', () => {
    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => {})
        jest.spyOn(console, 'warn').mockImplementation(() => {})

        committedWrites = []
        batchesCreated = []
        global.__AT2191_WRITES__ = committedWrites
        global.__AT2191_BATCHES__ = batchesCreated
        global.__AT2191_DB__ = fakeDb

        resetFocusHandoffTracking()
        seedStore({ confirmedFocusTaskId: 'task-a' })
        holdBackend()
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    it('optimistically picks a new focus task on the SECOND postpone, before any confirmation', async () => {
        const firstPostpone = postpone('task-a')
        expect(optimisticFocusTaskId()).toBe('task-b')

        // The regression. users/{uid}.inFocusTaskId still says task-a here — nothing has been
        // confirmed — so a check that only trusts it concludes task-b was never focused and the
        // user is left staring at a task they just postponed.
        const secondPostpone = postpone('task-b')
        expect(optimisticFocusTaskId()).toBe('task-c')
        expect(optimisticFocusActive()).toBe(true)

        letBackendRespond()
        await Promise.all([firstPostpone, secondPostpone])
    })

    it('keeps picking a new focus task on a third consecutive postpone', async () => {
        const inFlight = [postpone('task-a')]
        expect(optimisticFocusTaskId()).toBe('task-b')

        inFlight.push(postpone('task-b'))
        expect(optimisticFocusTaskId()).toBe('task-c')

        // Neither Redux nor Firestore has caught up, so task-a and task-b both still look due
        // today and outrank task-c/task-d. Only the released-task exclusions keep them out.
        inFlight.push(postpone('task-c'))
        expect(optimisticFocusTaskId()).toBe('task-d')

        letBackendRespond()
        await Promise.all(inFlight)
    })

    it('lets only the newest handoff write, and never re-focuses an already postponed task', async () => {
        const inFlight = [postpone('task-a'), postpone('task-b'), postpone('task-c')]

        letBackendRespond()
        await Promise.all(inFlight)

        // The two superseded searches must not have written a focus at all.
        expect(confirmedFocusWrites()).toEqual(['task-d'])
        expect(confirmedFocusWrites()).not.toContain('task-a')
        expect(confirmedFocusWrites()).not.toContain('task-b')
        expect(confirmedFocusWrites()).not.toContain('task-c')
    })

    it('does not un-postpone a task that a superseded handoff had chosen', async () => {
        const inFlight = [postpone('task-a'), postpone('task-b'), postpone('task-c')]

        letBackendRespond()
        await Promise.all(inFlight)

        // setNewFocusedTaskBatch re-dates whatever it picks to `now`. A superseded handoff running
        // that would drag task-b or task-c back into today, undoing the user's postpone.
        const rescuedToToday = committedWrites.filter(
            write =>
                write.data &&
                typeof write.data.dueDate === 'number' &&
                write.data.dueDate <= END_OF_TODAY &&
                /task-(a|b|c)$/.test(write.path || '')
        )
        expect(rescuedToToday).toEqual([])
    })

    it('leaves the optimistic focus owned by the newest handoff until that one confirms', async () => {
        const first = postpone('task-a')
        const second = postpone('task-b')

        letBackendRespond()
        await Promise.all([first, second])

        // The first search finishing late must not clear state that now belongs to the second.
        expect(optimisticFocusActive()).toBe(false)
        expect(store.getState().optimisticFocusUserId).toBeNull()
    })

    it('still swaps focus for a single postpone confirmed by the backend (unchanged behaviour)', async () => {
        const only = postpone('task-a')
        expect(optimisticFocusTaskId()).toBe('task-b')

        letBackendRespond()
        await only

        expect(confirmedFocusWrites()).toEqual(['task-b'])
        expect(optimisticFocusActive()).toBe(false)
    })

    it('ignores a postpone of a task that is not the focus task', async () => {
        const unrelated = postpone('task-d')

        expect(optimisticFocusActive()).toBe(false)

        letBackendRespond()
        await unrelated

        expect(confirmedFocusWrites()).toEqual([])
    })
})
