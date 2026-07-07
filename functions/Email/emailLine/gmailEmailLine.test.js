const mockLabelsList = jest.fn()
const mockLabelsGet = jest.fn()
const mockMessagesList = jest.fn()
const mockMessagesGet = jest.fn()
const mockBatchModify = jest.fn()
const mockThreadsList = jest.fn()
const mockThreadsGet = jest.fn()

jest.mock('googleapis', () => ({
    google: {
        gmail: () => ({
            users: {
                labels: {
                    list: (...args) => mockLabelsList(...args),
                    get: (...args) => mockLabelsGet(...args),
                },
                messages: {
                    list: (...args) => mockMessagesList(...args),
                    get: (...args) => mockMessagesGet(...args),
                    batchModify: (...args) => mockBatchModify(...args),
                },
                threads: {
                    list: (...args) => mockThreadsList(...args),
                    get: (...args) => mockThreadsGet(...args),
                },
            },
        }),
    },
}))

jest.mock('../../GoogleOAuth/googleOAuthHandler', () => ({
    getAccessToken: jest.fn().mockResolvedValue('token'),
    getOAuth2Client: jest.fn(() => ({ setCredentials: jest.fn() })),
}))

const {
    getGmailLabelSummary,
    stripLabelPrefix,
    listMessagesForLabel,
    archiveMessages,
    markMessagesRead,
    sweepLabel,
    NO_LABEL_ID,
} = require('./gmailEmailLine')

const UNREAD_BY_ID = {
    INBOX: 4,
    Label_ads: 12,
    Label_work: 0,
    Label_clients: 3,
    [NO_LABEL_ID]: 2,
}

// Inbox thread counts (read + unread) — deliberately different from the unread
// counts so assertions can tell the two apart.
const THREADS_BY_ID = {
    INBOX: 6,
    Label_ads: 5,
    Label_work: 0,
    Label_clients: 3,
    [NO_LABEL_ID]: 2,
}

function setupLabels(labels) {
    mockLabelsList.mockResolvedValue({ data: { labels } })
    // Inbox-scoped unread counting: labelIds is [labelId, 'INBOX', 'UNREAD'] for a
    // user label, or ['INBOX', 'UNREAD'] for the inbox itself. The primary label
    // id is always first, so map it to the configured count.
    mockMessagesList.mockImplementation(async ({ labelIds, q }) => {
        const primary = q === 'has:nouserlabels' ? NO_LABEL_ID : labelIds[0]
        const count = UNREAD_BY_ID[primary] || 0
        return { data: { messages: Array.from({ length: count }, (_, i) => ({ id: `${primary}-${i}` })) } }
    })
    // Inbox-scoped thread counting: labelIds is [labelId, 'INBOX'] or ['INBOX'].
    mockThreadsList.mockImplementation(async ({ labelIds, q }) => {
        const primary = q === 'has:nouserlabels' ? NO_LABEL_ID : labelIds[0]
        const count = THREADS_BY_ID[primary] || 0
        return { data: { threads: Array.from({ length: count }, (_, i) => ({ id: `${primary}-t${i}` })) } }
    })
}

