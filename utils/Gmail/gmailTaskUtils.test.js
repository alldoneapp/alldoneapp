import { getEmailTaskArchiveData, isEmailLinkedTask } from './gmailTaskUtils'

describe('email task archive data', () => {
    test('resolves the connection and all linked message ids from an email task', () => {
        const task = {
            gmailData: {
                connectionId: 'email_google_12345678',
                messageId: 'message-1',
                messageIds: ['message-1', 'message-2', ''],
            },
        }

        expect(getEmailTaskArchiveData(task)).toEqual({
            connectionProjectId: 'email_google_12345678',
            messageIds: ['message-1', 'message-2'],
        })
        expect(isEmailLinkedTask(task)).toBe(true)
    })

    test('does not treat a regular task or an inbox summary as a linked email task', () => {
        expect(getEmailTaskArchiveData({ name: 'Regular task' })).toBeNull()
        expect(getEmailTaskArchiveData({ gmailData: { gmailEmail: 'me@example.com', unreadMails: 3 } })).toBeNull()
        expect(isEmailLinkedTask({ name: 'Regular task' })).toBe(false)
    })

    test('builds a provider connection id for legacy linked email data', () => {
        const data = getEmailTaskArchiveData({
            gmailData: { provider: 'microsoft', email: 'Me@Example.com', messageId: 'message-1' },
        })

        expect(data.connectionProjectId).toMatch(/^email_microsoft_[0-9a-f]{8}$/)
        expect(data.messageIds).toEqual(['message-1'])
    })
})
