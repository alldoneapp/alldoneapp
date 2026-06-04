'use strict'

const mockSendTransacEmail = jest.fn().mockResolvedValue({})

jest.mock('sib-api-v3-sdk', () => ({
    ApiClient: {
        instance: {
            authentications: {
                'api-key': {},
            },
        },
    },
    TransactionalEmailsApi: jest.fn(() => ({
        sendTransacEmail: mockSendTransacEmail,
    })),
}))

jest.mock('../envFunctionsHelper', () => ({
    getEnvFunctions: jest.fn(() => ({ SIB_API_KEY: 'test-key' })),
}))

const { sendAnnaEmailReply } = require('./emailReplyService')

describe('emailReplyService', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('sends normalized To and CC recipient lists', async () => {
        await sendAnnaEmailReply({
            toEmails: ['Owner@Example.com', 'teammate@example.com'],
            ccEmails: ['observer@example.com', 'owner@example.com'],
            subject: 'Re: Meeting',
            replyText: 'Three options follow.',
            fromEmail: 'anna@alldoneapp.com',
        })

        expect(mockSendTransacEmail).toHaveBeenCalledWith(
            expect.objectContaining({
                to: [{ email: 'owner@example.com' }, { email: 'teammate@example.com' }],
                cc: [{ email: 'observer@example.com' }],
                htmlContent: expect.stringContaining('Anna Alldone'),
            })
        )
        const htmlContent = mockSendTransacEmail.mock.calls[0][0].htmlContent
        expect(htmlContent).toContain('AI Chief of Staff')
        expect(htmlContent).toContain('<a href="https://alldone.app/"')
        expect(htmlContent).toContain('https://alldone.app/</a>')
        expect(htmlContent).toContain('Three options follow.')
    })

    test('escapes assistant reply text while keeping the fixed signature link intact', async () => {
        await sendAnnaEmailReply({
            toEmail: 'owner@example.com',
            subject: 'Re: Test',
            replyText: '<script>alert("x")</script>\nDone',
        })

        const htmlContent = mockSendTransacEmail.mock.calls[0][0].htmlContent
        expect(htmlContent).not.toContain('<script>')
        expect(htmlContent).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;<br />Done')
        expect(htmlContent).toContain('<a href="https://alldone.app/"')
    })
})
