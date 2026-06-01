// chatsFirestoreCloud only needs the ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY constant from
// HelperFunctionsCloud, but that module transitively pulls in firebase-functions/params (not resolvable
// under the root jest config). Stub it so the test exercises the real copyChatToOtherProject logic.
jest.mock('../../functions/Utils/HelperFunctionsCloud', () => ({
    ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY: 'allProjects',
    recursiveDeleteHelper: jest.fn(),
}))

const { copyChatToOtherProject } = require('../../functions/Chats/chatsFirestoreCloud')

// In-memory firebase-admin firestore fake that records writes/updates so we can assert that a chat
// (chat object + comments) is copied into the target project and that the global assistant-comment
// pointer is repointed. Mirrors only the subset of the API copyChatToOtherProject touches.
function makeFakeAdmin({ docs = {}, collections = {} } = {}) {
    const writes = []
    const updates = []

    const makeDocRef = path => ({
        path,
        get: async () => {
            const has = Object.prototype.hasOwnProperty.call(docs, path)
            return {
                exists: has,
                ref: makeDocRef(path),
                data: () => (has ? docs[path] : undefined),
            }
        },
        update: async data => {
            updates.push({ path, data })
        },
    })

    const makeCollectionRef = path => ({
        path,
        get: async () => {
            const items = collections[path] || []
            return {
                forEach: cb => items.forEach(({ id, data }) => cb({ id, data: () => data })),
                docs: items.map(({ id, data }) => ({ id, data: () => data })),
            }
        },
    })

    const makeBatch = () => ({
        set: (ref, data, params) => writes.push({ path: ref.path, data, params }),
        update: (ref, data) => updates.push({ path: ref.path, data }),
        delete: () => {},
        commit: async () => {},
    })

    const firestore = () => ({
        doc: makeDocRef,
        collection: makeCollectionRef,
        batch: makeBatch,
    })

    return { admin: { firestore }, writes, updates }
}

describe('copyChatToOtherProject', () => {
    const SRC = 'srcProject'
    const TGT = 'tgtProject'
    const TASK = 'task1'

    it('copies the chat object and every comment into the target project', async () => {
        const { admin, writes } = makeFakeAdmin({
            docs: {
                [`chatObjects/${SRC}/chats/${TASK}`]: { id: TASK, type: 'tasks', title: 'Hello' },
                [`projects/${SRC}`]: { userIds: [] },
            },
            collections: {
                [`chatComments/${SRC}/tasks/${TASK}/comments`]: [
                    { id: 'c1', data: { commentText: 'first' } },
                    { id: 'c2', data: { commentText: 'second' } },
                ],
            },
        })

        const result = await copyChatToOtherProject(admin, SRC, TGT, 'tasks', TASK)

        expect(result).toBe(true)

        const writtenPaths = writes.map(w => w.path)
        expect(writtenPaths).toContain(`chatObjects/${TGT}/chats/${TASK}`)
        expect(writtenPaths).toContain(`chatComments/${TGT}/tasks/${TASK}/comments/c1`)
        expect(writtenPaths).toContain(`chatComments/${TGT}/tasks/${TASK}/comments/c2`)

        // Original project paths must never be written to.
        expect(writtenPaths.some(p => p.includes(`/${SRC}/`))).toBe(false)

        const chatWrite = writes.find(w => w.path === `chatObjects/${TGT}/chats/${TASK}`)
        expect(chatWrite.data).toEqual({ id: TASK, type: 'tasks', title: 'Hello' })
    })

    it('does nothing when the source chat object does not exist', async () => {
        const { admin, writes } = makeFakeAdmin({
            docs: { [`projects/${SRC}`]: { userIds: [] } },
            collections: {},
        })

        const result = await copyChatToOtherProject(admin, SRC, TGT, 'tasks', TASK)

        expect(result).toBe(false)
        expect(writes).toHaveLength(0)
    })

    it('is a no-op when source and target project are the same', async () => {
        const { admin, writes } = makeFakeAdmin({
            docs: { [`chatObjects/${SRC}/chats/${TASK}`]: { id: TASK, type: 'tasks' } },
        })

        const result = await copyChatToOtherProject(admin, SRC, SRC, 'tasks', TASK)

        expect(result).toBe(false)
        expect(writes).toHaveLength(0)
    })

    it('repoints the global assistant-comment pointer to the target project', async () => {
        const { admin, updates } = makeFakeAdmin({
            docs: {
                [`chatObjects/${SRC}/chats/${TASK}`]: { id: TASK, type: 'tasks' },
                [`projects/${SRC}`]: { userIds: ['u1', 'u2'] },
                [`users/u1`]: {
                    lastAssistantCommentData: {
                        allProjects: { projectId: SRC, objectId: TASK, objectType: 'tasks' },
                    },
                },
                // u2's pointer references a different object, so it must be left untouched.
                [`users/u2`]: {
                    lastAssistantCommentData: {
                        allProjects: { projectId: SRC, objectId: 'otherObject', objectType: 'tasks' },
                    },
                },
            },
            collections: { [`chatComments/${SRC}/tasks/${TASK}/comments`]: [] },
        })

        await copyChatToOtherProject(admin, SRC, TGT, 'tasks', TASK)

        const u1Update = updates.find(u => u.path === 'users/u1')
        expect(u1Update).toBeDefined()
        expect(u1Update.data['lastAssistantCommentData.allProjects']).toEqual({
            projectId: TGT,
            objectId: TASK,
            objectType: 'tasks',
        })

        expect(updates.find(u => u.path === 'users/u2')).toBeUndefined()
    })
})
