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
const { getLatestSafeEmailActionContext, getOrCreateDailyEmailTopic } = require('./emailDailyTopic')

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
                title: `Daily email <> Karsten, Peter Mueller, Anna ${moment().format('DD MMM YYYY')}`,
                emailParticipantEmails: ['owner@example.com', 'peter.mueller@example.com'],
                emailParticipantNames: ['Karsten', 'Peter Mueller', 'Anna'],
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
                title: `Daily email <> Karsten ${moment().format('DD MMM YYYY')}`,
                emailParticipantNames: ['Karsten', 'Anna'],
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
