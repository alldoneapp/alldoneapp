'use strict'

const { ProjectMoveChatError, buildMovedTopicChatData, copyProjectMoveChat } = require('./copyProjectMoveChat')

function createAdmin(documents) {
    const writes = []
    const updates = []
    const deletes = []
    const database = {
        doc: path => ({
            get: async () => {
                const data = documents[path]
                return { exists: data !== undefined, data: () => data }
            },
            set: async (data, options) => writes.push({ path, data, options }),
            update: async data => updates.push({ path, data }),
            delete: async () => deletes.push(path),
        }),
    }
    return { adminRef: { firestore: () => database }, writes, updates, deletes }
}

describe('copyProjectMoveChat', () => {
    it('copies comments through the server helper and rebuilds topic followers for the target project', async () => {
        const sourceChat = {
            isPublicFor: [0],
            usersFollowing: ['actor', 'target-member', 'source-only'],
            members: ['target-member', 'source-only'],
            movingToOtherProjectId: 'stale-target',
        }
        const { adminRef, writes, updates, deletes } = createAdmin({
            'projects/target': { userIds: ['actor', 'target-member'] },
            'chatObjects/source/chats/chat-1': sourceChat,
            'followers/source/topics/chat-1': { usersFollowing: ['target-member', 'source-only'] },
        })
        const copyChat = jest.fn(async () => true)

        const result = await copyProjectMoveChat({
            adminRef,
            actorId: 'actor',
            sourceProjectId: 'source',
            targetProjectId: 'target',
            objectType: 'topics',
            objectId: 'chat-1',
            copyChat,
        })

        expect(result).toEqual({ copied: true, followerCount: 2 })
        expect(copyChat).toHaveBeenCalledWith(adminRef, 'source', 'target', 'topics', 'chat-1', {
            chatData: expect.objectContaining({
                usersFollowing: ['target-member', 'actor'],
                members: ['target-member'],
            }),
        })
        expect(copyChat.mock.calls[0][5].chatData).not.toHaveProperty('movingToOtherProjectId')
        expect(writes.map(write => write.path)).toEqual(
            expect.arrayContaining([
                'followers/target/topics/chat-1',
                'usersFollowing/target/entries/actor',
                'usersFollowing/target/entries/target-member',
            ])
        )
        expect(updates).toContainEqual({
            path: 'chatObjects/source/chats/chat-1',
            data: { movingToOtherProjectId: 'target' },
        })
        expect(deletes).toContain('chatObjects/source/chats/chat-1')
    })

    it('rejects copying a private conversation the actor cannot write', async () => {
        const { adminRef } = createAdmin({
            'projects/target': { userIds: ['actor'] },
            'chatObjects/source/chats/task-1': { isPublicFor: ['someone-else'] },
        })

        await expect(
            copyProjectMoveChat({
                adminRef,
                actorId: 'actor',
                sourceProjectId: 'source',
                targetProjectId: 'target',
                objectType: 'tasks',
                objectId: 'task-1',
                copyChat: jest.fn(),
            })
        ).rejects.toMatchObject({ name: 'ProjectMoveChatError', code: 'permission-denied' })
    })

    it('returns cleanly when the moved object has no conversation', async () => {
        const { adminRef, updates, deletes } = createAdmin({ 'projects/target': { userIds: ['actor'] } })

        await expect(
            copyProjectMoveChat({
                adminRef,
                actorId: 'actor',
                sourceProjectId: 'source',
                targetProjectId: 'target',
                objectType: 'tasks',
                objectId: 'task-1',
                copyChat: jest.fn(),
            })
        ).resolves.toEqual({ copied: false, reason: 'no-chat' })
        expect(updates).toEqual([])
        expect(deletes).toEqual([])
    })
})

describe('buildMovedTopicChatData', () => {
    it('keeps a private moved chat writable by the actor', () => {
        expect(
            buildMovedTopicChatData(
                { isPublicFor: ['source-member'], members: ['source-member', 'actor'] },
                ['actor'],
                'actor',
                ['actor']
            )
        ).toMatchObject({ isPublicFor: ['actor'], members: ['actor'], usersFollowing: ['actor'] })
    })
})
