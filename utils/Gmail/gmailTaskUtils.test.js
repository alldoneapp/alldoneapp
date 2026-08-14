import { getEmailTaskArchiveData, getGmailTaskWebUrl, isEmailLinkedTask } from './gmailTaskUtils'

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

describe('Gmail task links', () => {
    const gmailData = {
        gmailEmail: 'person@example.com',
        messageId: 'message-1',
    }
    const directMessageUrl = 'https://mail.google.com/mail/u/0/?authuser=person%40example.com#all/message-1'

    test('uses a direct HTTPS Gmail message link on Android', () => {
        expect(
            getGmailTaskWebUrl(gmailData, {
                platform: 'web',
                userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile',
            })
        ).toBe(directMessageUrl)
    })

    test('uses a direct HTTPS Gmail message link on iOS', () => {
        expect(
            getGmailTaskWebUrl(gmailData, {
                platform: 'web',
                userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile',
            })
        ).toBe(directMessageUrl)
    })

    test('keeps the account chooser on non-mobile browsers', () => {
        expect(
            getGmailTaskWebUrl(gmailData, {
                platform: 'web',
                userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126',
            })
        ).toBe(
            'https://accounts.google.com/AccountChooser?Email=person%40example.com&continue=https%3A%2F%2Fmail.google.com%2Fmail%2Fu%2F0%2F%3Fauthuser%3Dperson%2540example.com%23all%2Fmessage-1&service=mail'
        )
    })

    test('unwraps stored account-chooser links on mobile and preserves authuser', () => {
        expect(
            getGmailTaskWebUrl(
                {
                    gmailEmail: 'person@example.com',
                    webUrl: 'https://accounts.google.com/AccountChooser?Email=person%40example.com&continue=https%3A%2F%2Fmail.google.com%2Fmail%2Fu%2F0%2F%23inbox&service=mail',
                },
                { platform: 'ios' }
            )
        ).toBe('https://mail.google.com/mail/u/0/?authuser=person%40example.com#inbox')
    })
})
