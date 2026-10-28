/**
 * AT-2803 — postponing a recurring task keeps the date it was ORIGINALLY planned for, so the
 * completion popup can offer "count the next occurrence from the planned date".
 *
 * Drives the REAL setTaskDueDate / setTaskToBacklog against the REAL Redux store (same harness as
 * focusPostponeRace.test.js); only Firestore is faked, and every committed write is recorded.
 */

import moment from 'moment'

const PROJECT_ID = 'project-1'
const USER_ID = 'user-1'
const PLANNED = moment().startOf('day').add(2, 'hours').valueOf()
const LATER = moment(PLANNED).add(3, 'days').valueOf()

const buildTask = overrides => ({
    id: 'task-r',
    name: 'weekly review',
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
    recurrence: 'weekly',
    dueDate: PLANNED,
    sortIndex: 1000,
    estimations: {},
    ...overrides,
})

let committedWrites = []
let batchesCreated = []

const emptySnapshot = { empty: true, docs: [], forEach: () => {} }
const buildQuery = () => {
    const query = {}
    query.where = () => query
    query.orderBy = () => query
    query.limit = () => query
    query.get = () => Promise.resolve(emptySnapshot)
    return query
}

const fakeDb = {
    collection: () => buildQuery(),
    doc: path => ({
        path,
        get: () => Promise.resolve({ exists: false, data: () => ({}) }),
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
        getDb: () => global.__AT2803_DB__,
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
            global.__AT2803_BATCHES__.push(this)
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
            global.__AT2803_WRITES__.push(...this.writes)
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
import { setTaskDueDate, setTaskToBacklog } from './tasksFirestore'

const taskWrites = () =>
    committedWrites.filter(write => write.path === `items/${PROJECT_ID}/tasks/task-r` && write.data)

const storedOriginal = () => {
    const writes = taskWrites().filter(write => write.data.recurrenceOriginalDueDate !== undefined)
    return writes.length ? writes[writes.length - 1].data.recurrenceOriginalDueDate : undefined
}

describe('AT-2803 — the original date of a postponed recurring task', () => {
    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => {})
        jest.spyOn(console, 'warn').mockImplementation(() => {})

        committedWrites = []
        batchesCreated = []
        global.__AT2803_WRITES__ = committedWrites
        global.__AT2803_BATCHES__ = batchesCreated
        global.__AT2803_DB__ = fakeDb

        store.dispatch(
            overrideStore({
                ...store.getState(),
                currentUser: { uid: USER_ID },
                loggedUser: { uid: USER_ID, isAnonymous: false, inFocusTaskId: '', projectIds: [PROJECT_ID] },
                projectUsers: { [PROJECT_ID]: [{ uid: USER_ID }] },
                loggedUserProjects: [{ id: PROJECT_ID, sortIndexByUser: { [USER_ID]: 1 } }],
                openTasksMap: { [PROJECT_ID]: {} },
            })
        )
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    it('the first postponement stores the planned date', async () => {
        await setTaskDueDate(PROJECT_ID, 'task-r', LATER, buildTask(), false, null)

        expect(storedOriginal()).toBe(PLANNED)
    })

    it('a further postponement never overwrites it', async () => {
        await setTaskDueDate(
            PROJECT_ID,
            'task-r',
            LATER + 86400000,
            buildTask({ dueDate: LATER, recurrenceOriginalDueDate: PLANNED }),
            false,
            null
        )

        expect(storedOriginal()).toBeUndefined()
    })

    it('moving the task earlier stores nothing', async () => {
        await setTaskDueDate(PROJECT_ID, 'task-r', PLANNED, buildTask({ dueDate: LATER }), false, null)

        expect(storedOriginal()).toBeUndefined()
    })

    it('sending it to Someday stores the planned date too', async () => {
        await setTaskToBacklog(PROJECT_ID, 'task-r', buildTask(), false, null)

        expect(storedOriginal()).toBe(PLANNED)
    })

    it('an observer moving their own date stores nothing', async () => {
        await setTaskToBacklog(PROJECT_ID, 'task-r', buildTask(), true, null)

        expect(storedOriginal()).toBeUndefined()
    })

    it('a non-recurring task stores nothing', async () => {
        await setTaskDueDate(PROJECT_ID, 'task-r', LATER, buildTask({ recurrence: 'never' }), false, null)
        await setTaskToBacklog(PROJECT_ID, 'task-r', buildTask({ recurrence: 'never' }), false, null)

        expect(storedOriginal()).toBeUndefined()
    })
})
