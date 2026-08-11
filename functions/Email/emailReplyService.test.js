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

    test('sends normalized To and CC recipient lists with the default signature', async () => {
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

    test('escapes assistant reply text while keeping the default signature link intact', async () => {
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

    test('renders a custom multiline signature with escaped text and linked URLs', async () => {
        await sendAnnaEmailReply({
            toEmail: 'owner@example.com',
            subject: 'Re: Test',
            replyText: 'Done',
            emailSignature: 'Best,\nCustom <Assistant>\nhttps://example.com/path?x=1&y=2',
        })

        const htmlContent = mockSendTransacEmail.mock.calls[0][0].htmlContent
        expect(htmlContent).toContain('<div>Best,</div>')
        expect(htmlContent).toContain('<div>Custom &lt;Assistant&gt;</div>')
        expect(htmlContent).toContain(
            '<a href="https://example.com/path?x=1&amp;y=2" style="color: #1a73e8;">https://example.com/path?x=1&amp;y=2</a>'
        )
        expect(htmlContent).not.toContain('Anna Alldone')
    })

    test('omits the signature when the assistant signature is intentionally empty', async () => {
        await sendAnnaEmailReply({
            toEmail: 'owner@example.com',
            subject: 'Re: Test',
            replyText: 'Done',
            emailSignature: '',
        })

        const htmlContent = mockSendTransacEmail.mock.calls[0][0].htmlContent
        expect(htmlContent).toContain('Done')
        expect(htmlContent).not.toContain('Anna Alldone')
        expect(htmlContent).not.toContain('AI Chief of Staff')
        expect(htmlContent).not.toContain('margin-top: 24px; color: #5f6368;')
    })
})
