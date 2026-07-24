'use strict'

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(),
    storage: jest.fn(),
}))

jest.mock('../envFunctionsHelper', () => ({
    getEnvFunctions: jest.fn(() => ({
        ANNA_EMAIL_WEBHOOK_BEARER_TOKEN: 'secret',
        ANNA_EMAIL_PUBLIC_ADDRESS: 'anna@alldoneapp.com',
    })),
}))

jest.mock('./emailReplyService', () => ({
    sendAnnaEmailReply: jest.fn().mockResolvedValue({ success: true }),
}))

jest.mock('./emailUserRouting', () => ({
    findVerifiedUserByEmailIdentity: jest.fn().mockResolvedValue(null),
    getDefaultAssistantIdForUser: jest.fn(),
}))

const { sendAnnaEmailReply } = require('./emailReplyService')
const { findVerifiedUserByEmailIdentity } = require('./emailUserRouting')
const { handleIncomingAnnaEmail } = require('./emailIncomingHandler')

describe('emailIncomingHandler authorization', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        findVerifiedUserByEmailIdentity.mockResolvedValue(null)
    })

    test('authorizes only the From sender, never whitelisted-looking To or CC recipients', async () => {
        const req = {
            method: 'POST',
            headers: {
                authorization: 'Bearer secret',
            },
            body: {
                messageId: 'msg-untrusted',
                fromEmail: 'outsider@example.com',
                toEmails: ['anna@alldoneapp.com', 'verified-user@example.com'],
                ccEmails: ['another-verified-user@example.com'],
                subject: 'Please run tools',
                textBody: 'Create a private task',
            },
        }
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
            send: jest.fn().mockReturnThis(),
        }

        await handleIncomingAnnaEmail(req, res)

        expect(findVerifiedUserByEmailIdentity).toHaveBeenCalledWith('outsider@example.com')
        expect(sendAnnaEmailReply).toHaveBeenCalledWith(
            expect.objectContaining({
                toEmail: 'outsider@example.com',
            })
        )
        expect(sendAnnaEmailReply.mock.calls[0][0].toEmails).toBeUndefined()
        expect(res.json).toHaveBeenCalledWith({ ok: true, status: 'unknown_sender' })
    })

    test('does not execute email requests when the matched user has not enabled assistant email', async () => {
        findVerifiedUserByEmailIdentity.mockResolvedValue({
            uid: 'user-1',
            assistantEmailEnabled: false,
        })
        const req = {
            method: 'POST',
            headers: {
                authorization: 'Bearer secret',
            },
            body: {
                messageId: 'msg-disabled',
                fromEmail: 'verified-user@example.com',
                toEmails: ['anna@alldoneapp.com', 'teammate@example.com'],
                subject: 'Please run tools',
                textBody: 'Create a private task',
            },
        }
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
            send: jest.fn().mockReturnThis(),
        }

        await handleIncomingAnnaEmail(req, res)

        expect(sendAnnaEmailReply).toHaveBeenCalledWith(
            expect.objectContaining({
                toEmail: 'verified-user@example.com',
            })
        )
        expect(sendAnnaEmailReply.mock.calls[0][0].toEmails).toBeUndefined()
        expect(res.json).toHaveBeenCalledWith({ ok: true, status: 'email_disabled', userId: 'user-1' })
    })
})