describe('gmailEmailLine', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('stripLabelPrefix removes Alldone/ prefix and nested paths', () => {
        expect(stripLabelPrefix('Alldone/Ads')).toBe('Ads')
        expect(stripLabelPrefix('Clients/Acme')).toBe('Acme')
        expect(stripLabelPrefix('Work')).toBe('Work')
    })

    test('excludes system noise, keeps INBOX + user labels with inbox threads', async () => {
        setupLabels([
            { id: 'INBOX', name: 'INBOX', type: 'system' },
            { id: 'SPAM', name: 'SPAM', type: 'system' },
            { id: 'TRASH', name: 'TRASH', type: 'system' },
            { id: 'DRAFT', name: 'DRAFT', type: 'system' },
            { id: 'CATEGORY_PROMOTIONS', name: 'CATEGORY_PROMOTIONS', type: 'system' },
            { id: 'Label_ads', name: 'Alldone/Ads', type: 'user' },
            { id: 'Label_work', name: 'Work', type: 'user' },
            { id: 'Label_clients', name: 'Clients/Acme', type: 'user' },
        ])

        const summary = await getGmailLabelSummary('user1', 'proj1')
        const ids = summary.labels.map(label => label.labelId)

        // System noise never inspected/returned.
        expect(ids).not.toContain('SPAM')
        expect(ids).not.toContain('TRASH')
        expect(ids).not.toContain('DRAFT')
        expect(ids).not.toContain('CATEGORY_PROMOTIONS')

        // INBOX always kept; user label with no inbox threads dropped.
        expect(ids).toContain('INBOX')
        expect(ids).not.toContain('Label_work')
        expect(ids).toContain('Label_ads')
        expect(ids).toContain('Label_clients')
    })

    test('sorts INBOX first, then Alldone/*, then alphabetical; strips display names', async () => {
        setupLabels([
            { id: 'Label_clients', name: 'Clients/Acme', type: 'user' },
            { id: 'Label_ads', name: 'Alldone/Ads', type: 'user' },
            { id: 'INBOX', name: 'INBOX', type: 'system' },
        ])

        const summary = await getGmailLabelSummary('user1', 'proj1')
        expect(summary.labels.map(label => label.labelId)).toEqual(['INBOX', 'Label_ads', 'Label_clients', NO_LABEL_ID])
        expect(summary.labels.map(label => label.displayName)).toEqual(['Inbox', 'Ads', 'Acme', 'No label'])
        expect(summary.inboxUnread).toBe(4)
    })

    test('reports thread + unread counts and kinds', async () => {
        setupLabels([
            { id: 'INBOX', name: 'INBOX', type: 'system' },
            { id: 'Label_ads', name: 'Alldone/Ads', type: 'user' },
        ])
        const summary = await getGmailLabelSummary('user1', 'proj1')
        const inbox = summary.labels.find(label => label.labelId === 'INBOX')
        const ads = summary.labels.find(label => label.labelId === 'Label_ads')
        expect(inbox.kind).toBe('inbox')
        expect(inbox.threadCount).toBe(6)
        expect(ads.kind).toBe('user')
        expect(ads.unreadCount).toBe(12)
        expect(ads.threadCount).toBe(5)
        const noLabel = summary.labels.find(label => label.labelId === NO_LABEL_ID)
        expect(noLabel).toEqual(
            expect.objectContaining({ displayName: 'No label', threadCount: 2, unreadCount: 2, kind: 'no_label' })
        )
        // Thread counting never scopes by UNREAD; user labels stay inbox-scoped.
        expect(mockThreadsList).toHaveBeenCalledWith(expect.objectContaining({ labelIds: ['INBOX'] }))
        expect(mockThreadsList).toHaveBeenCalledWith(expect.objectContaining({ labelIds: ['Label_ads', 'INBOX'] }))
        expect(mockThreadsList).toHaveBeenCalledWith(
            expect.objectContaining({ labelIds: ['INBOX'], q: 'has:nouserlabels' })
        )
    })

    test('listMessagesForLabel scopes a user label to inbox threads and parses headers', async () => {
        mockThreadsList.mockResolvedValue({ data: { threads: [{ id: 't1' }], nextPageToken: 'np' } })
        mockThreadsGet.mockResolvedValue({
            data: {
                id: 't1',
                snippet: 'hello',
                messages: [
                    {
                        id: 'm1',
                        threadId: 't1',
                        internalDate: '2000',
                        snippet: 'hello',
                        labelIds: ['INBOX', 'UNREAD'],
                        payload: {
                            headers: [
                                { name: 'Subject', value: 'Deal' },
                                { name: 'From', value: 'Ann <ann@ex.com>' },
                            ],
                        },
                    },
                    {
                        id: 'm0',
                        threadId: 't1',
                        internalDate: '1000',
                        labelIds: ['Label_ads'],
                        payload: {
                            headers: [{ name: 'List-Unsubscribe', value: '<https://ex.com/u>' }],
                        },
                    },
                ],
            },
        })

        const result = await listMessagesForLabel('u', 'p', 'Label_ads', { emailAddress: 'me@gmail.com' })

        expect(mockThreadsList).toHaveBeenCalledWith(expect.objectContaining({ labelIds: ['Label_ads', 'INBOX'] }))
        expect(mockThreadsGet).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 't1',
                format: 'metadata',
            })
        )
        expect(result.nextPageToken).toBe('np')
        const row = result.messages[0]
        expect(row.messageId).toBe('m1')
        expect(row.messageIds).toEqual(['m1', 'm0'])
        expect(row.threadId).toBe('t1')
        expect(row.subject).toBe('Deal')
        expect(row.from).toBe('Ann <ann@ex.com>')
        expect(row.isUnread).toBe(true)
        expect(row.unsubscribe).toEqual({ httpsUrl: 'https://ex.com/u' })
        expect(row.webUrl).toContain('accounts.google.com/AccountChooser')
    })

    test('listMessagesForLabel INBOX label queries only INBOX', async () => {
        mockThreadsList.mockResolvedValue({ data: { threads: [] } })
        await listMessagesForLabel('u', 'p', 'INBOX', {})
        expect(mockThreadsList).toHaveBeenCalledWith(expect.objectContaining({ labelIds: ['INBOX'] }))
    })

    test('listMessagesForLabel no-label bucket queries unlabeled inbox threads', async () => {
        mockThreadsList.mockResolvedValue({ data: { threads: [] } })
        await listMessagesForLabel('u', 'p', NO_LABEL_ID, {})
        expect(mockThreadsList).toHaveBeenCalledWith(
            expect.objectContaining({ labelIds: ['INBOX'], q: 'has:nouserlabels' })
        )
    })

    test('archiveMessages removes INBOX and chunks batchModify at 100', async () => {
        mockBatchModify.mockResolvedValue({})
        const ids = Array.from({ length: 250 }, (_, i) => `m${i}`)
        const result = await archiveMessages('u', 'p', ids)
        expect(result.processed).toBe(250)
        expect(mockBatchModify).toHaveBeenCalledTimes(3) // 100 + 100 + 50
        expect(mockBatchModify.mock.calls[0][0].requestBody.removeLabelIds).toEqual(['INBOX'])
    })

    test('markMessagesRead removes UNREAD', async () => {
        mockBatchModify.mockResolvedValue({})
        await markMessagesRead('u', 'p', ['m1'])
        expect(mockBatchModify.mock.calls[0][0].requestBody.removeLabelIds).toEqual(['UNREAD'])
    })

    test('sweepLabel archives inbox messages across visible labeled threads', async () => {
        mockThreadsList.mockResolvedValue({ data: { threads: [{ id: 't1' }] } })
        mockThreadsGet.mockResolvedValue({
            data: {
                id: 't1',
                messages: [
                    { id: 'm_labeled_archived', labelIds: ['Label_ads'] },
                    { id: 'm_inbox_sibling', labelIds: ['INBOX'] },
                    { id: 'm_labeled_inbox', labelIds: ['Label_ads', 'INBOX'] },
                ],
            },
        })
        mockBatchModify.mockResolvedValue({})

        const result = await sweepLabel('u', 'p', 'Label_ads', 'archiveAll')

        expect(mockThreadsList).toHaveBeenCalledWith(expect.objectContaining({ labelIds: ['Label_ads', 'INBOX'] }))
        expect(result.processed).toBe(2)
        expect(mockBatchModify).toHaveBeenCalledWith(
            expect.objectContaining({
                requestBody: {
                    ids: ['m_inbox_sibling', 'm_labeled_inbox'],
                    removeLabelIds: ['INBOX'],
                },
            })
        )
    })

    test('sweepLabel marks unread messages across visible labeled threads', async () => {
        mockThreadsList.mockResolvedValue({ data: { threads: [{ id: 't1' }] } })
        mockThreadsGet.mockResolvedValue({
            data: {
                id: 't1',
                messages: [
                    { id: 'm_read_labeled', labelIds: ['Label_ads', 'INBOX'] },
                    { id: 'm_unread_sibling', labelIds: ['INBOX', 'UNREAD'] },
                    { id: 'm_unread_labeled', labelIds: ['Label_ads', 'INBOX', 'UNREAD'] },
                ],
            },
        })
        mockBatchModify.mockResolvedValue({})

        const result = await sweepLabel('u', 'p', 'Label_ads', 'markAllRead')

        expect(mockThreadsList).toHaveBeenCalledWith(expect.objectContaining({ labelIds: ['Label_ads', 'INBOX'] }))
        expect(result.processed).toBe(2)
        expect(mockBatchModify).toHaveBeenCalledWith(
            expect.objectContaining({
                requestBody: {
                    ids: ['m_unread_sibling', 'm_unread_labeled'],
                    removeLabelIds: ['UNREAD'],
                },
            })
        )
    })

    test('sweepLabel caps at 500 and reports remaining', async () => {
        // A single visible thread page can contain more matching messages than
        // SWEEP_LIMIT; the cap must stop mutation and report work remaining.
        mockThreadsList.mockImplementation(async () => ({
            data: {
                threads: Array.from({ length: 100 }, (_, i) => ({ id: `t${i}` })),
                nextPageToken: 'more',
            },
        }))
        mockThreadsGet.mockImplementation(async ({ id }) => ({
            data: {
                id,
                messages: Array.from({ length: 10 }, (_, i) => ({ id: `${id}-m${i}`, labelIds: ['INBOX'] })),
            },
        }))
        mockBatchModify.mockResolvedValue({})

        const result = await sweepLabel('u', 'p', 'Label_ads', 'archiveAll')
        expect(result.processed).toBe(500)
        expect(result.remaining).toBe(true)
        expect(mockBatchModify.mock.calls[0][0].requestBody.removeLabelIds).toEqual(['INBOX'])
        expect(mockBatchModify).toHaveBeenCalledTimes(5)
    })

    test('sweepLabel supports the no-label bucket', async () => {
        mockThreadsList.mockResolvedValue({ data: { threads: [] } })
        const result = await sweepLabel('u', 'p', NO_LABEL_ID, 'archiveAll')
        expect(result.processed).toBe(0)
        expect(mockThreadsList).toHaveBeenCalledWith(
            expect.objectContaining({ labelIds: ['INBOX'], q: 'has:nouserlabels' })
        )
    })
})
