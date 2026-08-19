'use strict'

// In-memory stand-ins. The audit subcollection is queried by equality on one field and written
// back through a batch; the notification docs are read through getAll and deleted through a batch.
const mockAuditDocs = new Map()
const mockNotificationDocs = new Set()
const mockDeletedNotificationPaths = []
const mockDocRef = path => ({ path })

jest.mock('firebase-admin', () => ({
    firestore: () => ({
        doc: path => mockDocRef(path),
        getAll: async (...refs) => refs.map(ref => ({ exists: mockNotificationDocs.has(ref.path), ref })),
        batch: () => {
            const ops = []
            return {
                delete: ref => ops.push({ type: 'delete', ref }),
                set: (ref, value, options) => ops.push({ type: 'set', ref, value, options }),
                commit: async () => {
                    ops.forEach(op => {
                        if (op.type === 'delete') {
                            mockDeletedNotificationPaths.push(op.ref.path)
                            mockNotificationDocs.delete(op.ref.path)
                            return
                        }
                        const previous = mockAuditDocs.get(op.ref.id) || {}
                        mockAuditDocs.set(op.ref.id, { ...previous, ...op.value })
                    })
                },
            }
        },
    }),
}))

jest.mock('firebase-admin/firestore', () => ({
    Timestamp: { now: () => ({ toMillis: () => 1_700_000_000_000 }) },
}))

jest.mock('./gmailLabelingConfig', () => ({
    getGmailLabelingStateRef: () => ({
        collection: () => ({
            where: (field, op, value) => ({
                limit: max => ({
                    get: async () => {
                        const docs = [...mockAuditDocs.entries()]
                            .filter(([, data]) => data[field] === value)
                            .slice(0, max)
                            .map(([id, data]) => ({ id, ref: { id }, data: () => data }))
                        return { empty: docs.length === 0, docs }
                    },
                }),
            }),
        }),
    }),
}))

const {
    buildEmailCommentAuditPatch,
    isEmailHandledInMailbox,
    normalizeCommentRefs,
    reconcileEmailCommentReadState,
    MAX_PENDING_AGE_MS,
} = require('./emailCommentReadSync')

const USER_ID = 'user-1'
const CONNECTION_KEY = 'email_google_1234'

const notificationPath = (projectId, commentId) => `chatNotifications/${projectId}/${USER_ID}/${commentId}`

const seedCandidate = (messageId, overrides = {}) => {
    mockAuditDocs.set(messageId, {
        gmailMessageId: messageId,
        emailCommentReadPending: true,
        emailComments: [{ projectId: 'project-1', chatId: 'chat-1', commentId: `c_${messageId}` }],
        archived: false,
        direction: 'incoming',
        processedAt: { toMillis: () => Date.now() },
        ...overrides,
    })
    mockNotificationDocs.add(notificationPath('project-1', `c_${messageId}`))
}

const makeGmail = labelsByMessageId => ({
    users: {
        messages: {
            get: jest.fn(async ({ id }) => {
                const labels = labelsByMessageId[id]
                if (labels === 'missing') {
                    const error = new Error('Requested entity was not found.')
                    error.code = 404
                    throw error
                }
                if (labels === 'error') {
                    const error = new Error('Backend Error')
                    error.code = 500
                    throw error
                }
                return { data: { id, labelIds: labels } }
            }),
        },
    },
})

beforeEach(() => {
    mockAuditDocs.clear()
    mockNotificationDocs.clear()
    mockDeletedNotificationPaths.length = 0
})

