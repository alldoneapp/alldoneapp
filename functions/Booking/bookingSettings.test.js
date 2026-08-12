jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({
        doc: jest.fn(),
    })),
}))

jest.mock('../Calendar/providers/microsoftCalendarProvider', () => ({
    getConnectedMicrosoftCalendarAccounts: jest.fn(),
}))

jest.mock('../GoogleCalendar/assistantCalendarTools', () => ({
    findCalendarAvailabilityForAssistantRequest: jest.fn(),
    __private__: {
        getConnectedCalendarAccounts: jest.fn(),
    },
}))

const moment = require('moment-timezone')
const { findCalendarAvailabilityForAssistantRequest } = require('../GoogleCalendar/assistantCalendarTools')
const {
    buildDefaultSlug,
    findPublicBookingSlots,
    normalizeBookingSettings,
    resolveEarliestBookableStart,
    resolveSameDayBoundaryTimeZone,
    slugify,
    validateBookingSettings,
} = require('./bookingSettings')

describe('bookingSettings helpers', () => {
    test('slugifies display names for public booking links', () => {
        expect(slugify('Karsten Wysk')).toBe('karsten-wysk')
        expect(slugify(' Élodie   Example!! ')).toBe('elodie-example')
        expect(buildDefaultSlug({ displayName: 'Ada Lovelace' })).toBe('ada-lovelace')
    })

    test('normalizes bounded settings and defaults invalid values', () => {
        const settings = normalizeBookingSettings(
            {
                enabled: true,
                slug: 'My Link',
                durationMinutes: 9999,
                slotIntervalMinutes: 1,
                workingHoursStart: '25:00',
                workingHoursEnd: '10:00',
                includeWeekends: true,
                bufferBeforeMinutes: -10,
                bufferAfterMinutes: 999,
            },
            { displayName: 'Owner', preferredTimezone: 'Europe/Berlin' }
        )

        expect(settings).toMatchObject({
            enabled: true,
            slug: 'my-link',
            durationMinutes: 15,
            availableDurations: [15, 30, 60],
            slotIntervalMinutes: 5,
            workingHoursStart: '09:00',
            workingHoursEnd: '10:00',
            includeWeekends: true,
            bufferBeforeMinutes: 0,
            bufferAfterMinutes: 240,
            timeZone: 'Europe/Berlin',
        })
    })

    test('rejects malformed slugs', () => {
        expect(() => validateBookingSettings({ ...normalizeBookingSettings({ slug: 'ab' }) })).toThrow(/Booking link/)
    })
})

