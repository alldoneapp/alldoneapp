'use strict'

jest.mock('firebase-admin', () => ({
    firestore: Object.assign(jest.fn(), {
        Timestamp: {
            now: jest.fn(() => ({ seconds: 0, nanoseconds: 0 })),
        },
        FieldValue: {
            increment: jest.fn(value => value),
        },
    }),
}))

jest.mock('../Users/usersFirestore', () => ({
    getUserData: jest.fn(),
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    FEED_PUBLIC_FOR_ALL: 'ALL',
    STAYWARD_COMMENT: 'STAYWARD_COMMENT',
}))

jest.mock('../Assistant/contextTimestampHelper', () => ({
    addTimestampToContextContent: jest.fn(content => content),
}))

jest.mock('../Assistant/contextLimits', () => ({
    THREAD_CONTEXT_MESSAGE_LIMIT: 20,
}))

const admin = require('firebase-admin')
const moment = require('moment')
const { getUserData } = require('../Users/usersFirestore')
const {
    getEmailCalendarEventsCreatedByAssistant,
    getLatestSafeEmailActionContext,
    getOrCreateDailyEmailTopic,
    storeEmailAssistantMessageInTopic,
} = require('./emailDailyTopic')

function setCommentDocs(comments) {
    admin.firestore.mockReturnValue({
        collection: jest.fn(() => ({
            orderBy: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue({
                docs: comments.map(comment => ({
                    data: () => comment,
                })),
            }),
        })),
    })
}

function setChatDoc({ exists = false, data = {} } = {}) {
    const chatRef = {
        get: jest.fn().mockResolvedValue({
            exists,
            data: () => data,
        }),
        set: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
    }
    const doc = jest.fn(() => chatRef)
    admin.firestore.mockReturnValue({ doc })
    return { chatRef, doc }
}

describe('emailDailyTopic participant-scoped routing', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        getUserData.mockResolvedValue({
            displayName: 'Karsten Wysk',
            email: 'owner@example.com',
        })
    })

    test('uses the same group topic for the same participant set regardless of order', async () => {
        const { chatRef } = setChatDoc()

        const first = await getOrCreateDailyEmailTopic('user-1', 'project-1', 'assistant-1', {
            ownerEmail: 'owner@example.com',
            participantEmails: ['owner@example.com', 'peter.mueller@example.com'],
        })
        const second = await getOrCreateDailyEmailTopic('user-1', 'project-1', 'assistant-1', {
            ownerEmail: 'owner@example.com',
            participantEmails: ['peter.mueller@example.com', 'owner@example.com'],
        })
        const differentGroup = await getOrCreateDailyEmailTopic('user-1', 'project-1', 'assistant-1', {
            ownerEmail: 'owner@example.com',
            participantEmails: ['owner@example.com', 'carol@example.com'],
        })

        expect(first.chatId).toBe(second.chatId)
        expect(first.chatId).not.toBe(differentGroup.chatId)
        expect(first.chatId).toContain('Group')
        expect(first.isParticipantScopedTopic).toBe(true)
        expect(chatRef.set).toHaveBeenCalledWith(
            expect.objectContaining({
                title: `Daily email Anna <> Karsten, Peter Mueller ${moment().format('DD MMM YYYY')}`,
                emailParticipantEmails: ['owner@example.com', 'peter.mueller@example.com'],
                emailParticipantNames: ['Anna', 'Karsten', 'Peter Mueller'],
                isEmailParticipantScoped: true,
            })
        )
    })

    test('keeps direct email interactions in their own participant-scoped daily topic', async () => {
        const { chatRef } = setChatDoc()

        const direct = await getOrCreateDailyEmailTopic('user-1', 'project-1', 'assistant-1', {
            ownerEmail: 'owner@example.com',
            participantEmails: ['owner@example.com'],
        })
        const group = await getOrCreateDailyEmailTopic('user-1', 'project-1', 'assistant-1', {
            ownerEmail: 'owner@example.com',
            participantEmails: ['owner@example.com', 'peter@example.com'],
        })

        expect(direct.chatId).toContain('Direct')
        expect(direct.chatId).not.toBe(group.chatId)
        expect(chatRef.set).toHaveBeenCalledWith(
            expect.objectContaining({
                title: `Daily email Anna <> Karsten ${moment().format('DD MMM YYYY')}`,
                emailParticipantNames: ['Anna', 'Karsten'],
            })
        )
    })

    test('renames an existing participant-scoped topic to the current title format', async () => {
        const { chatRef } = setChatDoc({
            exists: true,
            data: {
                title: `Daily email <> Karsten ${moment().format('DD MMM YYYY')}`,
                emailParticipantScopeVersion: 1,
                emailParticipantKey: 'outdated-key',
            },
        })

        await getOrCreateDailyEmailTopic('user-1', 'project-1', 'assistant-1', {
            ownerEmail: 'owner@example.com',
            participantEmails: ['owner@example.com'],
        })

        expect(chatRef.update).toHaveBeenCalledWith(
            expect.objectContaining({
                title: `Daily email Anna <> Karsten ${moment().format('DD MMM YYYY')}`,
                emailParticipantNames: ['Anna', 'Karsten'],
            })
        )
    })
})

