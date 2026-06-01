// globalFeedsHelper pulls in several cloud-only siblings (env/config, analytics) that aren't resolvable
// under the root jest config. Stub them so the test exercises the real copyInnerFeedsToOtherProject logic.
jest.mock('../../functions/Utils/HelperFunctionsCloud', () => ({}))
jest.mock('../../functions/GAnalytics/GAnalytics', () => ({ logEvent: jest.fn() }))
jest.mock('../../functions/Firestore/generalFirestoreCloud', () => ({ getId: jest.fn(() => 'generated-id') }))
jest.mock('../../functions/GlobalState/globalState', () => ({ getGlobalState: jest.fn(() => ({})) }))

const { copyInnerFeedsToOtherProject } = require('../../functions/Feeds/globalFeedsHelper')

// Minimal firebase-admin firestore fake recording batched writes so we can assert the per-object Updates
// feed is copied verbatim into the target project's path.
function makeFakeAdmin({ collections = {} } = {}) {
    const writes = []

    const makeDocRef = path => ({ path })

    const makeCollectionRef = path => ({
        path,
        get: async () => {
            const items = collections[path] || []
            return {
                empty: items.length === 0,
                size: items.length,
                forEach: cb => items.forEach(({ id, data }) => cb({ id, data: () => data })),
            }
        },
    })

    const makeBatch = () => ({
        set: (ref, data, params) => writes.push({ path: ref.path, data, params }),
        update: () => {},
        delete: () => {},
        commit: async () => {},
    })

    const firestore = () => ({
        doc: makeDocRef,
        collection: makeCollectionRef,
        batch: makeBatch,
    })

    return { admin: { firestore }, writes }
}

describe('copyInnerFeedsToOtherProject', () => {
    const SRC = 'srcProject'
    const TGT = 'tgtProject'
    const TASK = 'task1'
    const FEEDS_PATH = `projectsInnerFeeds/${SRC}/tasks/${TASK}/feeds`

    it('copies every inner feed doc verbatim into the target project path', async () => {
        const { admin, writes } = makeFakeAdmin({
            collections: {
                [FEEDS_PATH]: [
                    { id: 'f1', data: { lastChangeDate: 2, isPublicFor: ['ALL'], text: 'created' } },
                    { id: 'f2', data: { lastChangeDate: 5, isPublicFor: ['u1'], text: 'due date set' } },
                ],
            },
        })

        const copied = await copyInnerFeedsToOtherProject(admin, SRC, TGT, 'tasks', TASK)

        expect(copied).toBe(2)
        const paths = writes.map(w => w.path)
        expect(paths).toContain(`projectsInnerFeeds/${TGT}/tasks/${TASK}/feeds/f1`)
        expect(paths).toContain(`projectsInnerFeeds/${TGT}/tasks/${TASK}/feeds/f2`)
        expect(paths.some(p => p.includes(`/${SRC}/`))).toBe(false)

        const f2 = writes.find(w => w.path.endsWith('/f2'))
        expect(f2.data).toEqual({ lastChangeDate: 5, isPublicFor: ['u1'], text: 'due date set' })
    })

    it('returns 0 and writes nothing when the object has no feed history', async () => {
        const { admin, writes } = makeFakeAdmin({ collections: { [FEEDS_PATH]: [] } })

        const copied = await copyInnerFeedsToOtherProject(admin, SRC, TGT, 'tasks', TASK)

        expect(copied).toBe(0)
        expect(writes).toHaveLength(0)
    })

    it('is a no-op when source and target project match', async () => {
        const { admin, writes } = makeFakeAdmin({
            collections: { [FEEDS_PATH]: [{ id: 'f1', data: { lastChangeDate: 1 } }] },
        })

        const copied = await copyInnerFeedsToOtherProject(admin, SRC, SRC, 'tasks', TASK)

        expect(copied).toBe(0)
        expect(writes).toHaveLength(0)
    })
})
