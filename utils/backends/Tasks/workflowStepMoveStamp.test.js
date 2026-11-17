/**
 * The step picker and the checkbox say who moved a task through its workflow (workflowStepMove), so
 * the conversation a delegated task came from can say "You moved it yourself"
 * (functions/Assistant/delegationReviewNotice.js). firestore.rules lets a browser stamp only itself,
 * with no run lock and no conversation, and undo must not write an older stamp back.
 */

const fs = require('fs')
const path = require('path')

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
            global.__STEP_MOVE_WRITES__.push(...this.writes)
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

import { buildWorkflowStepMoveStamp } from './tasksFirestore'
import store from '../../../redux/store'

const source = fs.readFileSync(path.resolve(__dirname, 'tasksFirestore.js'), 'utf8')
const readFunction = (signature, nextSignature) => {
    const start = source.indexOf(signature)
    expect(start).toBeGreaterThan(-1)
    const end = source.indexOf(nextSignature, start + signature.length)
    return source.slice(start, end === -1 ? source.length : end)
}

describe('buildWorkflowStepMoveStamp', () => {
    it('names the signed-in user and leaves the server-only fields empty', () => {
        const getState = jest.spyOn(store, 'getState').mockReturnValue({ loggedUser: { uid: 'karsten' } })
        const before = Date.now()

        const { workflowStepMove } = buildWorkflowStepMoveStamp('-B-merge', 5000)

        expect(workflowStepMove).toMatchObject({
            stepId: '-B-merge',
            enteredAt: 5000,
            runLockId: null,
            actorUserId: 'karsten',
            fromConversation: null,
        })
        expect(workflowStepMove.at).toBeGreaterThanOrEqual(before)
        // A move to Open has no entry time; the server then matches the stamp by `at`.
        expect(buildWorkflowStepMoveStamp(-1, null).workflowStepMove.enteredAt).toBeNull()
        expect(buildWorkflowStepMoveStamp(-1, { __delete: true }).workflowStepMove.enteredAt).toBeNull()
        getState.mockRestore()
    })
})

describe('every browser path that moves a task through its workflow', () => {
    const paths = {
        moveTasksFromMiddleOfWorkflow: readFunction(
            'export async function moveTasksFromMiddleOfWorkflow(',
            'const getTaskCompletedTime ='
        ),
        moveTasksFromOpen: readFunction(
            'export async function moveTasksFromOpen(',
            'export async function moveTasksFromDone('
        ),
        moveTasksFromDone: readFunction(
            'export async function moveTasksFromDone(',
            'export async function setTaskStatus('
        ),
    }

    it.each(Object.keys(paths))('%s stamps the mover and keeps the stamp out of undo', name => {
        const body = paths[name]
        expect(body).toContain('...buildWorkflowStepMoveStamp(stepToMoveId, updateData.completed),')
        expect(body).toContain('const undoableTaskUpdateData = withoutWorkflowStepMoveStamp(taskUpdateData)')
        expect(body).toContain('afterChanges: undoableTaskUpdateData')
        expect(body).not.toContain('afterChanges: taskUpdateData')
    })

    it('setTaskStatus stamps the checkbox but records undo from the fields without it', () => {
        const body = readFunction('export async function setTaskStatus(', '\nexport ')
        expect(body).toContain(
            'buildWorkflowStepMoveStamp(isDone ? DONE_STEP : getReopenedStepId(task), completedDate)'
        )
        expect(body).toContain('updateTaskData(projectId, taskId, { ...updateData, ...stepMoveStamp }, taskBatch)')
        expect(body).toContain('const taskUndoChanges = { ...updateData }')
    })
})
