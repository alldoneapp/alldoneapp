'use strict'

const { copyFollowUpTaskChat } = require('./copyFollowUpTaskChat')

function createAdmin(documents, comments = []) {
    const writes = []
    const updates = []
    const database = {
        doc: path => ({
            path,
            get: async () => {
                const data = documents[path]
                return { exists: data !== undefined, data: () => data }
            },
        }),
        collection: path => ({
            get: async () => ({
                docs: comments.map(comment => ({ id: comment.id, data: () => comment.data })),
            }),
        }),
    }
    const batchFactory = () => ({
        set: (ref, data) => writes.push({ path: ref.path, data }),
        update: (ref, data) => updates.push({ path: ref.path, data }),
        commit: jest.fn().mockResolvedValue(undefined),
    })
    return { adminRef: { firestore: () => database }, batchFactory, writes, updates }
}

const publicTask = extra => ({ isPublicFor: [0], ...extra })

describe('copyFollowUpTaskChat', () => {
    it('copies an existing conversation after the target task exists', async () => {
        const projectId = 'project-1'
        const sourceTaskId = 'source-task'
        const targetTaskId = 'target-task'
        const { adminRef, batchFactory, writes, updates } = createAdmin(
            {
                [`items/${projectId}/tasks/${sourceTaskId}`]: publicTask({ creatorId: 'someone-else' }),
                [`items/${projectId}/tasks/${targetTaskId}`]: publicTask({
                    creatorId: 'actor',
                    followUpSourceTaskId: sourceTaskId,
                    extendedName: '#FollowUp Important work',
                }),
                [`chatObjects/${projectId}/chats/${sourceTaskId}`]: publicTask({
                    id: sourceTaskId,
                    title: 'Important work',
                    creatorId: 'someone-else',
                    readerIds: ['actor'],
                    roleIdsVisibleTo: { actor: ['actor'] },
                    followedByVisibleTo: { actor: true },
                    followedReaderIds: ['actor'],
                    backlinkIdsVisibleTo: { actor: ['linkedParentTasksIds', sourceTaskId] },
                }),
            },
            [
                {
                    id: 'old-comment',
                    data: { commentText: 'Earlier context', creatorId: 'other-user', lastChangeDate: 10 },
                },
                {
                    id: 'generated-link',
                    data: { commentText: 'Follow up task created: https://example.test', creatorId: 'actor' },
                },
                {
                    id: 'last-comment',
                    data: { commentText: 'Latest context', creatorId: 'assistant-1', lastChangeDate: 20 },
                },
            ]
        )

        await expect(
            copyFollowUpTaskChat({
                adminRef,
                actorId: 'actor',
                projectId,
                sourceTaskId,
                targetTaskId,
                batchFactory,
            })
        ).resolves.toEqual({ copied: true, commentCount: 2 })

        expect(writes.map(write => write.path)).toEqual(
            expect.arrayContaining([
                `chatComments/${projectId}/tasks/${targetTaskId}/comments/old-comment`,
                `chatComments/${projectId}/tasks/${targetTaskId}/comments/last-comment`,
                `chatObjects/${projectId}/chats/${targetTaskId}`,
            ])
        )
        expect(writes.map(write => write.path)).not.toContain(
            `chatComments/${projectId}/tasks/${targetTaskId}/comments/generated-link`
        )

        const copiedChat = writes.find(write => write.path === `chatObjects/${projectId}/chats/${targetTaskId}`).data
        expect(copiedChat).toMatchObject({
            id: targetTaskId,
            title: '#FollowUp Important work',
            creatorId: 'actor',
            commentsData: {
                lastComment: 'Latest context',
                lastCommentType: 2,
                amount: 2,
                lastCommentOwnerId: 'assistant-1',
            },
        })
        expect(copiedChat).not.toHaveProperty('readerIds')
        expect(copiedChat).not.toHaveProperty('roleIdsVisibleTo')
        expect(copiedChat).not.toHaveProperty('followedByVisibleTo')
        expect(copiedChat).not.toHaveProperty('followedReaderIds')
        expect(copiedChat).not.toHaveProperty('backlinkIdsVisibleTo')
        expect(updates).toContainEqual({
            path: `items/${projectId}/tasks/${targetTaskId}`,
            data: { commentsData: copiedChat.commentsData },
        })
    })

    it('returns without writes when the source task has no conversation', async () => {
        const { adminRef, batchFactory, writes, updates } = createAdmin({
            'items/project-1/tasks/source-task': publicTask({ creatorId: 'actor' }),
            'items/project-1/tasks/target-task': publicTask({
                creatorId: 'actor',
                followUpSourceTaskId: 'source-task',
            }),
        })

        await expect(
            copyFollowUpTaskChat({
                adminRef,
                actorId: 'actor',
                projectId: 'project-1',
                sourceTaskId: 'source-task',
                targetTaskId: 'target-task',
                batchFactory,
            })
        ).resolves.toEqual({ copied: false, reason: 'no-chat', commentCount: 0 })
        expect(writes).toEqual([])
        expect(updates).toEqual([])
    })

    it('rejects a target that was not created as this follow-up', async () => {
        const { adminRef, batchFactory } = createAdmin({
            'items/project-1/tasks/source-task': publicTask({ creatorId: 'actor' }),
            'items/project-1/tasks/target-task': publicTask({ creatorId: 'actor' }),
        })

        await expect(
            copyFollowUpTaskChat({
                adminRef,
                actorId: 'actor',
                projectId: 'project-1',
                sourceTaskId: 'source-task',
                targetTaskId: 'target-task',
                batchFactory,
            })
        ).rejects.toMatchObject({ name: 'FollowUpTaskChatError', code: 'permission-denied' })
    })
})
