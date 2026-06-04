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
const { getLatestSafeEmailActionContext } = require('./emailDailyTopic')

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