describe('same-day booking setting (AT-2271)', () => {
    // 2026-08-12 14:00 in Berlin. Fixed so "today"/"tomorrow" can be asserted exactly.
    const NOW = moment.tz('2026-08-12T14:00:00', 'Europe/Berlin').valueOf()
    const HOST_SETTINGS = { timeZone: 'Europe/Berlin', availableDurations: [30], durationMinutes: 30 }

    beforeEach(() => {
        jest.useFakeTimers()
        jest.setSystemTime(NOW)
        findCalendarAvailabilityForAssistantRequest.mockReset()
        findCalendarAvailabilityForAssistantRequest.mockResolvedValue({
            success: true,
            timeZone: 'Europe/Berlin',
            options: [],
        })
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    test('defaults to false and only an explicit boolean true enables it', () => {
        // Backward compatibility: booking links saved before this setting existed have no
        // such field, so they must keep the no-same-day rule.
        expect(normalizeBookingSettings({}).allowSameDayBooking).toBe(false)
        expect(normalizeBookingSettings({ slug: 'x' }).allowSameDayBooking).toBe(false)
        expect(normalizeBookingSettings({ allowSameDayBooking: true }).allowSameDayBooking).toBe(true)
        expect(normalizeBookingSettings({ allowSameDayBooking: 'true' }).allowSameDayBooking).toBe(false)
        expect(normalizeBookingSettings({ allowSameDayBooking: 1 }).allowSameDayBooking).toBe(false)
        expect(normalizeBookingSettings({ allowSameDayBooking: false }).allowSameDayBooking).toBe(false)
    })

    test('the day boundary is the host timezone, not the visitor one', () => {
        // A visitor in Auckland (already tomorrow) must not shift the host's rule.
        expect(resolveSameDayBoundaryTimeZone(HOST_SETTINGS, 'Pacific/Auckland')).toBe('Europe/Berlin')
        expect(resolveSameDayBoundaryTimeZone({}, 'Pacific/Auckland')).toBe('Pacific/Auckland')
        expect(resolveSameDayBoundaryTimeZone({ timeZone: 'Not/AZone' }, 'Pacific/Auckland')).toBe('Pacific/Auckland')
        expect(resolveSameDayBoundaryTimeZone({}, '')).toBe('UTC')
    })

    test('the earliest bookable instant is midnight tomorrow in the host timezone', () => {
        const earliest = resolveEarliestBookableStart(HOST_SETTINGS, 'Pacific/Auckland')
        expect(earliest.tz('Europe/Berlin').format()).toBe('2026-08-13T00:00:00+02:00')
    })

    test('there is no restriction once the host opts in', () => {
        expect(resolveEarliestBookableStart({ ...HOST_SETTINGS, allowSameDayBooking: true }, '')).toBeNull()
    })

    test('a request for today returns no options and never hits the calendar', async () => {
        const result = await findPublicBookingSlots(
            { userId: 'u1', settings: HOST_SETTINGS },
            {
                start: '2026-08-12T14:00:00+02:00',
                end: '2026-08-12T23:59:59+02:00',
                timeZone: 'Europe/Berlin',
                durationMinutes: 30,
            }
        )

        // Success with zero options, not an error: "nothing available" is the truth here, and
        // a failure would surface to the visitor as a broken calendar.
        expect(result.success).toBe(true)
        expect(result.options).toEqual([])
        expect(findCalendarAvailabilityForAssistantRequest).not.toHaveBeenCalled()
    })

    test('a range spanning today is clamped to the start of tomorrow', async () => {
        await findPublicBookingSlots(
            { userId: 'u1', settings: HOST_SETTINGS },
            {
                start: '2026-08-12T09:00:00+02:00',
                end: '2026-08-15T17:00:00+02:00',
                timeZone: 'Europe/Berlin',
                durationMinutes: 30,
            }
        )

        const call = findCalendarAvailabilityForAssistantRequest.mock.calls[0][0]
        expect(moment.parseZone(call.timeMin).tz('Europe/Berlin').format()).toBe('2026-08-13T00:00:00+02:00')
        expect(call.timeMax).toBe('2026-08-15T17:00:00+02:00')
    })

    test('a visitor in a later timezone still cannot book the host today', async () => {
        // 2026-08-13T01:00+12:00 Auckland is 2026-08-12 15:00 in Berlin — the host's today.
        const result = await findPublicBookingSlots(
            { userId: 'u1', settings: HOST_SETTINGS },
            {
                start: '2026-08-13T01:00:00+12:00',
                end: '2026-08-13T09:59:59+12:00',
                timeZone: 'Pacific/Auckland',
                durationMinutes: 30,
            }
        )

        expect(result.options).toEqual([])
        expect(findCalendarAvailabilityForAssistantRequest).not.toHaveBeenCalled()
    })

    test('today is searched unchanged when the host allows same-day booking', async () => {
        await findPublicBookingSlots(
            { userId: 'u1', settings: { ...HOST_SETTINGS, allowSameDayBooking: true } },
            {
                start: '2026-08-12T14:00:00+02:00',
                end: '2026-08-12T23:59:59+02:00',
                timeZone: 'Europe/Berlin',
                durationMinutes: 30,
            }
        )

        const call = findCalendarAvailabilityForAssistantRequest.mock.calls[0][0]
        expect(call.timeMin).toBe('2026-08-12T14:00:00+02:00')
    })

    test('future days are unaffected by the restriction', async () => {
        await findPublicBookingSlots(
            { userId: 'u1', settings: HOST_SETTINGS },
            {
                start: '2026-08-20T09:00:00+02:00',
                end: '2026-08-20T17:00:00+02:00',
                timeZone: 'Europe/Berlin',
                durationMinutes: 30,
            }
        )

        const call = findCalendarAvailabilityForAssistantRequest.mock.calls[0][0]
        expect(call.timeMin).toBe('2026-08-20T09:00:00+02:00')
    })
})