describe('isEmailHandledInMailbox (server rule)', () => {
    it('counts read, archived and deleted mail as handled', () => {
        expect(isEmailHandledInMailbox({ messageId: 'm', exists: true, unread: false, inInbox: true })).toBe(true)
        // Archived while Gmail still flags it unread — leaving the inbox is the user being done.
        expect(isEmailHandledInMailbox({ messageId: 'm', exists: true, unread: true, inInbox: false })).toBe(true)
        expect(isEmailHandledInMailbox({ messageId: 'm', exists: false })).toBe(true)
    })

    it('never treats an unknown state as handled', () => {
        expect(isEmailHandledInMailbox(null)).toBe(false)
        expect(isEmailHandledInMailbox({})).toBe(false)
        expect(isEmailHandledInMailbox({ messageId: 'm', exists: true, unread: true, inInbox: true })).toBe(false)
    })

    it('ignores inbox absence for mail that was never in the user inbox', () => {
        const archived = { messageId: 'm', exists: true, unread: true, inInbox: false }
        // Auto-archived by the labeling sync itself: the comment appeared already out of the inbox.
        expect(isEmailHandledInMailbox(archived, { archivedByLabeling: true })).toBe(false)
        // An outgoing message is never in the inbox at all.
        expect(isEmailHandledInMailbox(archived, { direction: 'outgoing' })).toBe(false)
        // Reading it in Gmail still counts for both.
        expect(isEmailHandledInMailbox({ ...archived, unread: false }, { archivedByLabeling: true })).toBe(true)
    })
})

describe('normalizeCommentRefs / buildEmailCommentAuditPatch', () => {
    it('keeps only addressable refs and deduplicates them', () => {
        expect(
            normalizeCommentRefs([
                { projectId: 'p', chatId: 'c', commentId: 'x' },
                { projectId: 'p', chatId: 'c', commentId: 'x' },
                { projectId: 'p', commentId: '' },
                { commentId: 'y' },
                null,
            ])
        ).toEqual([{ projectId: 'p', commentId: 'x', chatId: 'c' }])
    })

    it('stamps nothing when the follow-up created no chat comment', () => {
        expect(buildEmailCommentAuditPatch([])).toEqual({})
        expect(buildEmailCommentAuditPatch([{ projectId: 'p', chatId: 'c', commentId: 'x' }])).toEqual({
            emailComments: [{ projectId: 'p', commentId: 'x', chatId: 'c' }],
            emailCommentReadPending: true,
        })
    })
})

