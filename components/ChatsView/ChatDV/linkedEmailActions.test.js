import {
    getLinkedEmailFromMessage,
    getLinkedEmailsFromMessages,
    groupLinkedEmailsByConnection,
} from './linkedEmailActions'

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
})
