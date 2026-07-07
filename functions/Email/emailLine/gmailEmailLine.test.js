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

// Fake mailbox modelling thread-level membership. The INBOX set and each user label's
// thread ids overlap on purpose so an intersection (label ∩ inbox) yields the count a
// user actually sees. Label_ads carries a thread on a NON-inbox message (t_ads_archived)
// plus five inbox threads → count 5; Label_work has no inbox thread.
const INBOX_THREAD_IDS = ['t_in0', 't_in1', 't_in2', 't_in3', 't_in4', 't_in5'] // inbox size 6
const LABEL_THREAD_IDS = {
    Label_ads: ['t_in0', 't_in1', 't_in2', 't_in3', 't_in4', 't_ads_archived'],
    Label_work: ['t_work_archived'],
    Label_clients: ['t_in0', 't_in1', 't_in2'],
}
const NO_LABEL_INBOX_COUNT = 2

const makeThreadRefs = ids => ids.map(id => ({ id }))

function setupLabels(labels) {
    mockLabelsList.mockResolvedValue({ data: { labels } })
    // Unread counting stays message-level via messages.list [labelId, INBOX, UNREAD].
    mockMessagesList.mockImplementation(async ({ labelIds, q }) => {
        const primary = q === 'has:nouserlabels' ? NO_LABEL_ID : labelIds[0]
        const count = UNREAD_BY_ID[primary] || 0
        return { data: { messages: Array.from({ length: count }, (_, i) => ({ id: `${primary}-${i}` })) } }
    })
    // Thread counting is thread-level: ['INBOX'] returns the inbox set, [labelId] returns
    // the label's threads (some not in the inbox), and the no-label bucket keeps its query.
    mockThreadsList.mockImplementation(async ({ labelIds = [], q }) => {
        if (q === 'has:nouserlabels') {
            return {
                data: {
                    threads: makeThreadRefs(Array.from({ length: NO_LABEL_INBOX_COUNT }, (_, i) => `t_nolabel${i}`)),
                },
            }
        }
        const primary = labelIds[0]
        if (primary === 'INBOX') return { data: { threads: makeThreadRefs(INBOX_THREAD_IDS) } }
        return { data: { threads: makeThreadRefs(LABEL_THREAD_IDS[primary] || []) } }
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
        // Thread counting is thread-level: the inbox set is fetched once (['INBOX']) and
        // each user label is listed on its own (['Label_ads']) then intersected.
        expect(mockThreadsList).toHaveBeenCalledWith(expect.objectContaining({ labelIds: ['INBOX'] }))
        expect(mockThreadsList).toHaveBeenCalledWith(expect.objectContaining({ labelIds: ['Label_ads'] }))
        expect(mockThreadsList).toHaveBeenCalledWith(
            expect.objectContaining({ labelIds: ['INBOX'], q: 'has:nouserlabels' })
        )
    })

    test('listMessagesForLabel returns inbox∩label threads (incl. label on a non-inbox message) and parses headers', async () => {
        // t1 carries the label on a sent (non-inbox) message but is still in the inbox via
        // a sibling → it must surface. t_archived has the label but is not in the inbox →
        // dropped. t_inbox_only is in the inbox but lacks the label → not this label's row.
        mockThreadsList.mockImplementation(async ({ labelIds }) => {
            if (labelIds[0] === 'INBOX') return { data: { threads: makeThreadRefs(['t1', 't_inbox_only']) } }
            return { data: { threads: makeThreadRefs(['t1', 't_archived']) } }
        })
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
                        labelIds: ['Label_ads', 'SENT'],
                        payload: {
                            headers: [{ name: 'List-Unsubscribe', value: '<https://ex.com/u>' }],
                        },
                    },
                ],
            },
        })

        const result = await listMessagesForLabel('u', 'p', 'Label_ads', { emailAddress: 'me@gmail.com' })

        // Both the inbox set and the label set are listed, then intersected.
        expect(mockThreadsList).toHaveBeenCalledWith(expect.objectContaining({ labelIds: ['INBOX'] }))
        expect(mockThreadsList).toHaveBeenCalledWith(expect.objectContaining({ labelIds: ['Label_ads'] }))
        // Only the intersection thread is fetched; the archived label thread is skipped.
        expect(mockThreadsGet).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', format: 'metadata' }))
        expect(mockThreadsGet).not.toHaveBeenCalledWith(expect.objectContaining({ id: 't_archived' }))
        expect(result.messages).toHaveLength(1)
        expect(result.nextPageToken).toBeNull()
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

    test('listMessagesForLabel paginates the inbox∩label set by offset', async () => {
        const inboxIds = Array.from({ length: 30 }, (_, i) => `t${i}`)
        mockThreadsList.mockImplementation(async ({ labelIds }) => {
            if (labelIds[0] === 'INBOX') return { data: { threads: makeThreadRefs(inboxIds) } }
            // Label carries all inbox threads plus one archived thread.
            return { data: { threads: makeThreadRefs([...inboxIds, 't_archived']) } }
        })
        mockThreadsGet.mockImplementation(async ({ id }) => ({
            data: { id, messages: [{ id: `${id}-m`, labelIds: ['INBOX'] }] },
        }))

        const page1 = await listMessagesForLabel('u', 'p', 'Label_ads', {})
        expect(page1.messages).toHaveLength(25) // MESSAGES_PER_PAGE
        expect(page1.nextPageToken).toBe('inbox-label:25')

        const page2 = await listMessagesForLabel('u', 'p', 'Label_ads', { pageToken: page1.nextPageToken })
        expect(page2.messages).toHaveLength(5)
        expect(page2.nextPageToken).toBeNull()
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

        expect(mockThreadsList).toHaveBeenCalledWith(expect.objectContaining({ labelIds: ['INBOX'] }))
        expect(mockThreadsList).toHaveBeenCalledWith(expect.objectContaining({ labelIds: ['Label_ads'] }))
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

        expect(mockThreadsList).toHaveBeenCalledWith(expect.objectContaining({ labelIds: ['Label_ads'] }))
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
        // More inbox+labeled threads than SWEEP_LIMIT: the cap must stop mutation and
        // report work remaining so the client loops another round.
        mockThreadsList.mockImplementation(async () => ({
            data: { threads: Array.from({ length: 600 }, (_, i) => ({ id: `t${i}` })) },
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

    test('sweepLabel archives a thread whose label is only on a non-inbox (sent) message', async () => {
        // Regression: the label lives on the user's SENT reply (no INBOX) while the
        // thread stays in the inbox via a sibling message. A [label, INBOX] query would
        // match nothing; the thread-level intersection archives the inbox sibling.
        mockThreadsList.mockImplementation(async ({ labelIds = [] }) => {
            if (labelIds[0] === 'INBOX') return { data: { threads: [{ id: 't_convo' }, { id: 't_other' }] } }
            // Label is on t_convo (sent message) and t_archived (fully archived).
            return { data: { threads: [{ id: 't_convo' }, { id: 't_archived' }] } }
        })
        mockThreadsGet.mockImplementation(async ({ id }) => {
            if (id === 't_convo') {
                return {
                    data: {
                        id: 't_convo',
                        messages: [
                            { id: 'sent_reply', labelIds: ['SENT', 'Label_ads'] },
                            { id: 'inbox_sibling', labelIds: ['INBOX', 'IMPORTANT'] },
                        ],
                    },
                }
            }
            return { data: { id, messages: [{ id: `${id}-m`, labelIds: ['Label_ads'] }] } }
        })
        mockBatchModify.mockResolvedValue({})

        const result = await sweepLabel('u', 'p', 'Label_ads', 'archiveAll')

        // Only t_convo is both labeled and in the inbox; t_archived is labeled but not in
        // the inbox, t_other is in the inbox but not labeled.
        expect(result.processed).toBe(1)
        expect(mockBatchModify).toHaveBeenCalledWith(
            expect.objectContaining({
                requestBody: { ids: ['inbox_sibling'], removeLabelIds: ['INBOX'] },
            })
        )
    })

    test('listMessagesForLabel keeps a thread labeled on a sent message but drops fully-archived ones', async () => {
        // The inbox holds only t_convo; the label sits on both t_convo (via a sent reply)
        // and the fully-archived t_archived. The intersection keeps just t_convo.
        mockThreadsList.mockImplementation(async ({ labelIds }) => {
            if (labelIds[0] === 'INBOX') return { data: { threads: makeThreadRefs(['t_convo']) } }
            return { data: { threads: makeThreadRefs(['t_convo', 't_archived']) } }
        })
        mockThreadsGet.mockImplementation(async ({ id }) => {
            if (id === 't_convo') {
                return {
                    data: {
                        id: 't_convo',
                        messages: [
                            {
                                id: 'sent_reply',
                                internalDate: '2000',
                                labelIds: ['SENT', 'Label_ads'],
                                payload: { headers: [{ name: 'Subject', value: 'Invoice' }] },
                            },
                            {
                                id: 'inbox_sibling',
                                internalDate: '1000',
                                labelIds: ['INBOX'],
                                payload: { headers: [] },
                            },
                        ],
                    },
                }
            }
            return { data: { id, messages: [{ id: 'a1', labelIds: ['Label_ads'], payload: { headers: [] } }] } }
        })

        const result = await listMessagesForLabel('u', 'p', 'Label_ads', {})
        expect(result.messages.map(row => row.threadId)).toEqual(['t_convo'])
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
