import {
    collectUnreadCommentRefs,
    getCommentRefsFromLinkedEmails,
    markAlldoneChatsReadForLinkedEmails,
    markChatCommentsAsRead,
    markChatCommentsAsReadByMessageIds,
} from './markChatCommentsAsRead'
import { getDb } from '../firestore'
import store from '../../../redux/store'

jest.mock('../firestore', () => ({ getDb: jest.fn() }))
jest.mock('../../../redux/store', () => ({ __esModule: true, default: { getState: jest.fn() } }))

const deletedPaths = []
const commentDocs = {}

const createDb = () => {
    const batch = {
        delete: jest.fn(ref => {
            deletedPaths.push(ref.path)
        }),
        commit: jest.fn().mockResolvedValue(),
        set: jest.fn(),
        update: jest.fn(),
    }

    return {
        batch: jest.fn(() => batch),
        doc: jest.fn(path => ({
            path,
            get: jest.fn().mockResolvedValue({
                data: () => commentDocs[path] || null,
            }),
        })),
    }
}

describe('markChatCommentsAsRead', () => {
    beforeEach(() => {
        deletedPaths.length = 0
        Object.keys(commentDocs).forEach(key => delete commentDocs[key])
        getDb.mockReturnValue(createDb())
        store.getState.mockReturnValue({
            loggedUser: { uid: 'user-1' },
            projectChatNotifications: {},
        })
    })

    it('collects unique comment refs from linked emails', () => {
        expect(
            getCommentRefsFromLinkedEmails([
                { projectId: 'p1', commentId: 'c1', chatId: 'chat-1' },
                { projectId: 'p1', commentId: 'c1' },
                { commentRefs: [{ projectId: 'p2', commentId: 'c2', chatId: 'chat-2' }] },
                { messageId: 'm1' },
            ])
        ).toEqual([
            { projectId: 'p1', chatId: 'chat-1', commentId: 'c1' },
            { projectId: 'p2', chatId: 'chat-2', commentId: 'c2' },
        ])
    })

    it('reads unread comment refs from the chat notification store', () => {
        expect(
            collectUnreadCommentRefs({
                'project-1': {
                    totalFollowed: 1,
                    totalUnfollowed: 1,
                    'chat-1': {
                        followedCommentIds: ['followed-1'],
                        unfollowedCommentIds: ['email-1', ''],
                    },
                },
                'project-2': {
                    'chat-2': {
                        unfollowedCommentIds: ['email-2'],
                    },
                },
            })
        ).toEqual([
            { projectId: 'project-1', chatId: 'chat-1', commentId: 'followed-1' },
            { projectId: 'project-1', chatId: 'chat-1', commentId: 'email-1' },
            { projectId: 'project-2', chatId: 'chat-2', commentId: 'email-2' },
        ])
    })

    it('deletes the Alldone chat notification docs for those comments', async () => {
        await markChatCommentsAsRead([
            { projectId: 'project-1', commentId: 'comment-1' },
            { projectId: 'project-1', commentId: 'comment-1' },
            { projectId: 'project-2', commentId: 'comment-2' },
        ])

        expect(deletedPaths).toEqual([
            'chatNotifications/project-1/user-1/comment-1',
            'chatNotifications/project-2/user-1/comment-2',
        ])
    })

    it('does nothing without a logged-in user or comment ids', async () => {
        store.getState.mockReturnValue({ loggedUser: {}, projectChatNotifications: {} })
        await markChatCommentsAsRead([{ projectId: 'project-1', commentId: 'comment-1' }])
        expect(deletedPaths).toEqual([])

        store.getState.mockReturnValue({ loggedUser: { uid: 'user-1' }, projectChatNotifications: {} })
        await markChatCommentsAsRead([])
        expect(deletedPaths).toEqual([])
    })

    it('marks matching unread email comments as read by Gmail message id', async () => {
        store.getState.mockReturnValue({
            loggedUser: { uid: 'user-1' },
            projectChatNotifications: {
                'project-1': {
                    'chat-1': { unfollowedCommentIds: ['gmail-1'] },
                    'chat-2': { unfollowedCommentIds: ['gmail-2'] },
                },
            },
        })
        commentDocs['chatComments/project-1/topics/chat-1/comments/gmail-1'] = {
            gmailData: { messageId: 'message-1' },
        }
        commentDocs['chatComments/project-1/topics/chat-2/comments/gmail-2'] = {
            gmailData: { messageId: 'message-2' },
        }

        await markChatCommentsAsReadByMessageIds(['message-1'])

        expect(deletedPaths).toEqual(['chatNotifications/project-1/user-1/gmail-1'])
    })

    it('uses known comment refs and only looks up emails that lack them', async () => {
        store.getState.mockReturnValue({
            loggedUser: { uid: 'user-1' },
            projectChatNotifications: {
                'project-2': {
                    'chat-9': { unfollowedCommentIds: ['gmail-9'] },
                },
            },
        })
        commentDocs['chatComments/project-2/topics/chat-9/comments/gmail-9'] = {
            gmailData: { messageId: 'message-9' },
        }

        await markAlldoneChatsReadForLinkedEmails([
            { projectId: 'project-1', commentId: 'comment-1', messageId: 'message-1' },
            { messageId: 'message-9' },
        ])

        expect(deletedPaths).toEqual([
            'chatNotifications/project-1/user-1/comment-1',
            'chatNotifications/project-2/user-1/gmail-9',
        ])
    })
})
