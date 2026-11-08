'use strict'

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(),
}))

jest.mock('sib-api-v3-sdk', () => ({
    ApiClient: { instance: { authentications: { 'api-key': {} } } },
    TransactionalEmailsApi: jest.fn(),
}))

jest.mock('../Users/usersFirestore', () => ({
    getUserData: jest.fn(),
}))

jest.mock('../envFunctionsHelper', () => ({
    getEnvFunctions: jest.fn(() => ({})),
}))

const { buildHostEmailHtml, buildVisitorEmailHtml } = require('./bookingEmails')

const JOIN_URL = 'https://meet.google.com/abc-defg-hij'

describe('booking email join links', () => {
    // The calendar insert does not send Google/Graph invitations, so this email
    // is the visitor's only reliable path to the meeting link.
    describe('visitor confirmation', () => {
        test('renders the join link as a row and a primary button', () => {
            const html = buildVisitorEmailHtml({
                visitorName: 'Visitor',
                hostName: 'Karsten Wysk',
                meetingTimeText: 'Thursday, June 18, 2026 · 09:00 – 09:30 (Europe/Berlin)',
                durationMinutes: 30,
                joinUrl: JOIN_URL,
            })

            expect(html).toContain('Join')
            expect(html).toContain(JOIN_URL)
            expect(html).toContain('Join the meeting')
            expect(html).toContain('Use the link below to join')
        })

        test('omits every join affordance when there is no link', () => {
            const html = buildVisitorEmailHtml({
                visitorName: 'Visitor',
                hostName: 'Karsten Wysk',
                meetingTimeText: 'Thursday, June 18, 2026 · 09:00 – 09:30 (Europe/Berlin)',
                durationMinutes: 30,
                joinUrl: '',
            })

            expect(html).not.toContain('Join the meeting')
            expect(html).not.toContain('meet.google.com')
            // Falls back to the original wording rather than promising a link.
            expect(html).toContain("You'll find it on your calendar")
        })

        test('escapes the join URL', () => {
            const html = buildVisitorEmailHtml({
                visitorName: 'Visitor',
                hostName: 'Host',
                joinUrl: 'https://meet.google.com/x?a=1&b="><script>alert(1)</script>',
            })

            expect(html).not.toContain('<script>')
            expect(html).toContain('&amp;')
        })
    })

    describe('host notification', () => {
        test('promotes the join link over the calendar link', () => {
            const html = buildHostEmailHtml({
                visitorName: 'Visitor',
                visitorEmail: 'visitor@example.com',
                durationMinutes: 30,
                eventHtmlLink: 'https://calendar.example/event-1',
                joinUrl: JOIN_URL,
            })

            expect(html).toContain('Join the meeting')
            expect(html).toContain(JOIN_URL)
            expect(html).not.toContain('View in your calendar')
        })

        test('keeps the calendar button when no join link exists', () => {
            const html = buildHostEmailHtml({
                visitorName: 'Visitor',
                visitorEmail: 'visitor@example.com',
                durationMinutes: 30,
                eventHtmlLink: 'https://calendar.example/event-1',
                joinUrl: '',
            })

            expect(html).toContain('View in your calendar')
            expect(html).not.toContain('Join the meeting')
        })

        test('renders neither button when the event has no links at all', () => {
            const html = buildHostEmailHtml({
                visitorName: 'Visitor',
                visitorEmail: 'visitor@example.com',
                durationMinutes: 30,
            })

            expect(html).not.toContain('View in your calendar')
            expect(html).not.toContain('Join the meeting')
        })
    })
})

// Security audit 2026-11 (#10): the visitor mail goes to an address an unauthenticated caller typed.
describe('visitor confirmation content', () => {
    test('does not echo the note and cuts long names short', () => {
        const html = buildVisitorEmailHtml({
            visitorName: 'V'.repeat(200),
            hostName: 'Buy cheap pills at spam.example '.repeat(10),
            note: 'Click https://phish.example now',
            meetingTimeText: 'Thursday',
            durationMinutes: 30,
            joinUrl: '',
        })
        expect(html).not.toContain('phish.example')
        expect(html).not.toContain('V'.repeat(61))
        expect(html).not.toContain('spam.example '.repeat(3))
    })

    test('uses a fixed subject, never the host-chosen display name', async () => {
        jest.resetModules()
        const sendTransacEmail = jest.fn().mockResolvedValue({})
        jest.doMock('sib-api-v3-sdk', () => ({
            ApiClient: { instance: { authentications: { 'api-key': {} } } },
            TransactionalEmailsApi: jest.fn(() => ({ sendTransacEmail })),
        }))
        jest.doMock('../envFunctionsHelper', () => ({ getEnvFunctions: () => ({ SIB_API_KEY: 'key' }) }))
        const emails = require('./bookingEmails')
        await emails.sendBookingConfirmationToVisitor({
            visitorName: 'Visitor',
            visitorEmail: 'visitor@example.com',
            hostName: 'WIN A PRIZE at spam.example',
            start: '2026-06-18T09:00:00+02:00',
            end: '2026-06-18T09:30:00+02:00',
            timeZone: 'Europe/Berlin',
            durationMinutes: 30,
            joinUrl: '',
        })
        expect(sendTransacEmail).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Your meeting is confirmed' }))
    })
})
