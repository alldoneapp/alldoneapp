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

const {
    buildDefaultSlug,
    normalizeBookingSettings,
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
        expect(() => validateBookingSettings({ ...normalizeBookingSettings({ slug: 'ab' }) })).toThrow(
            /Booking link/
        )
    })
})
