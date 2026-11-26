jest.mock('firebase-admin', () => ({
    firestore: jest.fn(),
}))

jest.mock('firebase-admin/firestore', () => ({
    FieldValue: { serverTimestamp: jest.fn(() => 'now') },
}))

jest.mock('../GoogleCalendar/assistantCalendarTools', () => ({
    createCalendarEventForAssistantRequest: jest.fn(),
}))

jest.mock('./bookingEmails', () => ({
    sendBookingNotificationToHost: jest.fn().mockResolvedValue(undefined),
    sendBookingConfirmationToVisitor: jest.fn().mockResolvedValue(undefined),
}))

const mockConsumeBookingQuota = jest.fn(async () => ({ allowed: true }))
const mockConsumeSlotLookupQuota = jest.fn(async () => ({ allowed: true }))
jest.mock('./bookingRateLimit', () => ({
    consumeBookingQuota: (...args) => mockConsumeBookingQuota(...args),
    consumeSlotLookupQuota: (...args) => mockConsumeSlotLookupQuota(...args),
    getClientIp: req => req.headers?.['x-forwarded-for'] || 'unknown',
}))

jest.mock('./bookingSettings', () => ({
    MAX_BOOKING_RANGE_DAYS: 31,
    MAX_PUBLIC_SLOT_OPTIONS: 96,
    findPublicBookingSlots: jest.fn(),
    getConnectedCalendarCount: jest.fn(),
    getHostingUrl: jest.fn(() => 'https://my.alldone.app'),
    getPublicBookingPage: jest.fn(),
    // Null = no same-day restriction, which is what the pre-existing cases assume.
    resolveEarliestBookableStart: jest.fn(() => null),
    resolvePublicAvailabilityTimeZone: jest.fn(settings => settings.timeZone || 'UTC'),
    resolvePublicDuration: jest.fn(
        (settings, durationMinutes) => parseInt(durationMinutes, 10) || settings.durationMinutes || 30
    ),
    slugify: value =>
        String(value || '')
            .trim()
            .toLowerCase(),
}))

const moment = require('moment-timezone')
const admin = require('firebase-admin')
const { createFakeFirestore } = require('../Tests/fakeFirestore')
const { createCalendarEventForAssistantRequest } = require('../GoogleCalendar/assistantCalendarTools')
const bookingSettings = require('./bookingSettings')
const bookingEmails = require('./bookingEmails')
const { lockDocId } = require('./bookingLock')
const { bookPublicMeeting, bookingApiHandler } = require('./publicBooking')

// Future dates: the booking path refuses slots that already started.
const SLOT_START = '2030-06-18T09:00:00+02:00'
const SLOT_END = '2030-06-18T09:30:00+02:00'

