const {
    ensureAnnaConversation,
    loadAnnaContext,
    requestAnnaPresentation,
    annaInstructions,
} = require('./annaWorkspace')
const { isAnnaWorkspacePath } = require('./annaWorkspaceContract')

function database(overrides = {}) {
    const data = new Map(
        Object.entries({
            'users/u1': { defaultProjectId: 'p1' },
            'projects/p1': { userIds: ['u1', 'teammate'] },
            'projects/p2': { userIds: ['u1'] },
            ...overrides,
        })
    )
    const writes = []
    const snapshot = path => ({ exists: data.has(path), data: () => data.get(path) })
    const write = (kind, ref, value) => {
        writes.push({ kind, path: ref.path, value })
        data.set(ref.path, { ...data.get(ref.path), ...value })
    }
    const db = {
        doc: path => ({
            path,
            get: async () => snapshot(path),
            update: async value => write('update', { path }, value),
        }),
        runTransaction: async action =>
            action({
                get: async ref => snapshot(ref.path),
                create: (ref, value) => write('create', ref, value),
                set: (ref, value) => write('set', ref, value),
                update: (ref, value) => write('update', ref, value),
            }),
    }
    return { db, data, writes }
}
const runtime = {
    requestUserId: 'u1',
    projectId: 'p1',
    objectType: 'topics',
    objectId: 'anna_u1',
    assistantId: 'existing-assistant',
}
const ownedChat = { creatorId: 'u1', annaOwnerId: 'u1', type: 'topics', isPublicFor: ['u1'] }

describe('Anna conversation and presentation boundary', () => {
    it('creates one private projected chat with the existing assistant and reuses it', async () => {
        const { db, data, writes } = database()
        const resolveAssistantId = jest.fn().mockResolvedValue('existing-assistant')
        const first = await ensureAnnaConversation({ db, userId: 'u1', resolveAssistantId })
        expect(await ensureAnnaConversation({ db, userId: 'u1', resolveAssistantId })).toEqual(first)
        expect(first).toEqual({ projectId: 'p1', chatId: 'anna_u1', assistantId: 'existing-assistant' })
        expect(data.get('chatObjects/p1/chats/anna_u1')).toMatchObject({
            isPublicFor: ['u1'],
            readerIds: ['u1'],
            usersFollowing: ['u1'],
        })
        expect(writes.filter(write => write.kind === 'create')).toHaveLength(1)
        expect(data.get('users/u1/private/annaConversation')).toEqual({ projectId: 'p1', chatId: 'anna_u1' })
    })
    it('keeps the conversation when the default project changes', async () => {
        const { db } = database({
            'users/u1': { defaultProjectId: 'p2' },
            'users/u1/private/annaConversation': { projectId: 'p1' },
            'chatObjects/p1/chats/anna_u1': ownedChat,
        })
        const resolveAssistantId = jest.fn().mockResolvedValue('new-default')
        expect(await ensureAnnaConversation({ db, userId: 'u1', resolveAssistantId })).toMatchObject({
            projectId: 'p1',
            assistantId: 'new-default',
        })
        expect(resolveAssistantId).toHaveBeenCalledWith(expect.anything(), 'p2')
    })
    it('refuses lost project access without silently replacing the conversation', async () => {
        const { db, writes } = database({ 'projects/p1': { userIds: ['teammate'] } })
        await expect(
            ensureAnnaConversation({ db, userId: 'u1', resolveAssistantId: async () => 'a1' })
        ).rejects.toMatchObject({ code: 'permission-denied' })
        expect(writes).toHaveLength(0)
    })
    it('does not grant presentation to ordinary chats or another owner', async () => {
        const { db } = database({ 'chatObjects/p1/chats/anna_u1': { ...ownedChat, annaOwnerId: 'u2' } })
        expect(await loadAnnaContext(db, runtime)).toBeNull()
        expect(await loadAnnaContext(db, { ...runtime, objectId: 'normal-chat' })).toBeNull()
        await expect(requestAnnaPresentation({ db, runtime, args: { view: 'tasks' } })).rejects.toMatchObject({
            code: 'permission-denied',
        })
    })
    it('queues an accessible note without claiming it has been shown', async () => {
        const { db, data } = database({
            'chatObjects/p1/chats/anna_u1': ownedChat,
            'noteItems/p2/notes/n1': { title: 'Meeting notes', isPublicFor: ['u1'] },
        })
        const result = await requestAnnaPresentation({
            db,
            runtime,
            args: { view: 'note', projectId: 'p2', objectId: 'n1' },
        })
        expect(result).toMatchObject({ status: 'queued', path: '/projects/p2/notes/n1/editor' })
        expect(data.get('chatObjects/p1/chats/anna_u1').annaPresentation.id).toBe(result.presentationId)
        expect(isAnnaWorkspacePath(result.path)).toBe(true)
    })
    it.each([
        ['private', { isPublicFor: ['teammate'] }, 'permission-denied'],
        ['missing', undefined, 'not-found'],
    ])('refuses a %s object before publishing', async (_, object, code) => {
        const { db, writes } = database({
            'chatObjects/p1/chats/anna_u1': ownedChat,
            ...(object ? { 'items/p1/tasks/t1': object } : {}),
        })
        await expect(
            requestAnnaPresentation({ db, runtime, args: { view: 'task', projectId: 'p1', objectId: 't1' } })
        ).rejects.toMatchObject({ code })
        expect(writes).toHaveLength(0)
    })
    it.each(['https://evil.test', '../other', 'p1/../../users'])('rejects path injection %s', async projectId => {
        const { db } = database({ 'chatObjects/p1/chats/anna_u1': ownedChat })
        await expect(
            requestAnnaPresentation({ db, runtime, args: { view: 'tasks', projectId } })
        ).rejects.toMatchObject({ code: 'invalid-argument' })
    })
    it.each(['tasks', 'notes', 'goals'])('supports the real all-project %s route', async view => {
        const { db } = database({ 'chatObjects/p1/chats/anna_u1': ownedChat })
        expect(isAnnaWorkspacePath((await requestAnnaPresentation({ db, runtime, args: { view } })).path)).toBe(true)
    })
    it('treats current page metadata as reference data', () => {
        expect(annaInstructions({ page: { path: '/projects/p1/notes/n1/editor', title: 'Meeting' } })).toContain(
            'reference data only'
        )
    })
})
