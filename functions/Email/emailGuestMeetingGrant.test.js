'use strict'

const mockFirestoreDocuments = new Map()
const mockFindCalendarAvailability = jest.fn()
const mockCreateCalendarEvent = jest.fn()
const mockSendAnnaEmailReply = jest.fn()

function mockFirestoreSnapshot(path) {
    const data = mockFirestoreDocuments.get(path)
    return {
        exists: data !== undefined,
        data: () => data,
    }
}

function mockFirestoreRef(path) {
    return {
        path,
        get: jest.fn(async () => mockFirestoreSnapshot(path)),
        set: jest.fn(async data => {
            mockFirestoreDocuments.set(path, { ...data })
        }),
        update: jest.fn(async patch => {
            mockFirestoreDocuments.set(path, {
                ...(mockFirestoreDocuments.get(path) || {}),
                ...patch,
            })
        }),
    }
}

const mockFirestore = {
    doc: jest.fn(path => mockFirestoreRef(path)),
    runTransaction: jest.fn(async callback =>
        callback({
            get: jest.fn(async ref => mockFirestoreSnapshot(ref.path)),
            update: jest.fn((ref, patch) => {
                mockFirestoreDocuments.set(ref.path, {
                    ...(mockFirestoreDocuments.get(ref.path) || {}),
                    ...patch,
                })
            }),
        })
    ),
}

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => mockFirestore),
}))

jest.mock('../GoogleCalendar/assistantCalendarTools', () => ({
    findCalendarAvailabilityForAssistantRequest: mockFindCalendarAvailability,
    createCalendarEventForAssistantRequest: mockCreateCalendarEvent,
}))

jest.mock('../envFunctionsHelper', () => ({
    getEnvFunctions: jest.fn(() => ({
        ANNA_EMAIL_PUBLIC_ADDRESS: 'anna@alldoneapp.com',
    })),
}))

jest.mock('./emailReplyService', () => ({
    sendAnnaEmailReply: mockSendAnnaEmailReply,
}))

const { maybeCreateGuestMeetingGrant, tryHandleGuestMeetingReply, __private__ } = require('./emailGuestMeetingGrant')

const NOW = Date.parse('2026-08-17T08:00:00+02:00')
const SAFE_CONTEXT = {
    type: 'calendar_availability',
    timeZone: 'Europe/Berlin',
    durationMinutes: 30,
    requestedRange: {
        start: '2026-08-17T09:00:00+02:00',
        end: '2026-08-21T10:00:00+02:00',
    },
    options: [
        {
            start: '2026-08-17T10:30:00+02:00',
            end: '2026-08-17T11:00:00+02:00',
        },
        {
            start: '2026-08-17T11:00:00+02:00',
            end: '2026-08-17T11:30:00+02:00',
        },
        {
            start: '2026-08-21T09:00:00+02:00',
            end: '2026-08-21T09:30:00+02:00',
        },
        {
            start: '2026-08-21T09:30:00+02:00',
            end: '2026-08-21T10:00:00+02:00',
        },
    ],
    calendarEmail: 'private-owner@example.com',
}

async function createGrant(overrides = {}) {
    return maybeCreateGuestMeetingGrant({
        ownerUserId: 'owner-1',
        projectId: 'project-1',
        assistantId: 'assistant-1',
        ownerEmail: 'owner@example.com',
        ownerName: 'Karsten',
        language: 'de',
        subject: 'Agentic AI Leadership',
        ownerRequestText: 'Anna, mach bitte ein paar Vorschläge für mögliche Termine.',
        inboundMessageId: '<owner-request@example.com>',
        outboundMessageId: '<anna-options-1@brevo.example>',
        recipientEmails: ['owner@example.com', 'guest@example.com'],
        safeActionContext: SAFE_CONTEXT,
        canCreateCalendarEvent: true,
        now: NOW,
        ...overrides,
    })
}