describe('reconcileEmailCommentReadState', () => {
    it('marks the comment of a mail read in Gmail as read and retires the candidate', async () => {
        seedCandidate('m_read')
        const gmail = makeGmail({ m_read: ['INBOX'] })

        const summary = await reconcileEmailCommentReadState({ gmail, userId: USER_ID, connectionKey: CONNECTION_KEY })

        expect(summary).toMatchObject({ candidates: 1, looked: 1, markedRead: 1 })
        expect(mockDeletedNotificationPaths).toEqual([notificationPath('project-1', 'c_m_read')])
        expect(mockAuditDocs.get('m_read')).toMatchObject({
            emailCommentReadPending: false,
            emailCommentReadResolution: 'mailbox_handled',
        })
    })

    it('marks an archived mail read even while Gmail still flags it unread', async () => {
        seedCandidate('m_archived')
        const gmail = makeGmail({ m_archived: ['UNREAD'] })

        await reconcileEmailCommentReadState({ gmail, userId: USER_ID, connectionKey: CONNECTION_KEY })

        expect(mockDeletedNotificationPaths).toEqual([notificationPath('project-1', 'c_m_archived')])
    })

    it('leaves a mail the user has not touched alone, and keeps it pending', async () => {
        seedCandidate('m_untouched')
        const gmail = makeGmail({ m_untouched: ['INBOX', 'UNREAD'] })

        const summary = await reconcileEmailCommentReadState({ gmail, userId: USER_ID, connectionKey: CONNECTION_KEY })

        expect(summary).toMatchObject({ markedRead: 0, stillUnread: 1 })
        expect(mockDeletedNotificationPaths).toEqual([])
        expect(mockAuditDocs.get('m_untouched').emailCommentReadPending).toBe(true)
    })

    it('does not treat an auto-archived mail as handled', async () => {
        seedCandidate('m_auto', { archived: true })
        const gmail = makeGmail({ m_auto: ['UNREAD'] })

        await reconcileEmailCommentReadState({ gmail, userId: USER_ID, connectionKey: CONNECTION_KEY })

        expect(mockDeletedNotificationPaths).toEqual([])
        expect(mockAuditDocs.get('m_auto').emailCommentReadPending).toBe(true)
    })

    it('spends no Gmail call on a comment the user already read in Alldone', async () => {
        seedCandidate('m_done')
        mockNotificationDocs.delete(notificationPath('project-1', 'c_m_done'))
        const gmail = makeGmail({ m_done: ['INBOX', 'UNREAD'] })

        const summary = await reconcileEmailCommentReadState({ gmail, userId: USER_ID, connectionKey: CONNECTION_KEY })

        expect(gmail.users.messages.get).not.toHaveBeenCalled()
        expect(summary).toMatchObject({ alreadyRead: 1, looked: 0 })
        expect(mockAuditDocs.get('m_done')).toMatchObject({
            emailCommentReadPending: false,
            emailCommentReadResolution: 'already_read',
        })
    })

    it('treats a mail deleted in Gmail as handled', async () => {
        seedCandidate('m_gone')
        const gmail = makeGmail({ m_gone: 'missing' })

        await reconcileEmailCommentReadState({ gmail, userId: USER_ID, connectionKey: CONNECTION_KEY })

        expect(mockDeletedNotificationPaths).toEqual([notificationPath('project-1', 'c_m_gone')])
    })

    it('keeps a candidate pending when its state could not be read', async () => {
        seedCandidate('m_broken')
        const gmail = makeGmail({ m_broken: 'error' })

        const summary = await reconcileEmailCommentReadState({ gmail, userId: USER_ID, connectionKey: CONNECTION_KEY })

        expect(summary.markedRead).toBe(0)
        expect(mockDeletedNotificationPaths).toEqual([])
        expect(mockAuditDocs.get('m_broken').emailCommentReadPending).toBe(true)
    })

    it('retires a candidate that has no addressable comment or has waited too long', async () => {
        seedCandidate('m_no_comment', { emailComments: [] })
        seedCandidate('m_old', { processedAt: { toMillis: () => Date.now() - MAX_PENDING_AGE_MS - 1000 } })
        const gmail = makeGmail({})

        const summary = await reconcileEmailCommentReadState({ gmail, userId: USER_ID, connectionKey: CONNECTION_KEY })

        expect(gmail.users.messages.get).not.toHaveBeenCalled()
        expect(summary.expired).toBe(1)
        expect(mockAuditDocs.get('m_no_comment').emailCommentReadResolution).toBe('no_comment')
        expect(mockAuditDocs.get('m_old').emailCommentReadResolution).toBe('expired')
        // Expiring stops the re-checking; it must never mark the comment itself as read.
        expect(mockDeletedNotificationPaths).toEqual([])
    })

    it('is idempotent: a second run finds nothing left to do', async () => {
        seedCandidate('m_read')
        const gmail = makeGmail({ m_read: ['INBOX'] })

        await reconcileEmailCommentReadState({ gmail, userId: USER_ID, connectionKey: CONNECTION_KEY })
        const second = await reconcileEmailCommentReadState({ gmail, userId: USER_ID, connectionKey: CONNECTION_KEY })

        expect(second).toMatchObject({ candidates: 0, markedRead: 0 })
        expect(mockDeletedNotificationPaths).toHaveLength(1)
    })

    it('clears every comment of a message linked into more than one topic', async () => {
        seedCandidate('m_multi', {
            emailComments: [
                { projectId: 'project-1', chatId: 'chat-1', commentId: 'c1' },
                { projectId: 'project-2', chatId: 'chat-2', commentId: 'c2' },
            ],
        })
        mockNotificationDocs.add(notificationPath('project-1', 'c1'))
        mockNotificationDocs.add(notificationPath('project-2', 'c2'))
        const gmail = makeGmail({ m_multi: ['INBOX'] })

        await reconcileEmailCommentReadState({ gmail, userId: USER_ID, connectionKey: CONNECTION_KEY })

        expect(mockDeletedNotificationPaths.sort()).toEqual(
            [notificationPath('project-1', 'c1'), notificationPath('project-2', 'c2')].sort()
        )
    })

    it('does nothing without a Gmail client or connection', async () => {
        seedCandidate('m_read')
        await expect(
            reconcileEmailCommentReadState({ userId: USER_ID, connectionKey: CONNECTION_KEY })
        ).resolves.toMatchObject({ candidates: 0 })
        expect(mockDeletedNotificationPaths).toEqual([])
    })
})