describe('emailDailyTopic safe follow-up context', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('returns only the immediately preceding assistant availability context for the same sender', async () => {
        setCommentDocs([
            {
                fromAssistant: false,
                commentText: 'Create the 13:30 meeting',
            },
            {
                fromAssistant: true,
                emailReplyMetadata: {
                    toEmail: 'owner@example.com',
                    safeActionContext: {
                        type: 'calendar_availability',
                        timeZone: 'Europe/Berlin',
                        durationMinutes: 30,
                        options: [
                            {
                                start: '2026-06-05T13:30:00+02:00',
                                end: '2026-06-05T14:00:00+02:00',
                                privateTitle: 'Private meeting',
                            },
                        ],
                        calendarEmail: 'private@example.com',
                    },
                },
            },
        ])

        await expect(getLatestSafeEmailActionContext('project-1', 'chat-1', 'owner@example.com')).resolves.toEqual({
            type: 'calendar_availability',
            timeZone: 'Europe/Berlin',
            durationMinutes: 30,
            options: [
                {
                    start: '2026-06-05T13:30:00+02:00',
                    end: '2026-06-05T14:00:00+02:00',
                },
            ],
        })
    })

    test('does not reuse context from a different sender', async () => {
        setCommentDocs([
            {
                fromAssistant: false,
                commentText: 'Create the meeting',
            },
            {
                fromAssistant: true,
                emailReplyMetadata: {
                    toEmail: 'other@example.com',
                    safeActionContext: {
                        type: 'calendar_availability',
                        options: [
                            {
                                start: '2026-06-05T13:30:00+02:00',
                                end: '2026-06-05T14:00:00+02:00',
                            },
                        ],
                    },
                },
            },
        ])

        await expect(getLatestSafeEmailActionContext('project-1', 'chat-1', 'owner@example.com')).resolves.toBeNull()
    })
})

describe('emailDailyTopic calendar events Anna created over email', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    function assistantReply(calendarEvents, overrides = {}) {
        return {
            fromAssistant: true,
            creatorId: 'assistant-1',
            emailReplyMetadata: { toEmail: 'owner@example.com', calendarEvents },
            ...overrides,
        }
    }

    // Comment docs are listed newest first, as the query orders them.
    test('collects the events from the assistant replies to the same sender, latest version last', async () => {
        setCommentDocs([
            { fromAssistant: false, commentText: 'Es geht um 16 Uhr los' },
            assistantReply([{ eventId: 'evt-1', summary: 'Lichterfest', start: { dateTime: '2026-11-13T16:00' } }]),
            { fromAssistant: false, commentText: 'Bitte im Kalender eintragen' },
            assistantReply([
                { eventId: 'evt-1', summary: 'Lichterfest', start: { date: '2026-11-13' } },
                { eventId: 'evt-2', summary: 'Elternabend' },
            ]),
        ])

        await expect(
            getEmailCalendarEventsCreatedByAssistant('project-1', 'chat-1', {
                assistantId: 'assistant-1',
                senderEmail: 'Owner@Example.com',
            })
        ).resolves.toEqual([
            { eventId: 'evt-2', summary: 'Elternabend' },
            { eventId: 'evt-1', summary: 'Lichterfest', start: { dateTime: '2026-11-13T16:00' } },
        ])
    })

    test('ignores replies the assistant did not write and replies to another sender', async () => {
        setCommentDocs([
            // A member can create a comment with no creatorId, but never one carrying the assistant's.
            assistantReply([{ eventId: 'planted-1' }], { creatorId: undefined }),
            assistantReply([{ eventId: 'planted-2' }], { creatorId: 'member-1' }),
            assistantReply([{ eventId: 'other-sender' }], {
                emailReplyMetadata: { toEmail: 'guest@example.com', calendarEvents: [{ eventId: 'other-sender' }] },
            }),
        ])

        await expect(
            getEmailCalendarEventsCreatedByAssistant('project-1', 'chat-1', {
                assistantId: 'assistant-1',
                senderEmail: 'owner@example.com',
            })
        ).resolves.toEqual([])
    })

    test('reads only the latest assistant reply when the earlier history is withheld', async () => {
        setCommentDocs([assistantReply([{ eventId: 'evt-latest' }]), assistantReply([{ eventId: 'evt-earlier' }])])

        await expect(
            getEmailCalendarEventsCreatedByAssistant('project-1', 'chat-1', {
                assistantId: 'assistant-1',
                senderEmail: 'owner@example.com',
                latestReplyOnly: true,
            })
        ).resolves.toEqual([{ eventId: 'evt-latest' }])
    })

    test('reads nothing without an assistant to attribute the replies to', async () => {
        await expect(getEmailCalendarEventsCreatedByAssistant('project-1', 'chat-1', {})).resolves.toEqual([])
    })

    test('stores the calendar events of a reply on its email metadata', async () => {
        const { chatRef } = setChatDoc()

        await storeEmailAssistantMessageInTopic('project-1', 'chat-1', 'assistant-1', 'Erledigt.', 'user-1', {
            toEmail: 'owner@example.com',
            calendarEvents: [{ eventId: 'evt-1', summary: 'Lichterfest', description: 'not kept' }],
        })

        expect(chatRef.set).toHaveBeenCalledWith(
            expect.objectContaining({
                creatorId: 'assistant-1',
                fromAssistant: true,
                emailReplyMetadata: expect.objectContaining({
                    toEmail: 'owner@example.com',
                    calendarEvents: [{ eventId: 'evt-1', summary: 'Lichterfest' }],
                }),
            })
        )
    })
})
