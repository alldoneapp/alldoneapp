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
            })
        )
    })
})
