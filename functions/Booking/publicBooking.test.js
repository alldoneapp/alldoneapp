jest.mock('firebase-admin', () => ({
    firestore: jest.fn(),
}))

jest.mock('../GoogleCalendar/assistantCalendarTools', () => ({
    createCalendarEventForAssistantRequest: jest.fn(),
}))

jest.mock('./bookingSettings', () => ({
    findPublicBookingSlots: jest.fn(),
    getConnectedCalendarCount: jest.fn(),
    getHostingUrl: jest.fn(() => 'https://my.alldone.app'),
    getPublicBookingPage: jest.fn(),
    resolvePublicDuration: jest.fn((settings, durationMinutes) => parseInt(durationMinutes, 10) || settings.durationMinutes || 30),
    slugify: value =>
        String(value || '')
            .trim()
            .toLowerCase(),
}))

const admin = require('firebase-admin')
const { createCalendarEventForAssistantRequest } = require('../GoogleCalendar/assistantCalendarTools')
const bookingSettings = require('./bookingSettings')
const { bookingApiHandler } = require('./publicBooking')

function createResponse() {
    return {
        headers: {},
        statusCode: null,
        body: null,
        set: jest.fn(function set(key, value) {
            this.headers[key] = value
        }),
        status: jest.fn(function status(code) {
            this.statusCode = code
            return this
        }),
        json: jest.fn(function json(payload) {
            this.body = payload
            return this
        }),
        send: jest.fn(function send(payload) {
            this.body = payload
            return this
        }),
    }
}

function createRequest({ method = 'GET', path = '/', query = {}, body = {} } = {}) {
    return { method, path, query, body, url: path }
}

describe('public booking API', () => {
    const page = {
        slug: 'karsten-wysk',
        userId: 'user-1',
        profile: { displayName: 'Karsten Wysk' },
        settings: {
            durationMinutes: 30,
            slotIntervalMinutes: 30,
            workingHoursStart: '09:00',
            workingHoursEnd: '17:00',
            includeWeekends: false,
            bufferBeforeMinutes: 0,
            bufferAfterMinutes: 0,
            timeZone: 'Europe/Berlin',
        },
    }

    beforeEach(() => {
        jest.clearAllMocks()
        bookingSettings.getPublicBookingPage.mockResolvedValue(page)
        bookingSettings.getConnectedCalendarCount.mockResolvedValue(1)
        bookingSettings.findPublicBookingSlots.mockResolvedValue({
            success: true,
            timeZone: 'Europe/Berlin',
            options: [{ start: '2026-06-18T09:00:00+02:00', end: '2026-06-18T09:30:00+02:00' }],
        })
        createCalendarEventForAssistantRequest.mockResolvedValue({
            success: true,
            provider: 'google',
            calendarId: 'primary',
            event: { eventId: 'event-1', htmlLink: 'https://calendar.example/event-1' },
        })
        admin.firestore.mockReturnValue({
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({
                    id: 'booking-1',
                    set: jest.fn().mockResolvedValue(undefined),
                })),
            })),
            FieldValue: { serverTimestamp: jest.fn(() => 'now') },
        })
        admin.firestore.FieldValue = { serverTimestamp: jest.fn(() => 'now') }
    })

    test('returns not found for unknown booking pages', async () => {
        bookingSettings.getPublicBookingPage.mockResolvedValue(null)
        const res = createResponse()

        await bookingApiHandler(createRequest({ path: '/page/missing' }), res)

        expect(res.statusCode).toBe(404)
        expect(res.body.success).toBe(false)
    })

    test('rejects booking without visitor name and email', async () => {
        const res = createResponse()

        await bookingApiHandler(
            createRequest({
                method: 'POST',
                path: '/book',
                body: {
                    slug: 'karsten-wysk',
                    start: '2026-06-18T09:00:00+02:00',
                    end: '2026-06-18T09:30:00+02:00',
                },
            }),
            res
        )

        expect(res.statusCode).toBe(400)
        expect(createCalendarEventForAssistantRequest).not.toHaveBeenCalled()
    })

    test('returns conflict when selected slot is no longer available', async () => {
        bookingSettings.findPublicBookingSlots.mockResolvedValue({ success: true, timeZone: 'Europe/Berlin', options: [] })
        const res = createResponse()

        await bookingApiHandler(
            createRequest({
                method: 'POST',
                path: '/book',
                body: {
                    slug: 'karsten-wysk',
                    start: '2026-06-18T09:00:00+02:00',
                    end: '2026-06-18T09:30:00+02:00',
                    visitorName: 'Visitor',
                    visitorEmail: 'visitor@example.com',
                },
            }),
            res
        )

        expect(res.statusCode).toBe(409)
        expect(createCalendarEventForAssistantRequest).not.toHaveBeenCalled()
    })

    test('creates a calendar event and booking record on success', async () => {
        const set = jest.fn().mockResolvedValue(undefined)
        admin.firestore.mockReturnValue({
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({ id: 'booking-1', set })),
            })),
        })
        admin.firestore.FieldValue = { serverTimestamp: jest.fn(() => 'now') }
        const res = createResponse()

        await bookingApiHandler(
            createRequest({
                method: 'POST',
                path: '/book',
                body: {
                    slug: 'karsten-wysk',
                    start: '2026-06-18T09:00:00+02:00',
                    end: '2026-06-18T09:30:00+02:00',
                    timeZone: 'Europe/Berlin',
                    visitorName: 'Visitor',
                    visitorEmail: 'visitor@example.com',
                    note: 'Intro call',
                },
            }),
            res
        )

        expect(res.statusCode).toBe(200)
        expect(createCalendarEventForAssistantRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'user-1',
                summary: 'Meeting with Visitor',
                description: expect.stringContaining(
                    'Booked from Alldone.app public booking link: https://my.alldone.app/meet/karsten-wysk'
                ),
                attendees: [{ email: 'visitor@example.com', displayName: 'Visitor' }],
            })
        )
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed', visitorEmail: 'visitor@example.com' }))
        expect(res.body.bookingId).toBe('booking-1')
    })
})
