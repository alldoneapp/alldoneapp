'use strict'

const { createBotQuickTopic } = require('./createBotQuickTopic')

function createDb({ count = 2, existingChat = null, projectUserIds = ['actor', 'teammate'] } = {}) {
    const writes = []
    const snapshots = {
        'projects/project-1': { exists: true, data: () => ({ userIds: projectUserIds }) },
        'chatObjects/project-1/chats/chat-1': existingChat
            ? { exists: true, data: () => existingChat }
            : { exists: false, data: () => undefined },
    }
    const refs = new Map()
    const doc = jest.fn(path => {
        if (!refs.has(path)) {
            refs.set(path, {
                path,
                get: jest.fn(async () => snapshots[path] || { exists: false, data: () => undefined }),
            })
        }
        return refs.get(path)
    })
    const getCount = jest.fn(async () => ({ data: () => ({ count }) }))
    const countQuery = jest.fn(() => ({ get: getCount }))
    const where = jest.fn(() => ({ count: countQuery }))
    const collection = jest.fn(() => ({ where }))
    const batch = {
        create: jest.fn((ref, data) => writes.push({ operation: 'create', path: ref.path, data })),
        set: jest.fn((ref, data, options) => writes.push({ operation: 'set', path: ref.path, data, options })),
        update: jest.fn((ref, data) => writes.push({ operation: 'update', path: ref.path, data })),
        commit: jest.fn(async () => undefined),
    }

    return { db: { doc, collection, batch: () => batch }, writes, collection, where, batch }
}

const request = {
    actorId: 'actor',
    projectId: 'project-1',
    chatId: 'chat-1',
    assistantId: 'assistant-1',
    quickDateId: '20260830',
    titlePrefix: 'Assistant <> Karsten 30.08.2026',
    isAssistantEnabled: true,
    now: 1234,
}

describe('createBotQuickTopic', () => {
    it('creates a readable topic, follower state and daily number in one server batch', async () => {
        const { db, writes, where, batch } = createDb()

        await expect(createBotQuickTopic({ db, ...request })).resolves.toEqual({
            projectId: 'project-1',
            chatId: 'chat-1',
            assistantId: 'assistant-1',
            isPublicFor: [0],
            title: 'Assistant <> Karsten 30.08.2026 3',
        })
        expect(where).toHaveBeenCalledWith('quickDateId', '==', '20260830')
        expect(writes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    operation: 'create',
                    path: 'chatObjects/project-1/chats/chat-1',
                    data: expect.objectContaining({
                        creatorId: 'actor',
                        members: ['actor'],
                        usersFollowing: ['actor'],
                        isAssistantEnabled: true,
                        readerIds: [0, 'actor', 'teammate'],
                        followedReaderIds: ['actor'],
                    }),
                }),
                expect.objectContaining({ path: 'followers/project-1/topics/chat-1' }),
                expect.objectContaining({ path: 'usersFollowing/project-1/entries/actor' }),
                expect.objectContaining({ operation: 'update', path: 'projects/project-1' }),
            ])
        )
        expect(batch.commit).toHaveBeenCalledTimes(1)
    })

    it('rejects a caller who is not an authoritative project member', async () => {
        const { db, batch } = createDb({ projectUserIds: ['teammate'] })

        await expect(createBotQuickTopic({ db, ...request })).rejects.toMatchObject({
            name: 'BotQuickTopicError',
            code: 'permission-denied',
        })
        expect(batch.commit).not.toHaveBeenCalled()
    })

    it('rejects ids that could escape the intended Firestore document path', async () => {
        const { db, collection, batch } = createDb()

        await expect(createBotQuickTopic({ db, ...request, chatId: 'nested/chat' })).rejects.toMatchObject({
            name: 'BotQuickTopicError',
            code: 'invalid-argument',
        })
        expect(collection).not.toHaveBeenCalled()
        expect(batch.commit).not.toHaveBeenCalled()
    })

    it('returns an existing topic owned by the same actor for retry safety', async () => {
        const { db, collection, batch } = createDb({
            existingChat: {
                creatorId: 'actor',
                type: 'topics',
                assistantId: 'assistant-1',
                isPublicFor: [0],
                title: 'Existing title',
            },
        })

        await expect(createBotQuickTopic({ db, ...request })).resolves.toMatchObject({ title: 'Existing title' })
        expect(collection).not.toHaveBeenCalled()
        expect(batch.commit).not.toHaveBeenCalled()
    })
})
