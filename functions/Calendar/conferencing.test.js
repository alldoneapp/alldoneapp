'use strict'

const {
    buildGoogleMeetCreateRequest,
    buildMicrosoftOnlineMeetingFields,
    googleConferenceSucceeded,
    isAllDayEventPayload,
    isConferencingRejection,
    shouldAddConferencing,
} = require('./conferencing')

describe('buildGoogleMeetCreateRequest', () => {
    test('asks Google Calendar for a Meet conference', () => {
        const request = buildGoogleMeetCreateRequest()
        expect(request.createRequest.conferenceSolutionKey).toEqual({ type: 'hangoutsMeet' })
        expect(typeof request.createRequest.requestId).toBe('string')
        expect(request.createRequest.requestId.length).toBeGreaterThan(0)
    })

    // Google treats a repeated requestId as a retry of the same conference, so a
    // constant id (as two legacy browser modals in this repo use) would make
    // back-to-back bookings collide.
    test('generates a fresh requestId per call', () => {
        const ids = new Set(Array.from({ length: 50 }, () => buildGoogleMeetCreateRequest().createRequest.requestId))
        expect(ids.size).toBe(50)
    })
})

describe('buildMicrosoftOnlineMeetingFields', () => {
    test('requests a Teams meeting', () => {
        expect(buildMicrosoftOnlineMeetingFields()).toEqual({
            isOnlineMeeting: true,
            onlineMeetingProvider: 'teamsForBusiness',
        })
    })
})

describe('isAllDayEventPayload', () => {
    test('recognises all-day events', () => {
        expect(isAllDayEventPayload({ start: { date: '2026-03-12' } })).toBe(true)
    })

    test('treats timed events as not all-day', () => {
        expect(isAllDayEventPayload({ start: { dateTime: '2026-03-12T09:00:00+01:00' } })).toBe(false)
    })

    test('treats a payload without a start as not all-day', () => {
        expect(isAllDayEventPayload({})).toBe(false)
        expect(isAllDayEventPayload()).toBe(false)
    })
})

describe('shouldAddConferencing', () => {
    const timed = { start: { dateTime: '2026-03-12T09:00:00+01:00' } }

    test('adds conferencing to timed events by default', () => {
        expect(shouldAddConferencing(timed)).toBe(true)
        expect(shouldAddConferencing(timed, undefined)).toBe(true)
    })

    test('never adds conferencing to all-day events', () => {
        expect(shouldAddConferencing({ start: { date: '2026-03-12' } })).toBe(false)
    })

    test('honours an explicit opt-out', () => {
        expect(shouldAddConferencing(timed, false)).toBe(false)
    })

    test('an explicit opt-in is still refused for all-day events', () => {
        expect(shouldAddConferencing({ start: { date: '2026-03-12' } }, true)).toBe(false)
    })
})

describe('isConferencingRejection', () => {
    // 400/403 mean the provider validated and refused, so nothing was created
    // and retrying without conferencing cannot duplicate the event.
    test.each([
        ['code 400', { code: 400 }],
        ['code 403', { code: 403 }],
        ['response status 400', { response: { status: 400 } }],
        ['response status 403', { response: { status: 403 } }],
        ['statusCode 403', { statusCode: 403 }],
    ])('retries on a definitive rejection: %s', (_label, error) => {
        expect(isConferencingRejection(error)).toBe(true)
    })

    // A 5xx or transport error may have succeeded server-side; retrying could
    // double-book the slot, so these must propagate.
    test.each([
        ['500', { code: 500 }],
        ['503', { response: { status: 503 } }],
        ['429', { code: 429 }],
        ['404', { code: 404 }],
    ])('does not retry on %s', (_label, error) => {
        expect(isConferencingRejection(error)).toBe(false)
    })

    test('falls back to message matching when no status is available', () => {
        // The Graph client re-throws `new Error(data.error.message)` with no status.
        expect(isConferencingRejection(new Error('Online meeting is not enabled for this tenant'))).toBe(true)
        expect(isConferencingRejection(new Error('Invalid conference type value.'))).toBe(true)
    })

    test('does not retry an unrelated statusless error', () => {
        expect(isConferencingRejection(new Error('socket hang up'))).toBe(false)
        expect(isConferencingRejection(undefined)).toBe(false)
    })

    test('reads a nested Google API error message', () => {
        expect(
            isConferencingRejection({ response: { data: { error: { message: 'Invalid conference type value.' } } } })
        ).toBe(true)
    })
})

describe('googleConferenceSucceeded', () => {
    test('accepts an explicit success status', () => {
        expect(
            googleConferenceSucceeded({ conferenceData: { createRequest: { status: { statusCode: 'success' } } } })
        ).toBe(true)
    })

    test('rejects a failed or pending conference', () => {
        expect(
            googleConferenceSucceeded({ conferenceData: { createRequest: { status: { statusCode: 'failure' } } } })
        ).toBe(false)
        expect(
            googleConferenceSucceeded({ conferenceData: { createRequest: { status: { statusCode: 'pending' } } } })
        ).toBe(false)
    })

    test('falls back to the presence of a link when no status is reported', () => {
        expect(googleConferenceSucceeded({ hangoutLink: 'https://meet.google.com/abc-defg-hij' })).toBe(true)
        expect(googleConferenceSucceeded({ conferenceData: { entryPoints: [] } })).toBe(true)
        expect(googleConferenceSucceeded({})).toBe(false)
    })
})
