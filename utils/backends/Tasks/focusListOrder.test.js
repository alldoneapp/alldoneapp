/**
 * AT-3085 — the assistant header's focus pick ("Get a focus task") and swap ("Show a different focus
 * task") walk the projects in the user's project-list order (the sidebar's), from the top, instead
 * of starting in the project of the last focus task. A listed project without a suitable task is
 * skipped; projects that are not listed (guide, archived) are only the last fallback.
 *
 * Same fake Firestore as focusSwap.test.js (only Firestore is faked; the pick and the Redux store are
 * real), with tasks per project.
 */

import moment from 'moment'

const USER_ID = 'user-1'
const TODAY = moment().startOf('day').valueOf()
const TOMORROW = moment().endOf('day').valueOf() + 1000

// The sidebar shows JTL, Growth, Privat (sort index desc); Privat is the default project and the
// project of the last focus task. Guide and Old (archived) are not in the list.
const PROJECTS = [
    { id: 'privat', name: 'Privat', sortIndexByUser: { [USER_ID]: 1 } },
    { id: 'jtl', name: 'JTL', sortIndexByUser: { [USER_ID]: 30 } },
    { id: 'growth', name: 'Growth', sortIndexByUser: { [USER_ID]: 20 } },
    { id: 'guide', name: 'Guide', sortIndexByUser: { [USER_ID]: 90 } },
    { id: 'old', name: 'Old', sortIndexByUser: { [USER_ID]: 99 } },
]

const buildTask = (id, { sortIndex = 1000, dueDate = TODAY + 3600000 } = {}) => ({
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
    dueDate,
    sortIndex,
    estimations: {},
})

/** projectId -> tasks the fake Firestore returns for `items/{projectId}/tasks`. */
let tasksByProject = {}
let committedWrites = []
let batchesCreated = []

const snapshotOf = tasks => {
    const docs = tasks.map(task => ({ id: task.id, data: () => ({ ...task }) }))
    return { empty: docs.length === 0, docs, forEach: callback => docs.forEach(callback) }
}

const buildQuery = path => {
    const query = {}
    query.where = () => query
    query.orderBy = () => query
    query.limit = () => query
    const match = /^items\/([^/]+)\/tasks$/.exec(path)
    query.get = async () => snapshotOf(match ? tasksByProject[match[1]] || [] : [])
    return query
}

const fakeDb = {
    collection: path => buildQuery(path),
    doc: path => ({
        path,
        get: async () => ({ exists: /\/tasks\//.test(path), data: () => ({}) }),
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
import { pickDifferentFocusTask, pickNewFocusTask } from './tasksFirestore'
import { resetFocusHandoffTracking } from './focusHandoffRace'

const focusWrites = () =>
    committedWrites
        .filter(write => write.data && write.data.inFocusTaskId !== undefined)
        .map(write => write.data.inFocusTaskId)

const seedStore = ({ focusTaskId = '', focusProjectId = 'privat' } = {}) => {
    const member = { uid: USER_ID, inFocusTaskId: focusTaskId, inFocusTaskProjectId: focusProjectId }
    store.dispatch(
        overrideStore({
            ...store.getState(),
            connectionState: 'online',
            currentUser: { uid: USER_ID },
            loggedUser: {
                uid: USER_ID,
                isAnonymous: false,
                defaultProjectId: 'privat',
                inFocusTaskId: focusTaskId,
                inFocusTaskProjectId: focusProjectId,
                projectIds: PROJECTS.map(project => project.id),
                archivedProjectIds: ['old'],
                templateProjectIds: [],
                guideProjectIds: ['guide'],
            },
            projectUsers: Object.fromEntries(PROJECTS.map(project => [project.id, [member]])),
            loggedUserProjects: PROJECTS.map(project => ({ ...project, userIds: [USER_ID] })),
            openTasksMap: {},
            goalsByProjectInTasks: {},
            openMilestonesByProjectInTasks: {},
            doneMilestonesByProjectInTasks: {},
            optimisticFocusTaskId: null,
            optimisticFocusTaskProjectId: null,
            optimisticFocusGoalId: null,
            optimisticFocusUserId: null,
            optimisticFocusActive: false,
        })
    )
}

describe('AT-3085 — the header focus pick follows the project list', () => {
    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => {})
        jest.spyOn(console, 'warn').mockImplementation(() => {})
        committedWrites = []
        batchesCreated = []
        global.__AT2191_WRITES__ = committedWrites
        global.__AT2191_BATCHES__ = batchesCreated
        global.__AT2191_DB__ = fakeDb
        resetFocusHandoffTracking()
        tasksByProject = {
            privat: [buildTask('privat-1', { sortIndex: 5000 })],
            jtl: [buildTask('jtl-1', { sortIndex: 2000 }), buildTask('jtl-2', { sortIndex: 1000 })],
            growth: [buildTask('growth-1')],
            guide: [buildTask('guide-1')],
            old: [buildTask('old-1')],
        }
        seedStore()
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    it('starts with the first listed project, not the last focus project or the default one', async () => {
        await expect(pickNewFocusTask('privat', USER_ID)).resolves.toBe(true)
        expect(focusWrites()).toEqual(['jtl-1'])
    })

    it('skips a listed project without a task due today and takes the next one in the list', async () => {
        tasksByProject.jtl = [buildTask('jtl-later', { dueDate: TOMORROW })]
        await expect(pickNewFocusTask('privat', USER_ID)).resolves.toBe(true)
        expect(focusWrites()).toEqual(['growth-1'])
    })

    it('falls back to projects outside the list only when no listed project has a task', async () => {
        tasksByProject.privat = []
        tasksByProject.jtl = []
        tasksByProject.growth = []
        await expect(pickNewFocusTask('privat', USER_ID)).resolves.toBe(true)
        // Not listed, so last, even with a higher sort index than every listed project.
        expect(focusWrites()).toEqual(['old-1'])
    })

    it('clears the focus as before when no project has a task for today', async () => {
        tasksByProject = {}
        await expect(pickNewFocusTask('privat', USER_ID)).resolves.toBe(false)
        expect(focusWrites()).toEqual([''])
    })

    it('swaps from a task in a lower project to the top of the list, then walks down it', async () => {
        seedStore({ focusTaskId: 'privat-1', focusProjectId: 'privat' })
        await expect(
            pickDifferentFocusTask(USER_ID, { taskId: 'privat-1', projectId: 'privat', skippedTaskIds: [] })
        ).resolves.toBe('picked')
        expect(focusWrites()).toEqual(['jtl-1'])

        committedWrites.length = 0
        seedStore({ focusTaskId: 'jtl-1', focusProjectId: 'jtl' })
        await expect(
            pickDifferentFocusTask(USER_ID, { taskId: 'jtl-1', projectId: 'jtl', skippedTaskIds: ['privat-1'] })
        ).resolves.toBe('picked')
        expect(focusWrites()).toEqual(['jtl-2'])

        committedWrites.length = 0
        seedStore({ focusTaskId: 'jtl-2', focusProjectId: 'jtl' })
        await expect(
            pickDifferentFocusTask(USER_ID, {
                taskId: 'jtl-2',
                projectId: 'jtl',
                skippedTaskIds: ['privat-1', 'jtl-1'],
            })
        ).resolves.toBe('picked')
        expect(focusWrites()).toEqual(['growth-1'])
    })
})
