import {
    archiveAndMarkReadLinkedEmails,
    getLinkedEmailFromMessage,
    getLinkedEmailsFromMessages,
    getNewEmailCommentIds,
    groupLinkedEmailsByConnection,
} from './linkedEmailActions'
import { performEmailLineAction } from '../../../utils/backends/EmailLine/emailLineBackend'

jest.mock('../../../utils/backends/EmailLine/emailLineBackend', () => ({ performEmailLineAction: jest.fn() }))

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

    test('deduplicates links and groups archive calls by connected account', () => {
        const linkedEmails = getLinkedEmailsFromMessages([
            { gmailData: { projectId: 'project-1', messageId: 'message-1' } },
            { gmailData: { projectId: 'project-1', messageId: 'message-1' } },
            { gmailData: { projectId: 'project-1', messageId: 'message-2' } },
            { gmailData: { projectId: 'project-2', messageId: 'message-3' } },
        ])

        expect(linkedEmails).toHaveLength(3)
        expect(groupLinkedEmailsByConnection(linkedEmails)).toEqual({
            'project-1': ['message-1', 'message-2'],
            'project-2': ['message-3'],
        })
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
    })

    test('archives then marks the same messages as read, grouped by account', async () => {
        await archiveAndMarkReadLinkedEmails([
            { connectionProjectId: 'connection-1', messageId: 'message-1' },
            { connectionProjectId: 'connection-1', messageId: 'message-2' },
            { connectionProjectId: 'connection-2', messageId: 'message-3' },
        ])

        expect(performEmailLineAction).toHaveBeenCalledTimes(4)
        expect(performEmailLineAction).toHaveBeenCalledWith('connection-1', {
            action: 'archive',
            messageIds: ['message-1', 'message-2'],
        })
        expect(performEmailLineAction).toHaveBeenCalledWith('connection-1', {
            action: 'markRead',
            messageIds: ['message-1', 'message-2'],
        })
        expect(performEmailLineAction).toHaveBeenCalledWith('connection-2', {
            action: 'archive',
            messageIds: ['message-3'],
        })
        expect(performEmailLineAction).toHaveBeenCalledWith('connection-2', {
            action: 'markRead',
            messageIds: ['message-3'],
        })
        const connection1Calls = performEmailLineAction.mock.calls
            .filter(([connectionProjectId]) => connectionProjectId === 'connection-1')
            .map(([, payload]) => payload.action)
        expect(connection1Calls).toEqual(['archive', 'markRead'])
    })

    test('does not mark as read when archive fails', async () => {
        performEmailLineAction.mockRejectedValueOnce(new Error('offline'))

        await expect(
            archiveAndMarkReadLinkedEmails([{ connectionProjectId: 'connection-1', messageId: 'message-1' }])
        ).rejects.toThrow('offline')

        expect(performEmailLineAction).toHaveBeenCalledTimes(1)
        expect(performEmailLineAction).toHaveBeenCalledWith('connection-1', {
            action: 'archive',
            messageIds: ['message-1'],
        })
    })

    test('ignores empty or incomplete links', async () => {
        await archiveAndMarkReadLinkedEmails([])
        await archiveAndMarkReadLinkedEmails([{ connectionProjectId: 'connection-1' }])
        expect(performEmailLineAction).not.toHaveBeenCalled()
    })
})
