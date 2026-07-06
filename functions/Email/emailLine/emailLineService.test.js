const mockDocs = new Map()
jest.mock('firebase-admin', () => ({
    firestore: () => ({
        doc: path => ({
            get: async () => {
                const data = mockDocs.get(path)
                return { exists: data !== undefined, data: () => data }
            },
            set: async (value, opts) => {
                const prev = mockDocs.get(path) || {}
                mockDocs.set(path, opts && opts.merge ? { ...prev, ...value } : value)
            },
        }),
    }),
}))

jest.mock('./needsReplyDetector', () => ({
    detectNeedsReply: jest.fn(),
    NEEDS_REPLY_MODEL_KEY: 'MODEL_GPT5_4_NANO',
}))

jest.mock('./gmailEmailLine', () => ({
    getGmailLabelSummary: jest.fn(),
    listMessagesForLabel: jest.fn(),
    archiveMessages: jest.fn(),
    markMessagesRead: jest.fn(),
    sweepLabel: jest.fn(),
    getMessageContext: jest.fn(),
    getUnreadInboxMessages: jest.fn(),
}))

jest.mock('./microsoftEmailLine', () => ({
    getMicrosoftLabelSummary: jest.fn(),
    listMessagesForLabel: jest.fn(),
    archiveMessages: jest.fn(),
    markMessagesRead: jest.fn(),
    sweepLabel: jest.fn(),
    getMessageContext: jest.fn(),
    getUnreadInboxMessages: jest.fn(),
}))

jest.mock('./replyComposer', () => ({
    composeReply: jest.fn(),
    REPLY_MODEL_KEY: 'MODEL_GPT5_4_MINI',
}))

jest.mock('../../Gold/goldHelper', () => ({
    deductGold: jest.fn(),
    refundGold: jest.fn(),
}))

jest.mock('../../Assistant/assistantHelper', () => ({
    calculateGoldCostFromTokens: jest.fn(() => 5),
}))

jest.mock('../../Gmail/assistantGmailDrafts', () => ({
    createGmailReplyDraftForAssistantRequest: jest.fn(),
}))

const gmailEmailLine = require('./gmailEmailLine')
const microsoftEmailLine = require('./microsoftEmailLine')
const { composeReply } = require('./replyComposer')
const { detectNeedsReply } = require('./needsReplyDetector')
const { deductGold, refundGold } = require('../../Gold/goldHelper')
const { createGmailReplyDraftForAssistantRequest } = require('../../Gmail/assistantGmailDrafts')
const { getEmailLineSummary, listEmailLineMessages, performEmailLineAction } = require('./emailLineService')

const googleUserData = { apisConnected: { p1: { email: true, emailProvider: 'google', gmailEmail: 'me@gmail.com' } } }
const microsoftUserData = {
    apisConnected: { p1: { email: true, emailProvider: 'microsoft', emailAddress: 'me@outlook.com' } },
}

