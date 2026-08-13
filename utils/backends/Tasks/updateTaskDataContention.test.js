/**
 * Task updates must be blind masked updates, not read-modify-write transactions.
 *
 * The transactions this pins against produced failed-precondition retry storms in
 * production: every non-batch `updateTaskData` (and every `updateTaskEditionData`
 * stamp) read the task and committed with an updateTime precondition, so the
 * server-side humanReadableId generator, the follow chains and other clients
 * racing on a hot task turned each write into a chain of logged 400 Commits.
 * A masked `update()` needs none of that — it can never remove a field it does
 * not name, so humanReadableId is preserved by definition.
 *
 * Drives the REAL `updateTaskData` / `updateTaskEditionData`; only Firestore and
 * the store are faked, so what is asserted is the payload and the write primitive
 * that actually reach `items/{projectId}/tasks/{taskId}`.
 */

const PROJECT_ID = 'project-1'
const USER_ID = 'user-1'
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
        getDb: () => global.__UPDTD_DB__,
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

jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: {
        getState: () => ({ loggedUser: { uid: 'user-1' } }),
        dispatch: jest.fn(),
    },
}))

import { updateTaskData, updateTaskEditionData } from './tasksFirestore'

const makeDb = ({ updateImpl } = {}) => {
    const refs = {}
    const db = {
        doc: path => {
            if (!refs[path]) {
                refs[path] = {
                    path,
                    update: jest.fn(updateImpl || (async () => {})),
                    get: async () => {
                        throw new Error('a blind update must not read the task first')
                    },
                }
            }
            return refs[path]
        },
        runTransaction: jest.fn(async () => {
            throw new Error('task updates must not run transactions')
        }),
    }
    return { db, refs }
}

const taskPath = `items/${PROJECT_ID}/tasks/${TASK_ID}`

beforeEach(() => {
    jest.clearAllMocks()
})

describe('updateTaskData', () => {
    it('performs a plain masked update without a transaction and without touching humanReadableId', async () => {
        const { db, refs } = makeDb()
        global.__UPDTD_DB__ = db

        await updateTaskData(PROJECT_ID, TASK_ID, { dueDate: 123, sortIndex: 456 }, null)

        expect(db.runTransaction).not.toHaveBeenCalled()
        const ref = refs[taskPath]
        expect(ref.update).toHaveBeenCalledTimes(1)
        const payload = ref.update.mock.calls[0][0]
        expect(payload).not.toHaveProperty('humanReadableId')
        expect(payload.dueDate).toBe(123)
        expect(payload.sortIndex).toBe(456)
        // The edition stamp still rides along on every update.
        expect(payload.lastEditorId).toBe(USER_ID)
        expect(typeof payload.lastEditionDate).toBe('number')
    })

    it('strips an explicit null humanReadableId so a stale copy can never clobber a generated id', async () => {
        const { db, refs } = makeDb()
        global.__UPDTD_DB__ = db

        await updateTaskData(PROJECT_ID, TASK_ID, { humanReadableId: null, dueDate: 123 }, null)

        const payload = refs[taskPath].update.mock.calls[0][0]
        expect(payload).not.toHaveProperty('humanReadableId')
        expect(payload.dueDate).toBe(123)
    })

    it('strips null humanReadableId on the batch path too (the transaction never covered it)', async () => {
        const { db } = makeDb()
        global.__UPDTD_DB__ = db
        const batch = { update: jest.fn() }

        await updateTaskData(PROJECT_ID, TASK_ID, { humanReadableId: null, name: 'renamed' }, batch)

        expect(batch.update).toHaveBeenCalledTimes(1)
        const [ref, payload] = batch.update.mock.calls[0]
        expect(ref.path).toBe(taskPath)
        expect(payload).not.toHaveProperty('humanReadableId')
        expect(payload.name).toBe('renamed')
    })

    it('passes a real humanReadableId through unchanged', async () => {
        const { db, refs } = makeDb()
        global.__UPDTD_DB__ = db

        await updateTaskData(PROJECT_ID, TASK_ID, { humanReadableId: 'JO-1818' }, null)

        expect(refs[taskPath].update.mock.calls[0][0].humanReadableId).toBe('JO-1818')
    })
})

describe('updateTaskEditionData', () => {
    it('stamps edition data with a blind update — no transaction, no read', async () => {
        const { db, refs } = makeDb()
        global.__UPDTD_DB__ = db

        await updateTaskEditionData(PROJECT_ID, TASK_ID, USER_ID)

        expect(db.runTransaction).not.toHaveBeenCalled()
        const payload = refs[taskPath].update.mock.calls[0][0]
        expect(payload.lastEditorId).toBe(USER_ID)
        expect(typeof payload.lastEditionDate).toBe('number')
        expect(Object.keys(payload).sort()).toEqual(['lastEditionDate', 'lastEditorId'])
    })

    it('swallows not-found (task deleted meanwhile) and rethrows everything else', async () => {
        const notFound = Object.assign(new Error('missing'), { code: 'not-found' })
        const { db: dbNotFound } = makeDb({ updateImpl: async () => Promise.reject(notFound) })
        global.__UPDTD_DB__ = dbNotFound
        await expect(updateTaskEditionData(PROJECT_ID, TASK_ID, USER_ID)).resolves.toBeUndefined()

        const denied = Object.assign(new Error('denied'), { code: 'permission-denied' })
        const { db: dbDenied } = makeDb({ updateImpl: async () => Promise.reject(denied) })
        global.__UPDTD_DB__ = dbDenied
        await expect(updateTaskEditionData(PROJECT_ID, TASK_ID, USER_ID)).rejects.toBe(denied)
    })
})
