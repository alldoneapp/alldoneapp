const { __private__ } = require('./menubarApp')
const { collectAttendeeEmails, dedupeUpcomingMeetings, parseEventInstant, toUpcomingMeeting } = __private__

const ACCOUNT_EMAILS = new Set(['karsten@alldone.app'])

const timedEvent = (overrides = {}) => ({
    eventId: 'evt_1',
    summary: 'Standup',
    status: 'confirmed',
    htmlLink: 'https://calendar.google.com/event?eid=1',
    calendarEmail: 'karsten@alldone.app',
    start: { dateTime: '2026-07-27T09:00:00Z', timeZone: 'UTC' },
    end: { dateTime: '2026-07-27T09:30:00Z', timeZone: 'UTC' },
    hangoutLink: 'https://meet.google.com/abc-defg-hij',
    attendees: [],
    ...overrides,
})

describe('parseEventInstant', () => {
    test('parses a timed event', () => {
        expect(parseEventInstant({ dateTime: '2026-07-27T09:00:00Z' })).toBe(Date.parse('2026-07-27T09:00:00Z'))
    })

    test('rejects all-day and malformed values', () => {
        expect(parseEventInstant({ date: '2026-07-27' })).toBeNull()
        expect(parseEventInstant({ dateTime: 'not a date' })).toBeNull()
        expect(parseEventInstant(null)).toBeNull()
    })
})

describe('toUpcomingMeeting', () => {
    test('maps a joinable timed event', () => {
        const result = toUpcomingMeeting(timedEvent(), ACCOUNT_EMAILS)
        expect(result).toMatchObject({
            id: 'evt_1',
            title: 'Standup',
            joinUrl: 'https://meet.google.com/abc-defg-hij',
            joinProvider: 'google_meet',
            calendarUrl: 'https://calendar.google.com/event?eid=1',
            startsAt: Date.parse('2026-07-27T09:00:00Z'),
            endsAt: Date.parse('2026-07-27T09:30:00Z'),
        })
    })

    test('drops all-day events', () => {
        expect(
            toUpcomingMeeting(
                timedEvent({ start: { date: '2026-07-27' }, end: { date: '2026-07-28' } }),
                ACCOUNT_EMAILS
            )
        ).toBeNull()
    })

    test('drops cancelled events', () => {
        expect(toUpcomingMeeting(timedEvent({ status: 'cancelled' }), ACCOUNT_EMAILS)).toBeNull()
    })

    test('drops events with no join link', () => {
        expect(
            toUpcomingMeeting(
                timedEvent({ hangoutLink: '', location: 'Berlin office', description: '' }),
                ACCOUNT_EMAILS
            )
        ).toBeNull()
    })

    test('drops events the user declined', () => {
        const declined = timedEvent({
            attendees: [{ email: 'karsten@alldone.app', responseStatus: 'declined' }],
        })
        expect(toUpcomingMeeting(declined, ACCOUNT_EMAILS)).toBeNull()
    })

    test('keeps events someone else declined', () => {
        const event = timedEvent({
            attendees: [
                { email: 'karsten@alldone.app', responseStatus: 'accepted' },
                { email: 'other@example.com', responseStatus: 'declined' },
            ],
        })
        expect(toUpcomingMeeting(event, ACCOUNT_EMAILS)).not.toBeNull()
    })

    test('carries the recurring series id through', () => {
        const result = toUpcomingMeeting(timedEvent({ recurringEventId: 'series_9' }), ACCOUNT_EMAILS)
        expect(result.recurringKey).toBe('series_9')
    })
})

describe('collectAttendeeEmails', () => {
    test('normalizes, dedupes and excludes meeting rooms', () => {
        const emails = collectAttendeeEmails({
            attendees: [
                { email: 'Karsten@Alldone.app' },
                { email: 'karsten@alldone.app' },
                { email: 'room-4@resource.calendar.google.com', resource: true },
                { email: 'guest@example.com' },
                { email: '' },
            ],
        })
        expect(emails).toEqual(['karsten@alldone.app', 'guest@example.com'])
    })

    test('handles an event with no attendees', () => {
        expect(collectAttendeeEmails({})).toEqual([])
    })
})

describe('dedupeUpcomingMeetings', () => {
    test('collapses the same meeting seen on two connected calendars', () => {
        const meetings = [
            { id: 'a', joinUrl: 'https://meet.google.com/x', startsAt: 1000 },
            { id: 'b', joinUrl: 'https://meet.google.com/x', startsAt: 1000 },
            { id: 'c', joinUrl: 'https://meet.google.com/y', startsAt: 1000 },
        ]
        expect(dedupeUpcomingMeetings(meetings).map(meeting => meeting.id)).toEqual(['a', 'c'])
    })

    test('keeps two occurrences of a recurring meeting', () => {
        const meetings = [
            { id: 'a', joinUrl: 'https://meet.google.com/x', startsAt: 1000 },
            { id: 'b', joinUrl: 'https://meet.google.com/x', startsAt: 2000 },
        ]
        expect(dedupeUpcomingMeetings(meetings)).toHaveLength(2)
    })
})
