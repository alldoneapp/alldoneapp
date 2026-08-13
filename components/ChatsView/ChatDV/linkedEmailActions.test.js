import {
    archiveAndMarkReadLinkedEmails,
    getLinkedEmailFromMessage,
    getLinkedEmailsFromMessages,
    getNewEmailCommentIds,
    groupLinkedEmailsByConnection,
} from './linkedEmailActions'
import { performEmailLineAction } from '../../../utils/backends/EmailLine/emailLineBackend'
import { markAlldoneChatsReadForLinkedEmails } from '../../../utils/backends/Chats/markChatCommentsAsRead'

jest.mock('../../../utils/backends/EmailLine/emailLineBackend', () => ({ performEmailLineAction: jest.fn() }))
jest.mock('../../../utils/backends/Chats/markChatCommentsAsRead', () => ({
    markAlldoneChatsReadForLinkedEmails: jest.fn(),
}))

describe('linkedEmailActions', () => {
    test('reads the connection and message ids stored on a Gmail follow-up comment', () => {
        expect(
            getLinkedEmailFromMessage({
                gmailData: { connectionProjectId: 'connection-1', messageId: 'message-1' },
            })
        ).toEqual({
            key: 'connection-1:message-1',
            connectionProjectId: 'connection-1',
            messageId: 'message-1',
        })
    })

    test('keeps the Alldone chat comment so archive can mark that chat as read', () => {
        expect(
            getLinkedEmailFromMessage(
                {
                    id: 'comment-1',
                    gmailData: { connectionProjectId: 'connection-1', messageId: 'message-1' },
                },
                { projectId: 'project-1', chatId: 'chat-1' }
            )
        ).toEqual({
            key: 'connection-1:message-1',
            connectionProjectId: 'connection-1',
            messageId: 'message-1',
            commentId: 'comment-1',
            projectId: 'project-1',
            chatId: 'chat-1',
            commentRefs: [{ projectId: 'project-1', chatId: 'chat-1', commentId: 'comment-1' }],
        })
    })

    test('supports the projectId fallback and ignores incomplete links', () => {
        expect(
            getLinkedEmailFromMessage({
                gmailData: {
                    connectionId: 'email_google_123',
                    connectionProjectId: 'project-1',
                    messageId: 'message-1',
                },
            })
        ).toEqual({
            key: 'email_google_123:message-1',
            connectionProjectId: 'email_google_123',
            messageId: 'message-1',
        })
        expect(getLinkedEmailFromMessage({ gmailData: { projectId: 'project-1', messageId: 'message-1' } })).toEqual({
            key: 'project-1:message-1',
            connectionProjectId: 'project-1',
            messageId: 'message-1',
        })
        expect(getLinkedEmailFromMessage({ gmailData: { messageId: 'message-1' } })).toBeNull()
    })

    test('derives the account key for comments created before connection ids were stored', () => {
        expect(
            getLinkedEmailFromMessage({
                gmailData: { gmailEmail: 'Karsten@Example.com', messageId: 'message-1' },
            })
        ).toEqual({
            key: 'email_google_7bd0f1c0:message-1',
            connectionProjectId: 'email_google_7bd0f1c0',
            messageId: 'message-1',
        })
    })

    test('deduplicates mailbox archive calls and keeps every matching chat comment', () => {
        const linkedEmails = getLinkedEmailsFromMessages(
            [
                { id: 'comment-1', gmailData: { projectId: 'project-1', messageId: 'message-1' } },
                { id: 'comment-1', gmailData: { projectId: 'project-1', messageId: 'message-1' } },
                { id: 'comment-2', gmailData: { projectId: 'project-1', messageId: 'message-2' } },
                { id: 'comment-3', gmailData: { projectId: 'project-2', messageId: 'message-3' } },
            ],
            { projectId: 'chat-project', chatId: 'chat-1' }
        )

        expect(linkedEmails).toHaveLength(3)
        expect(groupLinkedEmailsByConnection(linkedEmails)).toEqual({
            'project-1': ['message-1', 'message-2'],
            'project-2': ['message-3'],
        })
        expect(linkedEmails[0].commentRefs).toEqual([
            { projectId: 'chat-project', chatId: 'chat-1', commentId: 'comment-1' },
        ])
    })

    test('selects unique grey notification IDs as new email comment candidates', () => {
        expect(
            getNewEmailCommentIds({
                followedCommentIds: ['actionable-comment'],
                unfollowedCommentIds: ['email-1', '', 'email-2', 'email-1'],
            })
        ).toEqual(['email-1', 'email-2'])
        expect(getNewEmailCommentIds()).toEqual([])
    })
})

describe('archiveAndMarkReadLinkedEmails', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        performEmailLineAction.mockResolvedValue({})
        markAlldoneChatsReadForLinkedEmails.mockResolvedValue()
    })

    test('archives the mailbox emails and marks the Alldone chats as read', async () => {
        const linkedEmails = [
            { connectionProjectId: 'connection-1', messageId: 'message-1', projectId: 'p1', commentId: 'c1' },
            { connectionProjectId: 'connection-1', messageId: 'message-2' },
            { connectionProjectId: 'connection-2', messageId: 'message-3' },
        ]

        await archiveAndMarkReadLinkedEmails(linkedEmails)

        expect(performEmailLineAction).toHaveBeenCalledTimes(2)
        expect(performEmailLineAction).toHaveBeenCalledWith('connection-1', {
            action: 'archive',
            messageIds: ['message-1', 'message-2'],
        })
        expect(performEmailLineAction).toHaveBeenCalledWith('connection-2', {
            action: 'archive',
            messageIds: ['message-3'],
        })
        expect(performEmailLineAction).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ action: 'markRead' })
        )
        expect(markAlldoneChatsReadForLinkedEmails).toHaveBeenCalledWith(linkedEmails)
    })

    test('does not mark Alldone chats as read when mailbox archive fails', async () => {
        performEmailLineAction.mockRejectedValueOnce(new Error('offline'))

        await expect(
            archiveAndMarkReadLinkedEmails([{ connectionProjectId: 'connection-1', messageId: 'message-1' }])
        ).rejects.toThrow('offline')

        expect(performEmailLineAction).toHaveBeenCalledTimes(1)
        expect(markAlldoneChatsReadForLinkedEmails).not.toHaveBeenCalled()
    })

    test('ignores empty or incomplete links', async () => {
        await archiveAndMarkReadLinkedEmails([])
        await archiveAndMarkReadLinkedEmails([{ connectionProjectId: 'connection-1' }])
        expect(performEmailLineAction).not.toHaveBeenCalled()
        expect(markAlldoneChatsReadForLinkedEmails).not.toHaveBeenCalled()
    })
})