function createResponse() {
    return {
        headers: {},
        statusCode: null,
        body: null,
        set: jest.fn(function set(key, value) {
            this.headers[key] = value
            return this
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

function createRequest({ method = 'GET', path = '/', query = {}, body = {}, headers = {} } = {}) {
    return { method, path, query, body, url: path, headers }
}

// The fake runs a transaction's reads and writes with awaits in between, so two concurrent
// transactions could interleave. Real Firestore serializes conflicting ones; so does this.
function serializeTransactions(db) {
    const run = db.runTransaction
    let chain = Promise.resolve()
    db.runTransaction = fn => {
        const next = chain.then(() => run(fn))
        chain = next.catch(() => {})
        return next
    }
    return db
}

const storedBookings = db =>
    [...db.docs.entries()]
        .filter(([path]) => path.startsWith('users/user-1/bookings/'))
        .map(([path, data]) => ({ id: path.split('/').pop(), ...data }))

describe('public booking API', () => {
    const page = {
        slug: 'karsten-wysk',
        userId: 'user-1',
        profile: { displayName: 'Karsten Wysk' },
        settings: {
            durationMinutes: 30,
            availableDurations: [15, 30, 60],
            slotIntervalMinutes: 30,
            workingHoursStart: '09:00',
            workingHoursEnd: '17:00',
            includeWeekends: false,
            bufferBeforeMinutes: 0,
            bufferAfterMinutes: 0,
            timeZone: 'Europe/Berlin',
        },
    }
    let db

    const bookBody = (overrides = {}) => ({
        slug: 'karsten-wysk',
        start: SLOT_START,
        end: SLOT_END,
        timeZone: 'Europe/Berlin',
        visitorName: 'Visitor',
        visitorEmail: 'visitor@example.com',
        ...overrides,
    })
    const postBook = async (body, headers = {}) => {
        const res = createResponse()
        await bookingApiHandler(createRequest({ method: 'POST', path: '/book', body, headers }), res)
        return res
    }

    beforeEach(() => {
        jest.clearAllMocks()
        db = serializeTransactions(createFakeFirestore())
        admin.firestore.mockReturnValue(db)
        bookingSettings.getPublicBookingPage.mockResolvedValue(page)
        bookingSettings.getConnectedCalendarCount.mockResolvedValue(1)
        bookingSettings.resolveEarliestBookableStart.mockReturnValue(null)
        bookingSettings.findPublicBookingSlots.mockResolvedValue({
            success: true,
            timeZone: 'Europe/Berlin',
            durationMinutes: 30,
            options: [{ start: SLOT_START, end: SLOT_END }],
        })
        createCalendarEventForAssistantRequest.mockResolvedValue({
            success: true,
            provider: 'google',
            calendarId: 'primary',
            event: { eventId: 'event-1', htmlLink: 'https://calendar.example/event-1' },
            joinUrl: 'https://meet.google.com/abc-defg-hij',
            joinProvider: 'google_meet',
        })
    })

    test('returns not found for unknown booking pages', async () => {
        bookingSettings.getPublicBookingPage.mockResolvedValue(null)
        const res = createResponse()

        await bookingApiHandler(createRequest({ path: '/page/missing' }), res)

        expect(res.statusCode).toBe(404)
        expect(res.body.success).toBe(false)
        expect(res.body.code).toBe('not_found')
    })

    test('never exposes the host minimum free hours or fixed guests to visitors (AT-2278)', async () => {
        // The rule is enforced server-side in findPublicBookingSlots. Publishing it would
        // tell any stranger how loaded the host's calendar is.
        bookingSettings.getPublicBookingPage.mockResolvedValue({
            ...page,
            settings: { ...page.settings, minFreeHoursPerDay: 4, additionalGuestEmails: ['cfo@example.com'] },
        })
        const res = createResponse()

        await bookingApiHandler(createRequest({ path: '/page/karsten-wysk' }), res)

        expect(res.statusCode).toBe(200)
        expect(res.body.page.settings).not.toHaveProperty('minFreeHoursPerDay')
        expect(res.body.page.settings).not.toHaveProperty('additionalGuestEmails')
        expect(JSON.stringify(res.body)).not.toContain('cfo@example.com')
        expect(res.body.page).not.toHaveProperty('userId')
    })

    test('tells agents the booking URL and the request limits (AT-3161)', async () => {
        const res = createResponse()

        await bookingApiHandler(createRequest({ path: '/page/karsten-wysk' }), res)

        expect(res.body.page.bookingUrl).toBe('https://my.alldone.app/meet/karsten-wysk')
        expect(res.body.page.limits).toEqual({ maxRangeDays: 31, maxOptionsPerRequest: 96 })
    })

    test('rejects booking without visitor name and email', async () => {
        const res = await postBook({ slug: 'karsten-wysk', start: SLOT_START, end: SLOT_END })

        expect(res.statusCode).toBe(400)
        expect(res.body.code).toBe('invalid_visitor')
        expect(createCalendarEventForAssistantRequest).not.toHaveBeenCalled()
    })

    test('returns conflict when selected slot is no longer available', async () => {
        bookingSettings.findPublicBookingSlots.mockResolvedValue({
            success: true,
            timeZone: 'Europe/Berlin',
            options: [],
        })

        const res = await postBook(bookBody())

        expect(res.statusCode).toBe(409)
        expect(res.body.code).toBe('slot_unavailable')
        expect(createCalendarEventForAssistantRequest).not.toHaveBeenCalled()
    })

    describe('same-day booking rule (AT-2271)', () => {
        test('exposes the flag on the public page, defaulting to false', async () => {
            const res = createResponse()

            await bookingApiHandler(createRequest({ path: '/page/karsten-wysk' }), res)

            // The page doc predates the setting, so the visitor page must read false.
            expect(res.body.page.settings.allowSameDayBooking).toBe(false)
        })

        test('exposes the flag as true once the host opts in', async () => {
            bookingSettings.getPublicBookingPage.mockResolvedValue({
                ...page,
                settings: { ...page.settings, allowSameDayBooking: true },
            })
            const res = createResponse()

            await bookingApiHandler(createRequest({ path: '/page/karsten-wysk' }), res)

            expect(res.body.page.settings.allowSameDayBooking).toBe(true)
        })

        test('refuses a same-day booking posted straight to the API', async () => {
            // The visitor page never offers today, but nothing stops a direct POST.
            bookingSettings.resolveEarliestBookableStart.mockReturnValue(moment.parseZone('2030-06-19T00:00:00+02:00'))

            const res = await postBook(bookBody())

            expect(res.statusCode).toBe(409)
            expect(res.body.code).toBe('same_day_not_allowed')
            expect(res.body.error).toMatch(/same-day/i)
            // Rejected before the availability re-check, so no calendar work happens at all.
            expect(bookingSettings.findPublicBookingSlots).not.toHaveBeenCalled()
            expect(createCalendarEventForAssistantRequest).not.toHaveBeenCalled()
        })

        test('allows a booking at or after the earliest bookable instant', async () => {
            bookingSettings.resolveEarliestBookableStart.mockReturnValue(moment.parseZone('2030-06-18T00:00:00+02:00'))

            const res = await postBook(bookBody())

            expect(res.statusCode).toBe(200)
            expect(createCalendarEventForAssistantRequest).toHaveBeenCalled()
        })
    })

    // Security audit 2026-11 (#10): /book mails an address the caller chose; it is rate limited
    // before the calendar is touched or anything is sent.
    test('refuses a rate-limited booking without creating an event or sending mail', async () => {
        mockConsumeBookingQuota.mockResolvedValueOnce({ allowed: false, limitedBy: 'recipient' })

        const res = await postBook(bookBody({ visitorEmail: 'Victim@Example.com' }), { 'x-forwarded-for': '1.2.3.4' })

        expect(res.statusCode).toBe(429)
        expect(res.body.code).toBe('rate_limited')
        expect(mockConsumeBookingQuota).toHaveBeenCalledWith(expect.anything(), {
            ip: '1.2.3.4',
            pageUserId: 'user-1',
            slug: 'karsten-wysk',
            recipientEmail: 'victim@example.com',
        })
        expect(createCalendarEventForAssistantRequest).not.toHaveBeenCalled()
        expect(bookingEmails.sendBookingConfirmationToVisitor).not.toHaveBeenCalled()
        expect(bookingEmails.sendBookingNotificationToHost).not.toHaveBeenCalled()
    })

    test('creates a calendar event and booking record on success', async () => {
        const res = await postBook(bookBody({ note: 'Intro call', client: 'alldone-web' }))

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
        const [booking] = storedBookings(db)
        expect(booking).toEqual(
            expect.objectContaining({
                status: 'confirmed',
                visitorEmail: 'visitor@example.com',
                startMs: moment.parseZone(SLOT_START).valueOf(),
                endMs: moment.parseZone(SLOT_END).valueOf(),
                bookedVia: 'web',
            })
        )
        expect(res.body.bookingId).toBe(booking.id)
        expect(res.body.status).toBe('confirmed')
        // The lock is released once the booking is stored.
        expect(db.docs.has(`bookingLocks/${lockDocId('user-1')}`)).toBe(false)
    })

    // AT-2198: a booked meeting must carry a join link everywhere the booking is
    // represented — the stored record, both emails, and the API response.
    describe('meeting join link', () => {
        test('persists the join link on the booking record', async () => {
            await postBook(bookBody())

            expect(storedBookings(db)[0].event).toEqual(
                expect.objectContaining({
                    joinUrl: 'https://meet.google.com/abc-defg-hij',
                    joinProvider: 'google_meet',
                })
            )
        })

        test('sends the join link to both the host and the visitor', async () => {
            const res = await postBook(bookBody())

            expect(bookingEmails.sendBookingNotificationToHost).toHaveBeenCalledWith(
                expect.objectContaining({ joinUrl: 'https://meet.google.com/abc-defg-hij' })
            )
            expect(bookingEmails.sendBookingConfirmationToVisitor).toHaveBeenCalledWith(
                expect.objectContaining({ joinUrl: 'https://meet.google.com/abc-defg-hij' })
            )
            expect(res.body.joinUrl).toBe('https://meet.google.com/abc-defg-hij')
        })

        // Conferencing is best-effort: a provider that refuses to create a
        // conference must not turn into a failed booking.
        test('still confirms the booking when no join link could be created', async () => {
            createCalendarEventForAssistantRequest.mockResolvedValue({
                success: true,
                provider: 'google',
                calendarId: 'primary',
                event: { eventId: 'event-1', htmlLink: 'https://calendar.example/event-1' },
                joinUrl: '',
                joinProvider: '',
            })

            const res = await postBook(bookBody())

            expect(res.statusCode).toBe(200)
            expect(res.body.success).toBe(true)
            expect(res.body.joinUrl).toBe('')
            expect(storedBookings(db)[0]).toEqual(
                expect.objectContaining({ status: 'confirmed', event: expect.objectContaining({ joinUrl: '' }) })
            )
            expect(bookingEmails.sendBookingConfirmationToVisitor).toHaveBeenCalledWith(
                expect.objectContaining({ joinUrl: '' })
            )
        })
    })

    describe('timezones (AT-3161)', () => {
        test('the event is in the host timezone, the visitor mail in the visitor timezone', async () => {
            const res = await postBook(bookBody({ timeZone: 'America/New_York' }))

            expect(res.statusCode).toBe(200)
            expect(createCalendarEventForAssistantRequest).toHaveBeenCalledWith(
                expect.objectContaining({ timeZone: 'Europe/Berlin' })
            )
            expect(bookingEmails.sendBookingNotificationToHost).toHaveBeenCalledWith(
                expect.objectContaining({ timeZone: 'Europe/Berlin' })
            )
            expect(bookingEmails.sendBookingConfirmationToVisitor).toHaveBeenCalledWith(
                expect.objectContaining({ timeZone: 'America/New_York' })
            )
            // The re-check runs in the host zone, whatever the visitor sent.
            expect(bookingSettings.findPublicBookingSlots).toHaveBeenCalledWith(
                page,
                expect.objectContaining({ timeZone: 'Europe/Berlin', start: '2030-06-18T00:00:00+02:00' })
            )
            expect(storedBookings(db)[0]).toEqual(
                expect.objectContaining({ timeZone: 'Europe/Berlin', visitorTimeZone: 'America/New_York' })
            )
        })

        test('refuses an unknown timezone instead of ignoring it', async () => {
            const res = await postBook(bookBody({ timeZone: 'Mars/Olympus' }))

            expect(res.statusCode).toBe(400)
            expect(res.body.code).toBe('invalid_timezone')
            expect(createCalendarEventForAssistantRequest).not.toHaveBeenCalled()
        })
    })

    describe('validation for direct API and agent calls (AT-3161)', () => {
        test('refuses a duration the page does not offer', async () => {
            const res = await postBook(bookBody({ durationMinutes: 45 }))

            expect(res.statusCode).toBe(400)
            expect(res.body.code).toBe('invalid_duration')
            expect(res.body.availableDurations).toEqual([15, 30, 60])
            expect(mockConsumeBookingQuota).not.toHaveBeenCalled()
        })

        test('refuses a slot that already started', async () => {
            // The suite's Date.now() is pinned, so the clock is passed in.
            const result = await bookPublicMeeting({
                ...bookBody(),
                ip: '1.2.3.4',
                now: () => moment.parseZone('2030-06-18T09:05:00+02:00').valueOf(),
            })

            expect(result.status).toBe(409)
            expect(result.body.code).toBe('slot_in_past')
            expect(createCalendarEventForAssistantRequest).not.toHaveBeenCalled()
        })

        test('refuses a malformed idempotency key', async () => {
            const res = await postBook(bookBody({ idempotencyKey: 'short' }))

            expect(res.statusCode).toBe(400)
            expect(res.body.code).toBe('invalid_request')
        })
    })

    describe('who booked (AT-3161)', () => {
        test('a direct API booking is labelled for the host, a web booking is not', async () => {
            await postBook(bookBody())

            expect(createCalendarEventForAssistantRequest.mock.calls[0][0].description).toContain(
                'Booked through the public booking API (possibly by an AI agent).'
            )
            expect(bookingEmails.sendBookingNotificationToHost).toHaveBeenCalledWith(
                expect.objectContaining({ bookedViaText: expect.stringContaining('public booking API') })
            )
            expect(storedBookings(db)[0].bookedVia).toBe('api')

            jest.clearAllMocks()
            db.docs.clear()
            await postBook(bookBody({ client: 'alldone-web', visitorEmail: 'second@example.com' }))
            expect(createCalendarEventForAssistantRequest.mock.calls[0][0].description).not.toContain('AI agent')
            expect(bookingEmails.sendBookingNotificationToHost).toHaveBeenCalledWith(
                expect.objectContaining({ bookedViaText: '' })
            )
        })
    })

    describe('double-booking protection (AT-3161)', () => {
        test('two concurrent requests for the same slot create exactly one event', async () => {
            // The calendar's free/busy answer lags: it still offers the slot after the first insert.
            let releaseFirstInsert
            createCalendarEventForAssistantRequest.mockImplementationOnce(
                () =>
                    new Promise(resolve => {
                        releaseFirstInsert = () =>
                            resolve({ success: true, provider: 'google', event: { eventId: 'e1' }, joinUrl: '' })
                    })
            )

            const first = postBook(bookBody({ visitorEmail: 'first@example.com' }))
            // Let the first request take the lock and reach the calendar insert.
            for (let i = 0; i < 50 && !releaseFirstInsert; i += 1) await new Promise(r => setImmediate(r))
            const second = postBook(bookBody({ visitorEmail: 'second@example.com' }))
            await new Promise(r => setTimeout(r, 50))
            releaseFirstInsert()

            const [firstRes, secondRes] = await Promise.all([first, second])

            expect(firstRes.statusCode).toBe(200)
            expect(secondRes.statusCode).toBe(409)
            expect(secondRes.body.code).toBe('slot_unavailable')
            expect(createCalendarEventForAssistantRequest).toHaveBeenCalledTimes(1)
            expect(storedBookings(db)).toHaveLength(1)
        })

        test('a stored booking blocks an overlapping slot, including the host buffers', async () => {
            bookingSettings.getPublicBookingPage.mockResolvedValue({
                ...page,
                settings: { ...page.settings, bufferAfterMinutes: 15 },
            })
            await db.doc('users/user-1/bookings/existing').set({
                status: 'confirmed',
                createdAtMs: Date.now() - 60 * 1000,
                startMs: moment.parseZone('2030-06-18T08:30:00+02:00').valueOf(),
                endMs: moment.parseZone('2030-06-18T08:50:00+02:00').valueOf(),
            })

            const res = await postBook(bookBody())

            expect(res.statusCode).toBe(409)
            expect(res.body.code).toBe('slot_unavailable')
            expect(createCalendarEventForAssistantRequest).not.toHaveBeenCalled()
        })

        test('an older stored booking does not block: the calendar is the truth once it caught up', async () => {
            // The host deleted the booked event in the calendar; free/busy says the slot is free.
            await db.doc('users/user-1/bookings/old').set({
                status: 'confirmed',
                createdAtMs: Date.now() - 20 * 60 * 1000,
                startMs: moment.parseZone(SLOT_START).valueOf(),
                endMs: moment.parseZone(SLOT_END).valueOf(),
            })

            const res = await postBook(bookBody())

            expect(res.statusCode).toBe(200)
        })

        test('a cancelled or non-overlapping stored booking does not block', async () => {
            await db.doc('users/user-1/bookings/cancelled').set({
                status: 'cancelled',
                startMs: moment.parseZone(SLOT_START).valueOf(),
                endMs: moment.parseZone(SLOT_END).valueOf(),
            })
            await db.doc('users/user-1/bookings/earlier').set({
                status: 'confirmed',
                createdAtMs: Date.now(),
                startMs: moment.parseZone('2030-06-18T08:30:00+02:00').valueOf(),
                endMs: moment.parseZone('2030-06-18T09:00:00+02:00').valueOf(),
            })

            const res = await postBook(bookBody())

            expect(res.statusCode).toBe(200)
        })

        test('answers busy when another booking of the host holds the lock', async () => {
            await db.doc(`bookingLocks/${lockDocId('user-1')}`).set({ token: 'other', leaseUntil: Date.now() + 60000 })

            const result = await bookPublicMeeting({
                ...bookBody(),
                ip: '1.2.3.4',
                lockOptions: { waitMs: 0 },
            })

            expect(result.status).toBe(409)
            expect(result.body.code).toBe('busy')
            expect(createCalendarEventForAssistantRequest).not.toHaveBeenCalled()
        })

        test('an expired lock of a crashed request does not block the host', async () => {
            await db.doc(`bookingLocks/${lockDocId('user-1')}`).set({ token: 'dead', leaseUntil: Date.now() - 1 })

            const res = await postBook(bookBody())

            expect(res.statusCode).toBe(200)
        })
    })

    describe('idempotent retries (AT-3161)', () => {
        test('a retry with the same key returns the first booking without a second event or mail', async () => {
            const first = await postBook(bookBody({ idempotencyKey: 'agent-retry-key-1' }))
            jest.clearAllMocks()

            const retry = await postBook(bookBody({ idempotencyKey: 'agent-retry-key-1' }))

            expect(first.statusCode).toBe(200)
            expect(retry.statusCode).toBe(200)
            expect(retry.body.bookingId).toBe(first.body.bookingId)
            expect(retry.body.idempotentReplay).toBe(true)
            expect(retry.body.joinUrl).toBe('https://meet.google.com/abc-defg-hij')
            expect(createCalendarEventForAssistantRequest).not.toHaveBeenCalled()
            expect(bookingEmails.sendBookingConfirmationToVisitor).not.toHaveBeenCalled()
            expect(mockConsumeBookingQuota).not.toHaveBeenCalled()
            expect(storedBookings(db)).toHaveLength(1)
            // Only a hash of the key is stored.
            expect(JSON.stringify(storedBookings(db))).not.toContain('agent-retry-key-1')
        })

        test('reusing a key for a different booking is refused', async () => {
            await postBook(bookBody({ idempotencyKey: 'agent-retry-key-2' }))

            const res = await postBook(
                bookBody({
                    idempotencyKey: 'agent-retry-key-2',
                    start: '2030-06-18T10:00:00+02:00',
                    end: '2030-06-18T10:30:00+02:00',
                })
            )

            expect(res.statusCode).toBe(409)
            expect(res.body.code).toBe('idempotency_conflict')
        })
    })

    describe('GET /slots (AT-3161)', () => {
        const getSlots = async (query, headers = {}) => {
            const res = createResponse()
            await bookingApiHandler(createRequest({ path: '/slots', query, headers }), res)
            return res
        }

        test('refuses ranges over 31 days before reading any calendar', async () => {
            const res = await getSlots({
                slug: 'karsten-wysk',
                start: '2030-06-01T00:00:00+02:00',
                end: '2030-07-15T00:00:00+02:00',
            })

            expect(res.statusCode).toBe(400)
            expect(res.body.code).toBe('range_too_long')
            expect(bookingSettings.findPublicBookingSlots).not.toHaveBeenCalled()
        })

        test('is rate limited per IP and page', async () => {
            mockConsumeSlotLookupQuota.mockResolvedValueOnce({ allowed: false, limitedBy: 'slotsIp' })

            const res = await getSlots(
                { slug: 'karsten-wysk', start: '2030-06-18T00:00:00+02:00', end: '2030-06-19T00:00:00+02:00' },
                { 'x-forwarded-for': '9.9.9.9' }
            )

            expect(res.statusCode).toBe(429)
            expect(mockConsumeSlotLookupQuota).toHaveBeenCalledWith(expect.anything(), {
                ip: '9.9.9.9',
                pageUserId: 'user-1',
                slug: 'karsten-wysk',
            })
            expect(bookingSettings.findPublicBookingSlots).not.toHaveBeenCalled()
        })

        test('returns host-zone options plus the same instants in the requested display zone', async () => {
            const res = await getSlots({
                slug: 'karsten-wysk',
                start: '2030-06-18T00:00:00+02:00',
                end: '2030-06-19T00:00:00+02:00',
                timeZone: 'America/New_York',
                durationMinutes: '30',
            })

            expect(res.statusCode).toBe(200)
            expect(res.body).toEqual({
                success: true,
                timeZone: 'Europe/Berlin',
                displayTimeZone: 'America/New_York',
                durationMinutes: 30,
                truncated: false,
                options: [
                    {
                        start: SLOT_START,
                        end: SLOT_END,
                        displayStart: '2030-06-18T03:00:00-04:00',
                        displayEnd: '2030-06-18T03:30:00-04:00',
                    },
                ],
            })
        })

        test('says when the option list was cut and where to continue', async () => {
            const options = Array.from({ length: 96 }, (_, index) => {
                const start = moment.parseZone(SLOT_START).add(index * 30, 'minutes')
                return { start: start.format(), end: start.clone().add(30, 'minutes').format() }
            })
            bookingSettings.findPublicBookingSlots.mockResolvedValue({
                success: true,
                timeZone: 'Europe/Berlin',
                durationMinutes: 30,
                options,
            })

            const res = await getSlots({
                slug: 'karsten-wysk',
                start: '2030-06-18T00:00:00+02:00',
                end: '2030-07-10T00:00:00+02:00',
            })

            expect(res.body.truncated).toBe(true)
            expect(res.body.nextSearchStart).toBe(options[95].end)
        })

        test('reports a calendar that cannot be read without revealing anything about it', async () => {
            bookingSettings.findPublicBookingSlots.mockResolvedValue({
                success: false,
                options: [],
                message: 'Calendar availability could not be checked completely.',
            })

            const res = await getSlots({
                slug: 'karsten-wysk',
                start: '2030-06-18T00:00:00+02:00',
                end: '2030-06-19T00:00:00+02:00',
            })

            expect(res.statusCode).toBe(409)
            expect(res.body.code).toBe('calendar_unavailable')
            expect(res.body.options).toEqual([])
        })
    })
})
