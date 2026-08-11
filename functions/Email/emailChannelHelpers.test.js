'use strict'

const {
    buildDailyEmailParticipantEmails,
    buildDailyEmailParticipantKey,
    buildDailyEmailTitle,
    buildEmailCommentText,
    buildQuotedReplyContext,
    buildCurrentEmailParticipants,
    buildParticipantScopedDailyEmailTitle,
    buildReplyAllRecipients,
    computeWebhookSignature,
    getEmailParticipantDisplayName,
    getEmailSafeAllowedTools,
    looksLikeForwardedEmail,
    normalizeEmailAddress,
    normalizeEmailAddressList,
    normalizeSafeEmailActionContext,
    parseEmailHeaderAddresses,
    pickActionableAttachment,
    splitQuotedReplyText,
    stripHtmlToText,
    trimQuotedReplyText,
    verifyInboundEmailSignature,
} = require('./emailChannelHelpers')
const { normalizeInboundEmailPayload } = require('./emailIncomingHandler')

describe('emailChannelHelpers', () => {
    test('normalizes email addresses', () => {
        expect(normalizeEmailAddress('  User@Example.COM ')).toBe('user@example.com')
    })

    test('parses display names from email header entries', () => {
        expect(parseEmailHeaderAddresses('"Eva-Maria Würz" <Eva-Maria.Wuerz@jtl-software.com>')).toEqual([
            {
                raw: '"Eva-Maria Würz" <Eva-Maria.Wuerz@jtl-software.com>',
                email: 'eva-maria.wuerz@jtl-software.com',
                displayName: 'Eva-Maria Würz',
            },
        ])
    })

    test('keeps commas inside quoted display names when splitting email headers', () => {
        expect(
            parseEmailHeaderAddresses('"Krause, Steffen" <steffen@example.com>, "Eva-Maria Würz" <eva@example.com>')
        ).toEqual([
            {
                raw: '"Krause, Steffen" <steffen@example.com>',
                email: 'steffen@example.com',
                displayName: 'Krause, Steffen',
            },
            {
                raw: '"Eva-Maria Würz" <eva@example.com>',
                email: 'eva@example.com',
                displayName: 'Eva-Maria Würz',
            },
        ])
    })

    test('limits email-safe tools to the approved action-only email set', () => {
        expect(
            getEmailSafeAllowedTools([
                'create_task',
                'find_calendar_availability',
                'create_calendar_event',
                'create_note',
                'update_note',
                'create_gmail_draft',
                'create_gmail_reply_draft',
                'search',
                'external_tools',
                'talk_to_assistant',
                'update_task',
                'search_calendar_events',
            ])
        ).toEqual([
            'create_task',
            'find_calendar_availability',
            'create_calendar_event',
            'create_note',
            'update_note',
            'create_gmail_draft',
            'create_gmail_reply_draft',
            'external_tools',
        ])
    })

    test('uses calendar search permission as a backwards-compatible availability permission', () => {
        expect(getEmailSafeAllowedTools(['search_calendar_events'])).toEqual(['find_calendar_availability'])
    })

    test('builds reply-all recipients without replying to Anna or duplicating recipients', () => {
        expect(
            buildReplyAllRecipients({
                fromEmail: 'Owner@Example.com',
                toEmails: ['anna@alldoneapp.com', 'Bob <bob@example.com>', 'owner@example.com'],
                ccEmails: ['bob@example.com', 'Carol <carol@example.com>', 'anna@alldone.app'],
                assistantEmailAddresses: ['anna@alldoneapp.com'],
            })
        ).toEqual({
            toEmails: ['owner@example.com', 'bob@example.com'],
            ccEmails: ['carol@example.com'],
        })
    })

    test('builds current-message participant metadata without Anna addresses', () => {
        expect(
            buildCurrentEmailParticipants({
                fromEmail: 'Owner@Example.com',
                toEmails: ['anna@alldoneapp.com', 'Bob <bob@example.com>', 'owner@example.com'],
                ccEmails: ['Carol <carol@example.com>', 'anna@alldone.app'],
            })
        ).toEqual({
            senderEmail: 'owner@example.com',
            toEmails: ['bob@example.com', 'owner@example.com'],
            ccEmails: ['carol@example.com'],
        })
    })

    test('keeps only privacy-safe calendar availability follow-up context', () => {
        expect(
            normalizeSafeEmailActionContext({
                type: 'calendar_availability',
                timeZone: 'Europe/Berlin',
                durationMinutes: 30,
                requestedRange: {
                    start: '2026-06-05T09:00:00+02:00',
                    end: '2026-06-05T17:00:00+02:00',
                },
                options: [
                    {
                        start: '2026-06-05T13:30:00+02:00',
                        end: '2026-06-05T14:00:00+02:00',
                        eventTitle: 'Private event',
                    },
                ],
                calendarEmail: 'private@example.com',
                createdAt: 123,
            })
        ).toEqual({
            type: 'calendar_availability',
            timeZone: 'Europe/Berlin',
            durationMinutes: 30,
            requestedRange: {
                start: '2026-06-05T09:00:00+02:00',
                end: '2026-06-05T17:00:00+02:00',
            },
            options: [
                {
                    start: '2026-06-05T13:30:00+02:00',
                    end: '2026-06-05T14:00:00+02:00',
                },
            ],
            createdAt: 123,
        })
    })

    test('normalizes lists containing comma-separated email header values', () => {
        expect(normalizeEmailAddressList(['Alice <alice@example.com>, Bob <bob@example.com>'])).toEqual([
            'alice@example.com',
            'bob@example.com',
        ])
    })

    test('builds daily email title in WhatsApp-like style', () => {
        expect(buildDailyEmailTitle('Karsten', '18 Mar 2026')).toBe('Daily email Anna <> Karsten 18 Mar 2026')
    })

    test('builds deterministic participant-scoped daily email metadata', () => {
        const participantEmails = buildDailyEmailParticipantEmails([
            'Peter.Mueller@example.com',
            'anna@alldoneapp.com',
            'owner@example.com',
            'peter.mueller@example.com',
        ])

        expect(participantEmails).toEqual(['owner@example.com', 'peter.mueller@example.com'])
        expect(buildDailyEmailParticipantKey(participantEmails)).toBe(
            buildDailyEmailParticipantKey(['peter.mueller@example.com', 'owner@example.com'])
        )
        expect(getEmailParticipantDisplayName('peter.mueller@example.com')).toBe('Peter Mueller')
        expect(
            buildParticipantScopedDailyEmailTitle({
                ownerFirstName: 'Karsten',
                ownerEmail: 'owner@example.com',
                participantEmails,
                dateLabel: '18 Mar 2026',
            })
        ).toBe('Daily email Anna <> Karsten, Peter Mueller 18 Mar 2026')
    })

    test('keeps the existing title format for a direct participant scope', () => {
        expect(
            buildParticipantScopedDailyEmailTitle({
                ownerFirstName: 'Karsten',
                ownerEmail: 'owner@example.com',
                participantEmails: ['owner@example.com'],
                dateLabel: '18 Mar 2026',
            })
        ).toBe('Daily email Anna <> Karsten 18 Mar 2026')
    })

    test('builds comment text from subject and body', () => {
        expect(buildEmailCommentText('Invoice March', 'Please process this invoice')).toBe(
            'Subject: Invoice March\n\nPlease process this invoice'
        )
    })

    test('falls back to html body when plain text body is missing', () => {
        expect(buildEmailCommentText('Invoice March', '', '<p>Please process <strong>this</strong> invoice</p>')).toBe(
            'Subject: Invoice March\n\nPlease process this invoice'
        )
    })

    test('strips basic html tags into readable text', () => {
        expect(stripHtmlToText('<div>Hello<br>World</div>')).toBe('Hello\nWorld')
    })

    test('trims quoted reply chains from plain text bodies', () => {
        expect(
            trimQuotedReplyText('Please do this\n\nOn Tue, Mar 19, 2026 at 10:00 AM Anna wrote:\n> older text')
        ).toBe('Please do this')
    })

    test('builds comment text with quoted reply history kept under a context marker', () => {
        expect(
            buildEmailCommentText(
                'Re: Test',
                'Newest request\n\nFrom: Anna <anna@alldoneapp.com>\nSent: today\nOlder thread'
            )
        ).toBe(
            'Subject: Re: Test\n\nNewest request\n\n--- Quoted earlier message (context only) ---\n' +
                'From: Anna <anna@alldoneapp.com>\nSent: today\nOlder thread'
        )
    })

    // AT-2232: a reply asking Anna to book a meeting lost the quoted message that carried the
    // proposed date and time, so she had to ask for details the sender had already supplied.
    test('keeps the quoted proposal of a Gmail reply so date and time stay visible', () => {
        const body = [
            'Hi Ralf,',
            '',
            '@Anna at Alldone <anna@alldoneapp.com>  - trag mal bitte in meinen Kalender',
            'ein.',
            '',
            'Karsten',
            '',
            'On Mon, Aug 10, 2026 at 12:16 PM Ralf Lämmel <rl@schneider-laemmel.com>',
            'wrote:',
            '',
            '> Hallo Karsten,',
            '>',
            '> passt Ihnen Donnerstag, 13.08.2026 um 15:00 Uhr für 60 Minuten?',
        ].join('\n')

        const result = buildEmailCommentText('Re: Agentic AI Leaderschip', body)

        expect(result).toContain('Donnerstag, 13.08.2026 um 15:00 Uhr')
        expect(result).toContain('--- Quoted earlier message (context only) ---')
        expect(result).toContain('trag mal bitte in meinen Kalender')
    })

    // The Gmail attribution wraps onto a second line, so it must be treated as the start of
    // the quote rather than surviving as an orphan "wrote:" that introduces nothing.
    test('treats a line-wrapped attribution as the start of the quoted block', () => {
        const { newText, quotedText } = splitQuotedReplyText(
            'Please book it\n\nOn Mon, Aug 10, 2026 at 12:16 PM Ralf Lämmel <rl@example.com>\nwrote:\n\n> Thursday at 15:00'
        )

        expect(newText).toBe('Please book it')
        expect(quotedText).toContain('On Mon, Aug 10, 2026')
        expect(quotedText).toContain('Thursday at 15:00')
    })

    test('treats a German attribution line as the start of the quoted block', () => {
        const { newText, quotedText } = splitQuotedReplyText(
            'Bitte eintragen\n\nAm 10.08.2026 um 12:16 schrieb Ralf Lämmel <rl@example.com>:\n\n> Donnerstag 15:00'
        )

        expect(newText).toBe('Bitte eintragen')
        expect(quotedText).toContain('Donnerstag 15:00')
    })

    // Previously "To:"/"Subject:"/"Sent:" matched anywhere at a line start, so ordinary prose
    // silently truncated the rest of the message.
    test('does not treat prose starting with a header-like word as a quote boundary', () => {
        const body = [
            'Hi Anna,',
            'To: be discussed tomorrow, please prepare the agenda.',
            'Subject: matter experts should join as well.',
            'Sent: the invites already.',
            'Thanks!',
        ].join('\n')

        const { newText, quotedText } = splitQuotedReplyText(body)

        expect(newText).toBe(body)
        expect(quotedText).toBe('')
    })

    test('still cuts a real Outlook style quoted header block', () => {
        const { newText, quotedText } = splitQuotedReplyText(
            'Newest request\n\nFrom: Anna <anna@alldoneapp.com>\nSent: today\nTo: Karsten\nOlder thread'
        )

        expect(newText).toBe('Newest request')
        expect(quotedText).toContain('Older thread')
    })

    test('caps very long quoted history and marks the truncation', () => {
        const quoted = `> ${'x'.repeat(9000)}`
        const result = buildQuotedReplyContext(quoted)

        expect(result).toContain('[... quoted history truncated ...]')
        expect(result.length).toBeLessThan(4200)
    })

    test('keeps a reply that is only quoted history usable', () => {
        const result = buildEmailCommentText('Re: Test', '> Donnerstag um 15:00 Uhr')

        expect(result).toContain('Donnerstag um 15:00 Uhr')
    })

    test('detects forwarded emails from subject or body markers', () => {
        expect(looksLikeForwardedEmail('Fwd: Invoice', 'anything')).toBe(true)
        expect(looksLikeForwardedEmail('Invoice', '---------- Forwarded message ----------\nFrom: GitLab')).toBe(true)
        expect(looksLikeForwardedEmail('Re: Invoice', 'Newest request\n\nOn Tue, Mar 19 wrote:')).toBe(false)
    })

    test('keeps the full forwarded email body intact', () => {
        const forwardedBody =
            '---------- Forwarded message ----------\nFrom: GitLab <ar@gitlab.com>\nDate: Tue, Mar 10, 2026\n\nPlease handle this invoice'

        expect(buildEmailCommentText('Fwd: Your GitLab invoice', forwardedBody)).toBe(
            'Subject: Fwd: Your GitLab invoice\n\n' + forwardedBody
        )
    })

    test('prefers a single pdf attachment as actionable', () => {
        const selection = pickActionableAttachment([
            { fileName: 'invoice.pdf', contentType: 'application/pdf' },
            { fileName: 'logo.png', contentType: 'image/png' },
        ])

        expect(selection.status).toBe('ok')
        expect(selection.attachment.fileName).toBe('invoice.pdf')
    })

    test('selects the more invoice-like supported attachment by filename', () => {
        const selection = pickActionableAttachment([
            {
                fileName: 'notes.docx',
                contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            },
            {
                fileName: 'invoice-march.docx',
                contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            },
        ])

        expect(selection.status).toBe('ok')
        expect(selection.attachment.fileName).toBe('invoice-march.docx')
        expect(selection.supportedAttachments).toHaveLength(2)
    })

    test('selects the more invoice-like supported attachment by extracted text', () => {
        const selection = pickActionableAttachment([
            {
                fileName: 'document.pdf',
                contentType: 'application/pdf',
                extractedText: 'Invoice number 2026-001\nAmount due 1200 EUR\nIBAN DE12',
            },
            {
                fileName: 'document-copy.pdf',
                contentType: 'application/pdf',
                extractedText: 'General notes from the meeting',
            },
        ])

        expect(selection.status).toBe('ok')
        expect(selection.attachment.fileName).toBe('document.pdf')
    })

    test('breaks equally relevant ties by file type priority, then original order', () => {
        const docxPreferred = pickActionableAttachment([
            {
                fileName: 'invoice.docx',
                contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            },
            { fileName: 'invoice.txt', contentType: 'text/plain' },
        ])

        expect(docxPreferred.attachment.fileName).toBe('invoice.docx')

        const originalOrderPreferred = pickActionableAttachment([
            { fileName: 'invoice-a.pdf', contentType: 'application/pdf' },
            { fileName: 'invoice-b.pdf', contentType: 'application/pdf' },
        ])

        expect(originalOrderPreferred.attachment.fileName).toBe('invoice-a.pdf')
    })

    test('returns none when no supported attachments are present', () => {
        const selection = pickActionableAttachment([
            { fileName: 'logo.png', contentType: 'image/png' },
            { fileName: 'signature.jpg', contentType: 'image/jpeg' },
        ])

        expect(selection).toEqual({
            status: 'none',
            attachment: null,
            supportedAttachments: [],
        })
    })

    test('verifies normalized webhook signatures', () => {
        const payload = { messageId: 'abc', fromEmail: 'user@example.com' }
        const timestamp = '1710000000'
        const secret = 'test-secret'
        const value = computeWebhookSignature(secret, timestamp, payload)

        expect(verifyInboundEmailSignature(secret, { timestamp, value }, payload)).toEqual({ valid: true })
    })

    // AT-2232: without this the assistant is told the mail arrived whenever the queue drained.
    test('captures the sender Date header as sentAt', () => {
        const payload = normalizeInboundEmailPayload(
            { messageId: 'msg-date', from: 'user@example.com', headers: { date: 'Mon, 10 Aug 2026 12:16:00 +0200' } },
            {}
        )

        expect(payload.sentAt).toBe(Date.parse('Mon, 10 Aug 2026 12:16:00 +0200'))
    })

    test('falls back to null sentAt when the Date header is missing or unparseable', () => {
        expect(normalizeInboundEmailPayload({ messageId: 'a', from: 'u@e.com' }, {}).sentAt).toBeNull()
        expect(
            normalizeInboundEmailPayload({ messageId: 'b', from: 'u@e.com', headers: { date: 'not a date' } }, {})
                .sentAt
        ).toBeNull()
    })

    test('normalizes inbound email payload shape', () => {
        const payload = normalizeInboundEmailPayload(
            {
                providerMessageId: 'msg-1',
                from: 'User@Example.com',
                to: 'anna@alldoneapp.com, teammate@example.com',
                cc: ['observer@example.com'],
                subject: 'Invoice',
                text: 'Please add this invoice',
                threadHeaders: {
                    inReplyTo: '<message-id>',
                    references: '<message-id>',
                },
                attachments: [
                    {
                        filename: 'invoice.pdf',
                        mimeType: 'application/pdf',
                        base64: 'aGVsbG8=',
                    },
                ],
            },
            {}
        )

        expect(payload.messageId).toBe('msg-1')
        expect(payload.fromEmail).toBe('user@example.com')
        expect(payload.toEmails).toEqual(['anna@alldoneapp.com', 'teammate@example.com'])
        expect(payload.ccEmails).toEqual(['observer@example.com'])
        expect(payload.textBody).toBe('Please add this invoice')
        expect(payload.threadHeaders.inReplyTo).toBe('<message-id>')
        expect(payload.attachments).toEqual([
            {
                fileName: 'invoice.pdf',
                contentType: 'application/pdf',
                contentBase64: 'aGVsbG8=',
                sizeBytes: 0,
            },
        ])
    })
})
