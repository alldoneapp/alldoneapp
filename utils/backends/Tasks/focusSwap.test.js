/**
 * AT-3067 — "Show a different focus task" in the assistant-mode header (pickDifferentFocusTask).
 *
 * Same fake Firestore as focusPostponeRace.test.js (only Firestore is faked; the pick, the handoff
 * sequencing and the Redux store are real). Four tasks due today, A > B > C > D in display order,
 * task-a is the focus task.
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
        // Task documents exist, so the swap can unpin the task it replaces.
        get: () => afterBarrier({ exists: /\/tasks\//.test(path), data: () => ({}) }),
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
import { pickDifferentFocusTask } from './tasksFirestore'
import { resetFocusHandoffTracking, supersedeFocusHandoffs } from './focusHandoffRace'

const confirmedFocusWrites = () =>
    committedWrites.filter(write => write.data && write.data.inFocusTaskId !== undefined).map(w => w.data.inFocusTaskId)
const writesTo = taskId => committedWrites.filter(write => write.path === `items/${PROJECT_ID}/tasks/${taskId}`)

const seedStore = ({ confirmedFocusTaskId, connectionState = 'online' }) => {
    const member = { uid: USER_ID, inFocusTaskId: confirmedFocusTaskId, inFocusTaskProjectId: PROJECT_ID }
    store.dispatch(
        overrideStore({
            ...store.getState(),
            connectionState,
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

const swap = (options = {}) =>
    pickDifferentFocusTask(USER_ID, { taskId: 'task-a', projectId: PROJECT_ID, skippedTaskIds: [], ...options })

describe('AT-3067 — swapping the focus task for a different one', () => {
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
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    it('focuses the next task and unpins the replaced one without re-dating it', async () => {
        await expect(swap()).resolves.toBe('picked')

        expect(confirmedFocusWrites()).toEqual(['task-b'])
        // The replaced task leaves its pinned focus place with an ordinary sortIndex, like a manual
        // focus change, and keeps its due date (no dueDate write).
        const replaced = writesTo('task-a')
        expect(replaced).toHaveLength(1)
        expect(Object.keys(replaced[0].data)).toEqual(['sortIndex'])
        expect(replaced[0].data.sortIndex).toBeLessThan(Number.MAX_SAFE_INTEGER / 2)
    })

    it('skips every task passed over before, so repeated clicks walk through the list', async () => {
        await expect(swap({ skippedTaskIds: ['task-b'] })).resolves.toBe('picked')
        expect(confirmedFocusWrites()).toEqual(['task-c'])

        committedWrites.length = 0
        await expect(swap({ skippedTaskIds: ['task-b', 'task-c'] })).resolves.toBe('picked')
        expect(confirmedFocusWrites()).toEqual(['task-d'])
    })

    it('keeps the current focus task when there is no alternative', async () => {
        await expect(swap({ skippedTaskIds: ['task-b', 'task-c', 'task-d'] })).resolves.toBe('none')

        // The normal pick would clear the focus here; a swap must never take it away.
        expect(confirmedFocusWrites()).toEqual([])
        expect(committedWrites).toEqual([])
        expect(store.getState().optimisticFocusActive).toBe(false)
    })

    it('reports the candidates it chooses from, without the excluded ones', async () => {
        const onCandidates = jest.fn()
        await swap({ skippedTaskIds: ['task-c'], onCandidates })
        const names = onCandidates.mock.calls.flatMap(([candidates]) => candidates.map(c => c.name))
        expect(names).toEqual(expect.arrayContaining(['task-b', 'task-d']))
        expect(names).not.toContain('task-a')
        expect(names).not.toContain('task-c')
    })

    it('lets a focus the user sets by hand meanwhile win', async () => {
        holdBackend()
        const inFlight = swap()
        // A manual focus toggle (updateFocusedTask) supersedes every running handoff.
        supersedeFocusHandoffs()
        letBackendRespond()

        await expect(inFlight).resolves.toBe('superseded')
        expect(confirmedFocusWrites()).toEqual([])
    })

    it('fails fast offline instead of guessing from the cache', async () => {
        seedStore({ confirmedFocusTaskId: 'task-a', connectionState: 'offline' })
        await expect(swap()).rejects.toMatchObject({ code: 'offline' })
        expect(committedWrites).toEqual([])
    })
})
