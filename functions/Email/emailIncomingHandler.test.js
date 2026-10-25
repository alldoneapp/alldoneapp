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
    SENDER_STATUS_AMBIGUOUS: 'ambiguous',
    SENDER_STATUS_MATCHED: 'matched',
    SENDER_STATUS_UNKNOWN: 'unknown',
    resolveEmailSenderIdentity: jest.fn().mockResolvedValue({ status: 'unknown', user: null, candidates: [] }),
    getDefaultAssistantIdForUser: jest.fn(),
}))

jest.mock('./emailGuestMeetingGrant', () => ({
    tryHandleGuestMeetingReply: jest.fn().mockResolvedValue({ matched: false }),
}))

const admin = require('firebase-admin')
const { sendAnnaEmailReply } = require('./emailReplyService')
const { resolveEmailSenderIdentity } = require('./emailUserRouting')
const { tryHandleGuestMeetingReply } = require('./emailGuestMeetingGrant')
const { handleIncomingAnnaEmail } = require('./emailIncomingHandler')

describe('emailIncomingHandler authorization', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        resolveEmailSenderIdentity.mockResolvedValue({ status: 'unknown', user: null, candidates: [] })
        admin.firestore.mockReturnValue({ doc: jest.fn(() => ({ set: jest.fn().mockResolvedValue(undefined) })) })
        tryHandleGuestMeetingReply.mockResolvedValue({ matched: false })
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

        expect(resolveEmailSenderIdentity).toHaveBeenCalledWith('outsider@example.com')
        expect(sendAnnaEmailReply).toHaveBeenCalledWith(
            expect.objectContaining({
                toEmail: 'outsider@example.com',
            })
        )
        expect(sendAnnaEmailReply.mock.calls[0][0].toEmails).toBeUndefined()
        expect(res.json).toHaveBeenCalledWith({ ok: true, status: 'unknown_sender' })
    })

    test('does not execute email requests when the matched user has not enabled assistant email', async () => {
        resolveEmailSenderIdentity.mockResolvedValue({
            status: 'matched',
            user: { uid: 'user-1', assistantEmailEnabled: false },
            candidates: [],
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

    // The reply used to blame verification for an ambiguity, and the early return wrote no
    // audit record at all — so a sender that could not be routed left no trace anywhere.
    test('tells an ambiguous sender the truth and records why (AT-2483)', async () => {
        const auditSet = jest.fn().mockResolvedValue(undefined)
        admin.firestore.mockReturnValue({ doc: jest.fn(() => ({ set: auditSet })) })
        resolveEmailSenderIdentity.mockResolvedValue({
            status: 'ambiguous',
            user: null,
            candidates: [
                { userId: 'user-main', primaryVerified: false, connectedMailbox: true, rank: 2 },
                { userId: 'user-new', primaryVerified: true, connectedMailbox: false, rank: 3 },
            ],
        })

        const req = {
            method: 'POST',
            headers: { authorization: 'Bearer secret' },
            body: {
                messageId: 'msg-ambiguous',
                fromEmail: 'shared@example.com',
                toEmails: ['anna@alldoneapp.com'],
                subject: 'Fwd: invoice',
                textBody: 'Please file this',
            },
        }
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
            send: jest.fn().mockReturnThis(),
        }

        await handleIncomingAnnaEmail(req, res)

        expect(res.json).toHaveBeenCalledWith({ ok: true, status: 'ambiguous_sender' })
        expect(sendAnnaEmailReply.mock.calls[0][0].replyText).toContain('more than one Alldone account')
        expect(sendAnnaEmailReply.mock.calls[0][0].replyText).not.toContain("couldn't match")
        expect(auditSet).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'ambiguous_sender',
                fromEmail: 'shared@example.com',
                senderCandidates: expect.arrayContaining([expect.objectContaining({ userId: 'user-main' })]),
            }),
            { merge: true }
        )
    })

    test('records an unknown sender in the audit trail as well', async () => {
        const auditSet = jest.fn().mockResolvedValue(undefined)
        admin.firestore.mockReturnValue({ doc: jest.fn(() => ({ set: auditSet })) })

        const req = {
            method: 'POST',
            headers: { authorization: 'Bearer secret' },
            body: {
                messageId: 'msg-unknown',
                fromEmail: 'stranger@example.com',
                subject: 'Hello',
                textBody: 'Hi',
            },
        }
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
            send: jest.fn().mockReturnThis(),
        }

        await handleIncomingAnnaEmail(req, res)

        expect(res.json).toHaveBeenCalledWith({ ok: true, status: 'unknown_sender' })
        expect(auditSet).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'unknown_sender', fromEmail: 'stranger@example.com' }),
            { merge: true }
        )
    })

    test('uses an exact scoped guest meeting grant before ordinary account routing', async () => {
        tryHandleGuestMeetingReply.mockResolvedValue({
            matched: true,
            status: 'guest_meeting_booked',
            ownerUserId: 'owner-1',
            grantId: 'grant-1',
        })
        const auditSet = jest.fn().mockResolvedValue(undefined)
        admin.firestore.mockReturnValue({
            doc: jest.fn(() => ({ set: auditSet })),
        })
        const req = {
            method: 'POST',
            headers: {
                authorization: 'Bearer secret',
            },
            body: {
                messageId: 'msg-guest-reply',
                fromEmail: 'guest@example.com',
                toEmails: ['anna@alldoneapp.com', 'owner@example.com'],
                subject: 'Re: Meeting',
                textBody: 'Friday at 09:00 works.',
                threadHeaders: {
                    inReplyTo: '<anna-options-1@brevo.example>',
                },
            },
        }
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
            send: jest.fn().mockReturnThis(),
        }

        await handleIncomingAnnaEmail(req, res)

        expect(tryHandleGuestMeetingReply).toHaveBeenCalledWith(
            expect.objectContaining({
                fromEmail: 'guest@example.com',
                threadHeaders: expect.objectContaining({
                    inReplyTo: '<anna-options-1@brevo.example>',
                }),
            })
        )
        expect(resolveEmailSenderIdentity).not.toHaveBeenCalled()
        expect(sendAnnaEmailReply).not.toHaveBeenCalled()
        expect(res.json).toHaveBeenCalledWith({ ok: true, status: 'guest_meeting_booked' })
        expect(auditSet).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'guest_meeting_booked',
                userId: 'owner-1',
                fromEmail: 'guest@example.com',
                guestMeetingGrantId: 'grant-1',
            }),
            { merge: true }
        )
    })
})
