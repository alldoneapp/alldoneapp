'use strict'

const { markChatNotificationsRead } = require('./markChatNotificationsRead')

function createSnapshot(path, data) {
    return {
        id: path.split('/').pop(),
        ref: { path },
        exists: data !== undefined,
        data: () => data,
    }
}

function createDb(seed) {
    const writes = []
    const queries = []
    const matches = (data, [field, operator, value]) => {
        if (operator === '==') return data?.[field] === value
        if (operator === 'array-contains') return Array.isArray(data?.[field]) && data[field].includes(value)
        return false
    }
    const db = {
        collection: jest.fn(path => {
            const filters = []
            const collectionQuery = {
                where: jest.fn((field, operator, value) => {
                    filters.push([field, operator, value])
                    return collectionQuery
                }),
                get: jest.fn(async () => {
                    queries.push({ path, filters: [...filters] })
                    const docs = (seed[path] || []).filter(document =>
                        filters.every(filter => matches(document.data(), filter))
                    )
                    return { docs }
                }),
            }
            return collectionQuery
        }),
        doc: jest.fn(path => ({
            get: async () => createSnapshot(path, seed[path]),
        })),
        batch: jest.fn(() => ({
            delete: ref => writes.push({ operation: 'delete', path: ref.path }),
            set: (ref, data, options) => writes.push({ operation: 'set', path: ref.path, data, options }),
            commit: jest.fn(async () => undefined),
        })),
    }
    return { db, writes, queries }
}

const FieldValue = {
    arrayRemove: value => ({ operation: 'arrayRemove', value }),
}

describe('markChatNotificationsRead', () => {
    it('clears one chat and removes only the authenticated recipient', async () => {
        const { db, writes, queries } = createDb({
            'chatNotifications/project-1/user-1': [
                createSnapshot('chatNotifications/project-1/user-1/comment-1', { chatId: 'chat-1' }),
                createSnapshot('chatNotifications/project-1/user-1/comment-2', { chatId: 'chat-2' }),
            ],
            'emailNotifications/chat-1': {
                projectId: 'project-1',
                objectId: 'chat-1',
                userIds: ['user-1', 'user-2'],
            },
            pushNotifications: [
                createSnapshot('pushNotifications/push-1', {
                    projectId: 'project-1',
                    chatId: 'chat-1',
                    userIds: ['user-1'],
                }),
                createSnapshot('pushNotifications/push-2', {
                    projectId: 'project-1',
                    chatId: 'chat-2',
                    userIds: ['user-1'],
                }),
                createSnapshot('pushNotifications/push-3', {
                    projectId: 'project-2',
                    chatId: 'chat-1',
                    userIds: ['user-1'],
                }),
            ],
        })

        await expect(
            markChatNotificationsRead({ db, FieldValue, userId: 'user-1', projectId: 'project-1', chatId: 'chat-1' })
        ).resolves.toEqual({
            chatNotificationsCleared: 1,
            emailNotificationsCleared: 1,
            pushNotificationsCleared: 1,
        })

        expect(queries).toEqual(
            expect.arrayContaining([
                {
                    path: 'chatNotifications/project-1/user-1',
                    filters: [['chatId', '==', 'chat-1']],
                },
                {
                    path: 'pushNotifications',
                    filters: [['userIds', 'array-contains', 'user-1']],
                },
            ])
        )
        expect(queries).toHaveLength(2)
        expect(writes).toEqual([
            { operation: 'delete', path: 'chatNotifications/project-1/user-1/comment-1' },
            {
                operation: 'set',
                path: 'emailNotifications/chat-1',
                data: { userIds: { operation: 'arrayRemove', value: 'user-1' } },
                options: { merge: true },
            },
            { operation: 'delete', path: 'pushNotifications/push-1' },
        ])
    })

    it('handles a missing email side-channel document and bulk followed cleanup', async () => {
        const { db, writes } = createDb({
            'chatNotifications/project-1/user-1': [
                createSnapshot('chatNotifications/project-1/user-1/comment-1', { followed: true }),
                createSnapshot('chatNotifications/project-1/user-1/comment-2', { followed: false }),
            ],
            emailNotifications: [],
            pushNotifications: [],
        })

        await expect(
            markChatNotificationsRead({
                db,
                FieldValue,
                userId: 'user-1',
                projectId: 'project-1',
                followedOnly: true,
            })
        ).resolves.toEqual({
            chatNotificationsCleared: 1,
            emailNotificationsCleared: 0,
            pushNotificationsCleared: 0,
        })
        expect(writes).toEqual([{ operation: 'delete', path: 'chatNotifications/project-1/user-1/comment-1' }])
    })

    it('treats a missing single-chat email notification as already clear', async () => {
        const { db } = createDb({
            'chatNotifications/project-1/user-1': [],
            pushNotifications: [],
        })

        await expect(
            markChatNotificationsRead({ db, FieldValue, userId: 'user-1', projectId: 'project-1', chatId: 'chat-1' })
        ).resolves.toEqual({
            chatNotificationsCleared: 0,
            emailNotificationsCleared: 0,
            pushNotificationsCleared: 0,
        })
        expect(db.batch).not.toHaveBeenCalled()
    })
})
