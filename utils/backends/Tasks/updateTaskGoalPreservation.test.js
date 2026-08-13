/**
 * AT-2277 — a task saved from an editor that opened before the goal router ran must not take the
 * assigned goal away again.
 *
 * Drives the REAL `updateTask` (the choke point every full-document editor save funnels through);
 * only Firestore, the batch wrapper and the undo queue are faked, so what is asserted is the
 * payload that actually reaches `items/{projectId}/tasks/{taskId}`.
 */

const PROJECT_ID = 'project-1'
const USER_ID = 'user-1'
const TASK_ID = 'task-a'
const GOAL_ID = 'goal-router-picked'
const OTHER_GOAL_ID = 'goal-user-picked'

let committedWrites = []

const db = {
    doc: path => ({ path, get: async () => ({ exists: false, data: () => ({}) }), update: jest.fn() }),
    collection: path => ({
        doc: () => ({ id: 'generated-id', path: `${path}/generated-id` }),
        get: async () => ({ docs: [] }),
    }),
    runTransaction: async () => {
        throw new Error('runTransaction should not be reached with a batch')
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
    let counter = 10000
    const overrides = {
        getDb: () => global.__AT2277_DB__,
        generateSortIndex: () => (counter += 1),
        generateNegativeSortIndex: () => -(counter += 1),
        generateNegativeSortTaskIndex: () => -(counter += 1),
        getId: () => `generated-${(counter += 1)}`,
        getObjectFollowersIds: async () => [],
        getMentionedUsersIdsWhenEditText: () => [],
    }
    return new Proxy(
        {},
        {
            get: (target, prop) => {
                if (prop === '__esModule') return true
                if (Object.prototype.hasOwnProperty.call(overrides, prop)) return overrides[prop]
                if (typeof prop !== 'string') return undefined
                // An object rather than undefined: unrelated modules in this very large import
                // graph read properties off these helpers at module-eval time.
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
            if (global.__AT2277_COMMIT_BARRIER__) await global.__AT2277_COMMIT_BARRIER__
            global.__AT2277_WRITES__.push(...this.writes)
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

import { setTaskParentGoal, updateTask } from './tasksFirestore'

const baseTask = () => ({
    id: TASK_ID,
    name: 'fix the popup close button',
    extendedName: 'fix the popup close button',
    userId: USER_ID,
    userIds: [USER_ID],
    currentReviewerId: USER_ID,
    creatorId: USER_ID,
    done: false,
    inDone: false,
    isSubtask: false,
    parentId: null,
    subtaskIds: [],
    observersIds: [],
    dueDateByObserversIds: {},
    estimationsByObserverIds: {},
    estimations: {},
    priority: 'none',
    recurrence: 'never',
    dueDate: 4102444800000,
    isPublicFor: [0],
    isPrivate: false,
    stepHistory: ['open'],
    timesPostponed: 0,
    sortIndex: 1000,
    parentGoalId: null,
    parentGoalIsPublicFor: null,
    lockKey: '',
    goalSuggestion: null,
})

/** The task after the goal router's transaction: goal fields and suggestion written together. */
const liveTaskWithRoutedGoal = () => ({
    ...baseTask(),
    parentGoalId: GOAL_ID,
    parentGoalIsPublicFor: [0],
    lockKey: 'lock-1',
    goalSuggestion: { status: 'auto_assigned', goalId: GOAL_ID, claimId: 'claim-1', createdAt: 1786480503739 },
})

const taskWrite = () => {
    const write = committedWrites.filter(entry => entry.path === `items/${PROJECT_ID}/tasks/${TASK_ID}`).pop()
    return write ? write.data : null
}

const runUpdate = (payload, live) => updateTask(PROJECT_ID, payload, live, { uid: USER_ID }, '', [], false)

beforeEach(() => {
    committedWrites = []
    global.__AT2277_DB__ = db
    global.__AT2277_WRITES__ = committedWrites
    global.__AT2277_COMMIT_BARRIER__ = null
})

describe('updateTask + AT-2277 goal preservation', () => {
    it('keeps the auto-assigned goal when the editor saves a copy taken before it landed', async () => {
        const live = liveTaskWithRoutedGoal()
        // The editor opened right after the task was created, so its copy still says "no goal".
        const stale = { ...baseTask(), extendedName: 'fix the popup close button please', name: 'fix the popup close' }

        await runUpdate(stale, live)

        const write = taskWrite()
        expect(write).toBeTruthy()
        expect(write.parentGoalId).toBe(GOAL_ID)
        expect(write.parentGoalIsPublicFor).toEqual([0])
        expect(write.lockKey).toBe('lock-1')
        expect(write.goalSuggestion).toEqual(live.goalSuggestion)
    })

    it('still saves what the editing session actually changed', async () => {
        const stale = { ...baseTask(), extendedName: 'renamed while the router was thinking' }

        await runUpdate(stale, liveTaskWithRoutedGoal())

        expect(taskWrite().extendedName).toBe('renamed while the router was thinking')
    })

    it('lets the user remove a goal they can actually see', async () => {
        const live = liveTaskWithRoutedGoal()
        const deliberate = { ...live, parentGoalId: null, parentGoalIsPublicFor: null, lockKey: '' }

        await runUpdate(deliberate, live)

        expect(taskWrite().parentGoalId).toBeNull()
    })

    it('lets the user move the task to a different goal', async () => {
        const moved = { ...baseTask(), parentGoalId: OTHER_GOAL_ID, parentGoalIsPublicFor: [0] }

        await runUpdate(moved, liveTaskWithRoutedGoal())

        expect(taskWrite().parentGoalId).toBe(OTHER_GOAL_ID)
    })

    it('leaves an ordinary goal-less task alone', async () => {
        const live = baseTask()

        await runUpdate({ ...live, extendedName: 'edited' }, live)

        expect(taskWrite().parentGoalId).toBeNull()
    })
})

describe('setTaskParentGoal persistence', () => {
    it('resolves only after the parent-goal batch has committed', async () => {
        let releaseCommit
        global.__AT2277_COMMIT_BARRIER__ = new Promise(resolve => {
            releaseCommit = resolve
        })

        let resolved = false
        const goal = { id: GOAL_ID, isPublicFor: [0], lockKey: 'lock-1' }
        const saving = setTaskParentGoal(PROJECT_ID, TASK_ID, baseTask(), goal).then(() => {
            resolved = true
        })

        await Promise.resolve()
        expect(resolved).toBe(false)
        expect(taskWrite()).toBeNull()

        releaseCommit()
        await saving

        expect(resolved).toBe(true)
        expect(taskWrite()).toEqual(
            expect.objectContaining({
                parentGoalId: GOAL_ID,
                parentGoalIsPublicFor: [0],
                lockKey: 'lock-1',
            })
        )
    })
})