describe('emailLineService', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockDocs.clear()
    })

    test('returns a disconnected summary when email is not connected', async () => {
        const summary = await getEmailLineSummary('u', 'p1', { userData: {} })
        expect(summary.connected).toBe(false)
        expect(summary.labels).toEqual([])
        expect(gmailEmailLine.getGmailLabelSummary).not.toHaveBeenCalled()
    })

    test('dispatches to the Gmail provider and computes inboxZero', async () => {
        gmailEmailLine.getGmailLabelSummary.mockResolvedValue({
            labels: [{ labelId: 'INBOX', unreadCount: 0, kind: 'inbox' }],
        })
        const summary = await getEmailLineSummary('u', 'p1', { userData: googleUserData })
        expect(summary.provider).toBe('google')
        expect(summary.inboxZero).toBe(true)
        expect(summary.emailAddress).toBe('me@gmail.com')
    })

    test('dispatches to the Microsoft provider', async () => {
        microsoftEmailLine.getMicrosoftLabelSummary.mockResolvedValue({
            labels: [{ labelId: 'f_inbox', unreadCount: 3, kind: 'inbox' }],
            emailAddress: 'me@outlook.com',
        })
        const summary = await getEmailLineSummary('u', 'p1', { userData: microsoftUserData })
        expect(summary.provider).toBe('microsoft')
        expect(summary.inboxZero).toBe(false)
    })

    test('maps provider auth errors to EMAIL_AUTH_EXPIRED', async () => {
        gmailEmailLine.getGmailLabelSummary.mockRejectedValue(new Error('invalid_grant: token expired'))
        await expect(getEmailLineSummary('u', 'p1', { userData: googleUserData })).rejects.toMatchObject({
            code: 'EMAIL_AUTH_EXPIRED',
        })
    })

    test('listEmailLineMessages forwards emailAddress to the provider', async () => {
        gmailEmailLine.listMessagesForLabel.mockResolvedValue({ messages: [], nextPageToken: null })
        await listEmailLineMessages('u', 'p1', 'INBOX', { userData: googleUserData, pageToken: 'pt' })
        expect(gmailEmailLine.listMessagesForLabel).toHaveBeenCalledWith('u', 'p1', 'INBOX', {
            pageToken: 'pt',
            emailAddress: 'me@gmail.com',
        })
    })

    test('performEmailLineAction routes archive/markRead/sweep', async () => {
        gmailEmailLine.archiveMessages.mockResolvedValue({ processed: 2 })
        gmailEmailLine.markMessagesRead.mockResolvedValue({ processed: 1 })
        gmailEmailLine.sweepLabel.mockResolvedValue({ processed: 5, remaining: false })

        await performEmailLineAction('u', 'p1', { action: 'archive', messageIds: ['a', 'b'], userData: googleUserData })
        expect(gmailEmailLine.archiveMessages).toHaveBeenCalledWith('u', 'p1', ['a', 'b'])

        await performEmailLineAction('u', 'p1', { action: 'markRead', messageIds: ['a'], userData: googleUserData })
        expect(gmailEmailLine.markMessagesRead).toHaveBeenCalledWith('u', 'p1', ['a'])

        await performEmailLineAction('u', 'p1', { action: 'archiveAll', labelId: 'L', userData: googleUserData })
        expect(gmailEmailLine.sweepLabel).toHaveBeenCalledWith('u', 'p1', 'L', 'archiveAll')
    })

    test('performEmailLineAction rejects unknown and unconnected', async () => {
        await expect(performEmailLineAction('u', 'p1', { action: 'nope', userData: googleUserData })).rejects.toThrow(
            /Unsupported/
        )
        await expect(
            performEmailLineAction('u', 'p1', { action: 'archive', messageIds: [], userData: {} })
        ).rejects.toMatchObject({ code: 'EMAIL_AUTH_EXPIRED' })
    })

    test('performEmailLineAction sweep requires labelId', async () => {
        await expect(
            performEmailLineAction('u', 'p1', { action: 'markAllRead', userData: googleUserData })
        ).rejects.toThrow(/labelId is required/)
    })

    test('draftReply composes, charges gold, and creates a Gmail draft', async () => {
        gmailEmailLine.getMessageContext.mockResolvedValue({ subject: 'Hi', from: 'a@ex.com', body: 'Q?' })
        composeReply.mockResolvedValue({ body: 'Sure', totalTokens: 200 })
        deductGold.mockResolvedValue({ success: true, amount: 5 })
        createGmailReplyDraftForAssistantRequest.mockResolvedValue({
            success: true,
            webUrl: 'https://mail/draft',
            targetSubject: 'Re: Hi',
        })

        const result = await performEmailLineAction('u', 'p1', {
            action: 'draftReply',
            messageIds: ['m1'],
            guidance: 'be brief',
            userData: googleUserData,
        })

        expect(composeReply).toHaveBeenCalledWith(
            expect.objectContaining({ guidance: 'be brief', context: expect.objectContaining({ subject: 'Hi' }) })
        )
        expect(deductGold).toHaveBeenCalledWith(
            'u',
            5,
            expect.objectContaining({ source: 'email_draft_reply', projectId: 'p1', objectId: 'm1', channel: 'google' })
        )
        expect(createGmailReplyDraftForAssistantRequest).toHaveBeenCalledWith({
            userId: 'u',
            messageId: 'm1',
            body: 'Sure',
        })
        expect(result).toEqual({ draftUrl: 'https://mail/draft', subject: 'Re: Hi', goldCost: 5 })
        expect(refundGold).not.toHaveBeenCalled()
    })

    test('draftReply throws on insufficient gold and does not create a draft', async () => {
        gmailEmailLine.getMessageContext.mockResolvedValue({ subject: 'Hi', body: 'Q?' })
        composeReply.mockResolvedValue({ body: 'Sure', totalTokens: 200 })
        deductGold.mockResolvedValue({ success: false })

        await expect(
            performEmailLineAction('u', 'p1', { action: 'draftReply', messageIds: ['m1'], userData: googleUserData })
        ).rejects.toMatchObject({ code: 'INSUFFICIENT_GOLD' })
        expect(createGmailReplyDraftForAssistantRequest).not.toHaveBeenCalled()
    })

    test('draftReply refunds gold when draft creation fails', async () => {
        gmailEmailLine.getMessageContext.mockResolvedValue({ subject: 'Hi', body: 'Q?' })
        composeReply.mockResolvedValue({ body: 'Sure', totalTokens: 200 })
        deductGold.mockResolvedValue({ success: true, amount: 5 })
        createGmailReplyDraftForAssistantRequest.mockResolvedValue({ success: false, message: 'boom' })

        await expect(
            performEmailLineAction('u', 'p1', { action: 'draftReply', messageIds: ['m1'], userData: googleUserData })
        ).rejects.toThrow(/boom/)
        expect(refundGold).toHaveBeenCalledWith(
            'u',
            5,
            expect.objectContaining({ source: 'email_draft_reply', note: 'draft creation failed' })
        )
    })

    test('needs-reply scan flags messages, charges gold, and persists state', async () => {
        gmailEmailLine.getGmailLabelSummary.mockResolvedValue({
            labels: [{ labelId: 'INBOX', unreadCount: 2, kind: 'inbox' }],
        })
        gmailEmailLine.getUnreadInboxMessages.mockResolvedValue([
            { messageId: 'm1', from: 'a@ex.com', subject: 'Q?', snippet: 's' },
            { messageId: 'm2', from: 'b@ex.com', subject: 'FYI', snippet: 's' },
        ])
        detectNeedsReply.mockResolvedValue({ flagsByMessageId: { m1: true }, totalTokens: 40 })
        deductGold.mockResolvedValue({ success: true, amount: 5 })

        const summary = await getEmailLineSummary('u', 'p1', { userData: googleUserData, includeNeedsReply: true })
        expect(summary.needsReplyCount).toBe(1)
        expect(summary.needsReplyByMessageId).toEqual({ m1: true })
        expect(deductGold).toHaveBeenCalledWith(
            'u',
            5,
            expect.objectContaining({ source: 'email_needs_reply', projectId: 'p1', channel: 'google' })
        )
        // Persisted with scanned ids so a repeat won't re-charge.
        const state = mockDocs.get('users/u/emailLineState/p1')
        expect(state.scannedMessageIds).toEqual(['m1', 'm2'])
    })

    test('needs-reply honors the cooldown and does not re-scan', async () => {
        gmailEmailLine.getGmailLabelSummary.mockResolvedValue({
            labels: [{ labelId: 'INBOX', unreadCount: 1, kind: 'inbox' }],
        })
        mockDocs.set('users/u/emailLineState/p1', {
            needsReplyByMessageId: { m1: true },
            scannedMessageIds: ['m1'],
            lastNeedsReplyScanAt: Date.now(),
        })

        const summary = await getEmailLineSummary('u', 'p1', { userData: googleUserData, includeNeedsReply: true })
        expect(summary.needsReplyCount).toBe(1)
        expect(gmailEmailLine.getUnreadInboxMessages).not.toHaveBeenCalled()
        expect(detectNeedsReply).not.toHaveBeenCalled()
    })

    test('needs-reply does not re-charge already-scanned messages', async () => {
        gmailEmailLine.getGmailLabelSummary.mockResolvedValue({
            labels: [{ labelId: 'INBOX', unreadCount: 1, kind: 'inbox' }],
        })
        // Cooldown expired, but the only unread message was already scanned.
        mockDocs.set('users/u/emailLineState/p1', {
            needsReplyByMessageId: { m1: true },
            scannedMessageIds: ['m1'],
            lastNeedsReplyScanAt: Date.now() - 60 * 60 * 1000,
        })
        gmailEmailLine.getUnreadInboxMessages.mockResolvedValue([
            { messageId: 'm1', from: 'a@ex.com', subject: 'Q?', snippet: 's' },
        ])

        const summary = await getEmailLineSummary('u', 'p1', { userData: googleUserData, includeNeedsReply: true })
        expect(detectNeedsReply).not.toHaveBeenCalled()
        expect(deductGold).not.toHaveBeenCalled()
        expect(summary.needsReplyByMessageId).toEqual({ m1: true })
    })

    test('needs-reply skips silently when gold is insufficient', async () => {
        gmailEmailLine.getGmailLabelSummary.mockResolvedValue({
            labels: [{ labelId: 'INBOX', unreadCount: 1, kind: 'inbox' }],
        })
        gmailEmailLine.getUnreadInboxMessages.mockResolvedValue([
            { messageId: 'm9', from: 'a@ex.com', subject: 'Q?', snippet: 's' },
        ])
        detectNeedsReply.mockResolvedValue({ flagsByMessageId: { m9: true }, totalTokens: 40 })
        deductGold.mockResolvedValue({ success: false })

        const summary = await getEmailLineSummary('u', 'p1', { userData: googleUserData, includeNeedsReply: true })
        expect(summary.needsReplyScanSkipped).toBe('no_gold')
        // State not persisted with the new scan (so it retries later).
        expect(mockDocs.get('users/u/emailLineState/p1')).toBeUndefined()
    })

    test('listEmailLineMessages merges needs-reply flags into rows', async () => {
        mockDocs.set('users/u/emailLineState/p1', { needsReplyByMessageId: { m1: true } })
        gmailEmailLine.listMessagesForLabel.mockResolvedValue({
            messages: [
                { messageId: 'm1', subject: 'Q?' },
                { messageId: 'm2', subject: 'FYI' },
            ],
            nextPageToken: null,
        })

        const result = await listEmailLineMessages('u', 'p1', 'INBOX', { userData: googleUserData })
        expect(result.messages.find(m => m.messageId === 'm1').needsReply).toBe(true)
        expect(result.messages.find(m => m.messageId === 'm2').needsReply).toBe(false)
    })
})
