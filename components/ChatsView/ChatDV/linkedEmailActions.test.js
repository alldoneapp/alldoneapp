import {
    archiveAndMarkReadLinkedEmails,
    getLinkedEmailFromMessage,
    getLinkedEmailsFromMessages,
    getNewEmailCommentIds,
    groupLinkedEmailsByConnection,
} from './linkedEmailActions'
import { performEmailLineAction } from '../../../utils/backends/EmailLine/emailLineBackend'
import { clearChatCommentsForLinkedEmails } from '../../../utils/backends/Chats/markChatCommentsAsRead'

jest.mock('../../../utils/backends/EmailLine/emailLineBackend', () => ({ performEmailLineAction: jest.fn() }))
jest.mock('../../../utils/backends/Chats/markChatCommentsAsRead', () => ({
    clearChatCommentsForLinkedEmails: jest.fn(),
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

    test('carries the read-sync context of an auto-archived or outgoing email (AT-2376)', () => {
        // Both mean the email was never in the user's inbox, so "not in the inbox" must not read
        // as the user having handled it.
        expect(
            getLinkedEmailFromMessage({
                gmailData: {
                    connectionProjectId: 'connection-1',
                    messageId: 'message-1',
                    archivedByLabeling: true,
                    direction: 'outgoing',
                },
            })
        ).toMatchObject({ archivedByLabeling: true, direction: 'outgoing' })

        // An ordinary inbox email carries neither, so nothing changes for it.
        expect(
            getLinkedEmailFromMessage({
                gmailData: { connectionProjectId: 'connection-1', messageId: 'message-1', archivedByLabeling: false },
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
    // Order matters more than anything else in this block (AT-2424), so every call both sides make
    // is recorded onto one timeline.
    let calls
    let restoreUnreadState

    beforeEach(() => {
        jest.clearAllMocks()
        calls = []
        restoreUnreadState = jest.fn(async () => calls.push('restore'))
        performEmailLineAction.mockImplementation(async () => {
            calls.push('mailbox')
            return {}
        })
        clearChatCommentsForLinkedEmails.mockImplementation(async () => {
            calls.push('clear-unread')
            return restoreUnreadState
        })
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
        expect(clearChatCommentsForLinkedEmails).toHaveBeenCalledWith(linkedEmails)
    })

    // The regression this whole change exists for. Clearing the unread state used to be the LAST
    // step, behind an archive callable (~1s) that itself awaits a forced email-line summary
    // refresh (3-7s in production) - so the email comment sat there, unread, for 4-8 seconds
    // after the press.
    test('clears the unread state before it touches the mailbox (AT-2424)', async () => {
        await archiveAndMarkReadLinkedEmails([{ connectionProjectId: 'connection-1', messageId: 'message-1' }])

        expect(calls).toEqual(['clear-unread', 'mailbox'])
    })

    test('does not wait for the mailbox before clearing the unread state (AT-2424)', async () => {
        // A mailbox call that never settles stands in for the slow one. The unread state must
        // already be gone by then, which is exactly what the user is waiting to see.
        performEmailLineAction.mockImplementation(() => {
            calls.push('mailbox')
            return new Promise(() => {})
        })

        archiveAndMarkReadLinkedEmails([{ connectionProjectId: 'connection-1', messageId: 'message-1' }])
        await Promise.resolve()
        await Promise.resolve()

        expect(clearChatCommentsForLinkedEmails).toHaveBeenCalledTimes(1)
        expect(calls).toEqual(['clear-unread', 'mailbox'])
    })

    test('puts the unread state back when the mailbox archive fails, and still reports the failure', async () => {
        performEmailLineAction.mockRejectedValueOnce(new Error('offline'))

        await expect(
            archiveAndMarkReadLinkedEmails([{ connectionProjectId: 'connection-1', messageId: 'message-1' }])
        ).rejects.toThrow('offline')

        expect(performEmailLineAction).toHaveBeenCalledTimes(1)
        // Cleared optimistically, then restored: a failed archive reads as "nothing happened,
        // try again" rather than a comment that went read while the mail is still in the inbox.
        expect(restoreUnreadState).toHaveBeenCalledTimes(1)
        expect(calls).toEqual(['clear-unread', 'restore'])
    })

    test('keeps the unread state cleared when the mailbox archive succeeds', async () => {
        await archiveAndMarkReadLinkedEmails([{ connectionProjectId: 'connection-1', messageId: 'message-1' }])

        expect(restoreUnreadState).not.toHaveBeenCalled()
    })

    test('ignores empty or incomplete links', async () => {
        await archiveAndMarkReadLinkedEmails([])
        await archiveAndMarkReadLinkedEmails([{ connectionProjectId: 'connection-1' }])
        expect(performEmailLineAction).not.toHaveBeenCalled()
        expect(clearChatCommentsForLinkedEmails).not.toHaveBeenCalled()
    })
})
