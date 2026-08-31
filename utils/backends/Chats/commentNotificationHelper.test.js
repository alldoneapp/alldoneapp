import { buildCommentNotificationIdentity } from './commentNotificationHelper'

describe('commentNotificationHelper', () => {
    it('keeps the client notification payload aligned with the Firestore comment proof', () => {
        expect(
            buildCommentNotificationIdentity({
                projectId: 'project-1',
                chatType: 'tasks',
                objectId: 'task-1',
                commentId: 'comment-1',
                creatorId: 'user-1',
            })
        ).toEqual({
            projectId: 'project-1',
            chatType: 'tasks',
            objectId: 'task-1',
            commentId: 'comment-1',
            creatorId: 'user-1',
        })
    })

    it('keeps a quick-topic notification bound to the topics comment path', () => {
        expect(
            buildCommentNotificationIdentity({
                projectId: 'project-1',
                chatType: 'topics',
                objectId: 'topic-1',
                commentId: 'comment-1',
                creatorId: 'user-1',
            })
        ).toEqual({
            projectId: 'project-1',
            chatType: 'topics',
            objectId: 'topic-1',
            commentId: 'comment-1',
            creatorId: 'user-1',
        })
    })
})
