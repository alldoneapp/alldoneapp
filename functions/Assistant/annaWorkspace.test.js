const {
    ensureAnnaConversation,
    listAnnaConversations,
    loadAnnaHistoryContext,
    loadAnnaContext,
    requestAnnaPresentation,
    annaInstructions,
} = require('./annaWorkspace')
const { isAnnaWorkspacePath } = require('./annaWorkspaceContract')

function database(overrides = {}) {
    const data = new Map(
        Object.entries({
            'users/u1': { defaultProjectId: 'p1', timezone: 'Europe/Berlin' },
            'projects/p1': { userIds: ['u1', 'teammate'] },
            'projects/p2': { userIds: ['u1'] },
            ...overrides,
        })
    )
    const writes = []
    const snapshot = path => ({ id: path.split('/').pop(), exists: data.has(path), data: () => data.get(path) })
    const write = (kind, ref, value) => {
        writes.push({ kind, path: ref.path, value })
        data.set(ref.path, { ...data.get(ref.path), ...value })
    }
    const db = {
        getAll: jest.fn(async (...refs) => refs.map(ref => snapshot(ref.path))),
        doc: path => ({
            path,
            get: async () => snapshot(path),
            update: async value => write('update', { path }, value),
        }),
        collection: path => {
            let before = null,
                count = Infinity
            const query = {
                orderBy: () => query,
                startAfter: (created, id) => {
                    before = { created, id }
                    return query
                },
                limit: value => {
                    count = value
                    return query
                },
                get: async () => ({
                    docs: [...data.entries()]
                        .filter(([key]) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/'))
                        .sort(([ak, a], [bk, b]) => b.created - a.created || bk.localeCompare(ak))
                        .filter(
                            ([key, value]) =>
                                !before ||
                                value.created < before.created ||
                                (value.created === before.created && key.split('/').pop() < before.id)
                        )
                        .slice(0, count)
                        .map(([key]) => snapshot(key)),
                }),
            }
            return query
        },
        runTransaction: async action =>
            action({
                get: async ref => snapshot(ref.path),
                getAll: async (...refs) => refs.map(ref => snapshot(ref.path)),
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
    it('creates one daily chat with WhatsApp sharing and reuses it within the local day', async () => {
        const { db, data, writes } = database()
        const resolveAssistantId = jest.fn().mockResolvedValue('existing-assistant')
        const now = Date.parse('2026-10-07T21:59:00Z')
        const first = await ensureAnnaConversation({ db, userId: 'u1', resolveAssistantId, now })
        const initialWriteCount = writes.length
        expect(await ensureAnnaConversation({ db, userId: 'u1', resolveAssistantId, now: now + 1000 })).toEqual(first)
        expect(writes).toHaveLength(initialWriteCount)
        expect(first.conversation).toMatchObject({ id: first.chatId, projectId: 'p1', annaOwnerId: 'u1' })
        expect(first).toMatchObject({
            projectId: 'p1',
            chatId: 'AnnaChat20261007u1',
            assistantId: 'existing-assistant',
            nextRolloverAt: Date.parse('2026-10-07T22:00:00Z'),
        })
        expect(data.get('chatObjects/p1/chats/AnnaChat20261007u1')).toMatchObject({
            isPublicFor: [0],
            readerIds: expect.arrayContaining(['u1', 'teammate']),
            usersFollowing: ['u1'],
        })
        expect(writes.filter(write => write.kind === 'create')).toHaveLength(1)
        expect(data.get('users/u1/private/annaConversation')).toMatchObject({
            projectId: 'p1',
            chatId: 'AnnaChat20261007u1',
        })
    })
    it('starts in the new default project and keeps the old private conversation in history', async () => {
        const { db, data } = database({
            'users/u1': { defaultProjectId: 'p2' },
            'users/u1/private/annaConversation': { projectId: 'p1' },
            'chatObjects/p1/chats/anna_u1': ownedChat,
        })
        const resolveAssistantId = jest.fn().mockResolvedValue('new-default')
        expect(await ensureAnnaConversation({ db, userId: 'u1', resolveAssistantId })).toMatchObject({
            projectId: 'p2',
            assistantId: 'new-default',
        })
        expect(resolveAssistantId).toHaveBeenCalledWith(expect.anything(), 'p2')
        expect(data.get('chatObjects/p1/chats/anna_u1').isPublicFor).toEqual(['u1'])
        expect((await listAnnaConversations({ db, userId: 'u1' })).threads).toEqual(
            expect.arrayContaining([expect.objectContaining({ projectId: 'p1', chatId: 'anna_u1' })])
        )
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

it('rolls at local midnight with a new thread and bounded previous-day context, without mixing WhatsApp', async () => {
    const { db, data } = database()
    const first = await ensureAnnaConversation({
        db,
        userId: 'u1',
        resolveAssistantId: async () => 'a1',
        now: Date.parse('2026-10-07T21:59:00Z'),
    })
    const second = await ensureAnnaConversation({
        db,
        userId: 'u1',
        resolveAssistantId: async () => 'a1',
        now: Date.parse('2026-10-07T22:01:00Z'),
    })
    expect(first.chatId).toBe('AnnaChat20261007u1')
    expect(second.chatId).toBe('AnnaChat20261008u1')
    expect(data.get(`chatObjects/p1/chats/${second.chatId}`).annaPreviousThread).toEqual({
        projectId: 'p1',
        chatId: first.chatId,
    })
    data.set(`chatComments/p1/topics/${first.chatId}/comments/m1`, {
        commentText: 'Continue the task tomorrow',
        created: 1,
    })
    data.set('chatComments/p1/topics/BotChat20261007u1/comments/m2', { commentText: 'WhatsApp only', created: 2 })
    const history = await loadAnnaHistoryContext(db, { ...runtime, objectId: second.chatId })
    expect(history).toContain('Continue the task tomorrow')
    expect(history).not.toContain('WhatsApp only')
    expect(await loadAnnaContext(db, { ...runtime, objectId: second.chatId })).not.toBeNull()
})

it('does not expose inaccessible historical projects and paginates equal timestamps without skipping threads', async () => {
    const { db, data } = database()
    for (const projectId of ['p1', 'p2']) {
        data.set('users/u1', { defaultProjectId: projectId, timezone: 2 })
        await ensureAnnaConversation({
            db,
            userId: 'u1',
            resolveAssistantId: async () => 'a1',
            now: Date.parse('2026-10-07T23:00:00Z'),
        })
    }
    const page1 = await listAnnaConversations({ db, userId: 'u1', limit: 1 })
    const page2 = await listAnnaConversations({ db, userId: 'u1', limit: 1, before: page1.nextBefore })
    expect(new Set([...page1.threads, ...page2.threads].map(thread => thread.projectId)).size).toBe(2)
    data.set('projects/p1', { userIds: ['teammate'] })
    expect((await listAnnaConversations({ db, userId: 'u1' })).threads.map(thread => thread.projectId)).toEqual(['p2'])
})

it('opens real task comments and assistant-filtered task lists', async () => {
    const { db } = database({ 'chatObjects/p1/chats/anna_u1': ownedChat, 'items/p1/tasks/t1': { isPublicFor: [0] } })
    const detail = await requestAnnaPresentation({
        db,
        runtime,
        args: { view: 'task', projectId: 'p1', objectId: 't1', tab: 'chat' },
    })
    expect(detail.path).toBe('/projects/p1/tasks/t1/chat')
    expect(isAnnaWorkspacePath(detail.path)).toBe(true)
    const list = await requestAnnaPresentation({
        db,
        runtime,
        args: { view: 'tasks', projectId: 'p1', assigneeId: 'a1' },
    })
    expect(list.path).toBe('/projects/p1/user/a1/tasks/open')
})

it('updates changed assistant settings and repairs a missing registry without rewriting an unchanged pointer', async () => {
    const { db, data, writes } = database()
    const now = Date.parse('2026-10-07T12:00:00Z')
    const args = { db, userId: 'u1', now, resolveAssistantId: async () => 'a1' }
    const reference = await ensureAnnaConversation(args)
    data.delete(`users/u1/private/annaConversation/threads/p1__${reference.chatId}`)
    const beforeRepair = writes.length
    await ensureAnnaConversation(args)
    expect(writes.slice(beforeRepair).map(write => write.path)).toEqual([
        `users/u1/private/annaConversation/threads/p1__${reference.chatId}`,
    ])
    const changed = await ensureAnnaConversation({ ...args, resolveAssistantId: async () => 'a2' })
    expect(changed.assistantId).toBe('a2')
    expect(changed.conversation.assistantId).toBe('a2')
    expect(data.get(`chatObjects/p1/chats/${reference.chatId}`).assistantId).toBe('a2')
})

it('validates all history in one batch, reuses project reads, and still rejects foreign or missing chats', async () => {
    const { db, data } = database()
    for (let day = 1; day <= 7; day++) {
        const chatId = `AnnaChat2026100${day}u1`
        data.set(`users/u1/private/annaConversation/threads/p1__${chatId}`, { projectId: 'p1', chatId, created: day })
        data.set(`chatObjects/p1/chats/${chatId}`, { ...ownedChat, assistantId: 'a1' })
    }
    data.set('chatObjects/p1/chats/AnnaChat20261003u1', { ...ownedChat, annaOwnerId: 'u2' })
    data.delete('chatObjects/p1/chats/AnnaChat20261002u1')
    const result = await listAnnaConversations({ db, userId: 'u1' })
    expect(result.threads.map(thread => thread.chatId)).toEqual([
        'AnnaChat20261007u1',
        'AnnaChat20261006u1',
        'AnnaChat20261005u1',
        'AnnaChat20261004u1',
        'AnnaChat20261001u1',
    ])
    expect(db.getAll).toHaveBeenCalledTimes(1)
    expect(db.getAll.mock.calls[0]).toHaveLength(8)
    expect(result.nextBefore).toEqual({ created: 1, id: 'p1__AnnaChat20261001u1' })
})
