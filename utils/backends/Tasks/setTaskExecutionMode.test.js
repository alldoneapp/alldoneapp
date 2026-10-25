/**
 * The "On completion" switch in the task properties writes `executionMode` on the task document.
 *
 * Drives the REAL `setTaskExecutionMode`; only Firestore, the batch wrapper and the undo queue are
 * faked, so what is asserted is the payload that reaches `items/{projectId}/tasks/{taskId}` and the
 * undo entry that can put it back.
 */

const PROJECT_ID = 'project-1'
const TASK_ID = 'task-a'

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
        getDb: () => ({ doc: path => ({ path }) }),
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
            global.__EXECUTION_MODE_WRITES__.push(...this.writes)
        }
    },
}))

jest.mock('../../undo/undoActions', () => ({
    __esModule: true,
    buildObjectUpdateOperation: jest.fn(),
    buildTaskCreateOperation: jest.fn(),
    buildTaskUpdateOperation: jest.fn((projectId, taskId, before, after) => ({ projectId, taskId, before, after })),
    MAX_UNDO_OPERATIONS: 10,
    queueUndoAction: jest.fn(),
}))

import { setTaskExecutionMode } from './tasksFirestore'
import { queueUndoAction } from '../../undo/undoActions'

const task = overrides => ({ id: TASK_ID, name: 'Ship it', ...overrides })
const taskWrites = () =>
    global.__EXECUTION_MODE_WRITES__.filter(write => write.path === `items/${PROJECT_ID}/tasks/${TASK_ID}`)

beforeEach(() => {
    global.__EXECUTION_MODE_WRITES__ = []
    queueUndoAction.mockClear()
})

describe('setTaskExecutionMode', () => {
    it('writes direct mode on the task and queues an undo back to the workflow', async () => {
        await setTaskExecutionMode(PROJECT_ID, task({ executionMode: 'workflow' }), 'direct')

        const writes = taskWrites()
        expect(writes).toHaveLength(1)
        expect(writes[0].data.executionMode).toBe('direct')
        expect(queueUndoAction).toHaveBeenCalledTimes(1)
        expect(queueUndoAction.mock.calls[0][0].operations).toEqual([
            {
                projectId: PROJECT_ID,
                taskId: TASK_ID,
                before: { executionMode: 'workflow' },
                after: { executionMode: 'direct' },
            },
        ])
    })

    it('treats a task without a stored mode as a workflow task', async () => {
        await setTaskExecutionMode(PROJECT_ID, task({ executionMode: null }), 'direct')

        expect(taskWrites()[0].data.executionMode).toBe('direct')
        expect(queueUndoAction.mock.calls[0][0].operations[0].before).toEqual({ executionMode: 'workflow' })
    })

    it('writes nothing when the task is already in that mode', async () => {
        await setTaskExecutionMode(PROJECT_ID, task({ executionMode: 'direct' }), 'direct')
        await setTaskExecutionMode(PROJECT_ID, task({}), 'workflow')

        expect(global.__EXECUTION_MODE_WRITES__).toEqual([])
        expect(queueUndoAction).not.toHaveBeenCalled()
    })
})