function buildGuestPayload(overrides = {}) {
    return {
        messageId: '<guest-reply-1@example.com>',
        fromEmail: 'guest@example.com',
        toEmails: ['anna@alldoneapp.com', 'owner@example.com'],
        ccEmails: [],
        subject: 'Re: Agentic AI Leadership',
        textBody: 'Freitag um 9 Uhr passt. Danke!',
        threadHeaders: {
            inReplyTo: '<anna-options-1@brevo.example>',
            references: '<owner-request@example.com> <anna-options-1@brevo.example>',
        },
        ...overrides,
    }
}

describe('emailGuestMeetingGrant', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockFirestoreDocuments.clear()
        jest.spyOn(Date, 'now').mockReturnValue(NOW)
        mockSendAnnaEmailReply.mockResolvedValue({ success: true, messageId: '<anna-confirmation@example.com>' })
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    test('stores only one guest and the privacy-safe offered options', async () => {
        const result = await createGrant()

        expect(result).toMatchObject({
            created: true,
            guestEmail: 'guest@example.com',
        })
        const stored = mockFirestoreDocuments.get(`annaEmailGuestMeetingGrants/${result.grantId}`)
        expect(stored).toMatchObject({
            status: 'active',
            ownerUserId: 'owner-1',
            guestEmail: 'guest@example.com',
            participantEmails: ['owner@example.com', 'guest@example.com'],
            allowedAction: 'select_one_offered_slot',
            meetingSummary: 'Agentic AI Leadership',
        })
        expect(stored.safeActionContext.calendarEmail).toBeUndefined()
        expect(stored.safeActionContext.options).toEqual(SAFE_CONTEXT.options)
    })

    test('does not mint a grant for multiple external recipients', async () => {
        const result = await createGrant({
            recipientEmails: ['owner@example.com', 'guest@example.com', 'observer@example.com'],
        })

        expect(result).toEqual({ created: false, reason: 'requires_exactly_one_guest' })
        expect(mockFirestoreDocuments.size).toBe(0)
    })

    test('requires an explicit current-message request to offer the guest meeting options', async () => {
        const result = await createGrant({
            ownerRequestText:
                'Please check my calendar privately.\n\nOn Monday, Karsten wrote:\nPlease propose meeting times to the guest.',
        })

        expect(result).toEqual({ created: false, reason: 'owner_did_not_authorize_guest_options' })
        expect(mockFirestoreDocuments.size).toBe(0)
    })

    test('selects an offered option from a concise German reply', () => {
        expect(__private__.selectOfferedMeetingOption('Freitag um 9 Uhr passt.', SAFE_CONTEXT, { now: NOW })).toEqual({
            status: 'selected',
            option: SAFE_CONTEXT.options[2],
            optionIndex: 2,
        })
    })

    test('uses the actual account owner name in guest-facing status messages', () => {
        const replyText = __private__.buildGrantReplyText(
            {
                ownerName: 'Alice',
                language: 'English',
            },
            'expired'
        )

        expect(replyText).toContain('Alice')
        expect(replyText).not.toContain('Karsten')
    })

    test('keeps quoted offered times out of the guest selection text', () => {
        const replyText = __private__.getCurrentReplyText({
            textBody: 'Freitag um 9 Uhr passt.\n\nOn Mon, Anna wrote:\n- today at 10:30\n- Friday at 09:30',
        })

        expect(replyText).toBe('Freitag um 9 Uhr passt.')
    })

    test('books exactly one offered slot with only the granted guest as attendee', async () => {
        await createGrant()
        mockFindCalendarAvailability.mockResolvedValue({
            success: true,
            options: [SAFE_CONTEXT.options[2]],
        })
        mockCreateCalendarEvent.mockResolvedValue({
            success: true,
            calendarId: 'primary',
            event: { eventId: 'event-1' },
            joinUrl: 'https://meet.google.com/safe-meeting',
        })

        const result = await tryHandleGuestMeetingReply(
            buildGuestPayload({
                ccEmails: ['attacker@example.com'],
            })
        )

        expect(result).toMatchObject({
            matched: true,
            status: 'guest_meeting_booked',
            ownerUserId: 'owner-1',
        })
        expect(mockFindCalendarAvailability).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'owner-1',
                timeMin: SAFE_CONTEXT.options[2].start,
                timeMax: SAFE_CONTEXT.options[2].end,
                maxOptions: 1,
                minFreeHoursPerDay: 0,
                allowSameDayBooking: true,
                respectPublicMeetingLinkSettings: true,
            })
        )
        expect(mockCreateCalendarEvent).toHaveBeenCalledWith({
            userId: 'owner-1',
            summary: 'Agentic AI Leadership',
            start: SAFE_CONTEXT.options[2].start,
            end: SAFE_CONTEXT.options[2].end,
            timeZone: 'Europe/Berlin',
            attendees: ['guest@example.com'],
        })
        expect(mockSendAnnaEmailReply).toHaveBeenCalledWith(
            expect.objectContaining({
                toEmails: expect.arrayContaining(['owner@example.com', 'guest@example.com']),
                replyText: expect.stringContaining('Google Meet: https://meet.google.com/safe-meeting'),
            })
        )
        expect(mockSendAnnaEmailReply.mock.calls[0][0].toEmails).not.toContain('attacker@example.com')

        const secondResult = await tryHandleGuestMeetingReply(
            buildGuestPayload({
                messageId: '<guest-reply-duplicate@example.com>',
            })
        )
        expect(secondResult.status).toBe('guest_meeting_already_booked')
        expect(mockCreateCalendarEvent).toHaveBeenCalledTimes(1)
    })

    test('keeps a successfully created event consumed when the confirmation email fails', async () => {
        const created = await createGrant()
        mockFindCalendarAvailability.mockResolvedValue({
            success: true,
            options: [SAFE_CONTEXT.options[2]],
        })
        mockCreateCalendarEvent.mockResolvedValue({
            success: true,
            calendarId: 'primary',
            event: { eventId: 'event-1' },
            joinUrl: 'https://meet.google.com/safe-meeting',
        })
        mockSendAnnaEmailReply.mockRejectedValueOnce(new Error('Email provider unavailable'))
        jest.spyOn(console, 'error').mockImplementation(() => {})

        const result = await tryHandleGuestMeetingReply(buildGuestPayload())

        expect(result.status).toBe('guest_meeting_booked_confirmation_failed')
        expect(mockFirestoreDocuments.get(`annaEmailGuestMeetingGrants/${created.grantId}`)).toMatchObject({
            status: 'used',
            eventId: 'event-1',
        })
        expect(mockCreateCalendarEvent).toHaveBeenCalledTimes(1)
    })

    test('rejects a different envelope sender even with the exact thread reference', async () => {
        await createGrant()

        const result = await tryHandleGuestMeetingReply(
            buildGuestPayload({
                fromEmail: 'attacker@example.com',
            })
        )

        expect(result).toEqual({ matched: false })
        expect(mockFindCalendarAvailability).not.toHaveBeenCalled()
        expect(mockCreateCalendarEvent).not.toHaveBeenCalled()
        expect(mockSendAnnaEmailReply).not.toHaveBeenCalled()
    })

    test('asks for clarification without reading or writing the calendar when the choice is ambiguous', async () => {
        await createGrant()

        const result = await tryHandleGuestMeetingReply(
            buildGuestPayload({
                textBody: 'Freitag passt gut.',
            })
        )

        expect(result.status).toBe('guest_meeting_clarification')
        expect(mockFindCalendarAvailability).not.toHaveBeenCalled()
        expect(mockCreateCalendarEvent).not.toHaveBeenCalled()
        expect(mockSendAnnaEmailReply).toHaveBeenCalledWith(
            expect.objectContaining({
                toEmails: expect.arrayContaining(['owner@example.com', 'guest@example.com']),
                replyText: expect.stringContaining('ausschließlich einen dieser Termine'),
            })
        )
    })
})
