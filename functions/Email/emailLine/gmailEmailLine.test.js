const mockLabelsList = jest.fn()
const mockLabelsGet = jest.fn()
const mockMessagesList = jest.fn()
const mockMessagesGet = jest.fn()
const mockBatchModify = jest.fn()
const mockThreadsList = jest.fn()
const mockThreadsGet = jest.fn()
const mockThreadsModify = jest.fn()

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
                    modify: (...args) => mockThreadsModify(...args),
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
}

// Fake mailbox modelling thread-level membership. The INBOX set and each user label's
// thread ids overlap on purpose so an intersection (label ∩ inbox) yields the count a
// user actually sees. Label_ads carries a thread on a NON-inbox message (t_ads_archived)
// plus five inbox threads → count 5; Label_work has no inbox thread. t_in5 is the only
// inbox thread with no user label → the whole No-label bucket.
const INBOX_THREAD_IDS = ['t_in0', 't_in1', 't_in2', 't_in3', 't_in4', 't_in5'] // inbox size 6
const LABEL_THREAD_IDS = {
    Label_ads: ['t_in0', 't_in1', 't_in2', 't_in3', 't_in4', 't_ads_archived'],
    Label_work: ['t_work_archived'],
    Label_clients: ['t_in0', 't_in1', 't_in2'],
}
// Every thread carrying a user label (union of all label buckets) = Gmail's has:userlabels
// set. No-label is the inbox threads NOT in here: t_in5.
const ALL_LABELED_THREAD_IDS = [...new Set(Object.values(LABEL_THREAD_IDS).flat())]

const makeThreadRefs = ids => ids.map(id => ({ id }))

function setupLabels(labels) {
    mockLabelsList.mockResolvedValue({ data: { labels } })
    // Unread counting stays message-level via messages.list [labelId, INBOX, UNREAD].
    mockMessagesList.mockImplementation(async ({ labelIds }) => {
        const count = UNREAD_BY_ID[labelIds[0]] || 0
        return { data: { messages: Array.from({ length: count }, (_, i) => ({ id: `${labelIds[0]}-${i}` })) } }
    })
    // Thread counting is thread-level: ['INBOX'] returns the inbox set, [labelId] returns the
    // label's threads (some not in the inbox), and has:userlabels returns every labeled thread
    // (the exact complement of the No-label bucket = inbox minus this set).
    mockThreadsList.mockImplementation(async ({ labelIds = [], q }) => {
        if (q === 'has:userlabels') return { data: { threads: makeThreadRefs(ALL_LABELED_THREAD_IDS) } }
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
        // No-label is the inbox threads carrying no user label: inbox {t_in0..t_in5} minus the
        // has:userlabels set {t_in0..t_in4, ...} = just t_in5. Unread is derived the same way
        // from the unread-inbox thread set.
        const noLabel = summary.labels.find(label => label.labelId === NO_LABEL_ID)
        expect(noLabel).toEqual(
            expect.objectContaining({ displayName: 'No label', threadCount: 1, unreadCount: 1, kind: 'no_label' })
        )
        // Thread counting is thread-level: the inbox set is fetched once (['INBOX']) and
        // each user label is listed on its own (['Label_ads']) then intersected.
        expect(mockThreadsList).toHaveBeenCalledWith(expect.objectContaining({ labelIds: ['INBOX'] }))
        expect(mockThreadsList).toHaveBeenCalledWith(expect.objectContaining({ labelIds: ['Label_ads'] }))
        // The no-label bucket is inbox minus the has:userlabels set (thread-level complement),
        // so the summary issues has:userlabels + reads the unread-inbox set, never has:nouserlabels.
        expect(mockThreadsList).toHaveBeenCalledWith(expect.objectContaining({ labelIds: ['INBOX', 'UNREAD'] }))
        expect(mockThreadsList).toHaveBeenCalledWith(expect.objectContaining({ q: 'has:userlabels' }))
        expect(mockThreadsList).not.toHaveBeenCalledWith(expect.objectContaining({ q: 'has:nouserlabels' }))
    })

    test('inspects labels past the old 25-cap so an alphabetically-late label still gets a chip', async () => {
        // Regression: MAX_LABELS_TO_INSPECT truncates the sorted eligible labels, so a label that
        // sorts past the cut got no thread count and therefore no chip — even with inbox mail.
        // 30 filler labels sort before "Privat" (all start with 'a'), putting it at position ~32
        // (INBOX + 30 fillers + Privat) — past the old cap of 25 but within the raised ceiling.
        const fillers = Array.from({ length: 30 }, (_, i) => ({
            id: `Label_fill_${String(i).padStart(2, '0')}`,
            name: `aaa ${String(i).padStart(2, '0')}`,
            type: 'user',
        }))
        mockLabelsList.mockResolvedValue({
            data: {
                labels: [
                    { id: 'INBOX', name: 'INBOX', type: 'system' },
                    ...fillers,
                    { id: 'Label_privat', name: 'Privat', type: 'user' },
                ],
            },
        })
        mockMessagesList.mockResolvedValue({ data: { messages: [] } })
        // t_a is unlabeled; t_b carries Privat. Only Privat (and INBOX) have inbox threads.
        mockThreadsList.mockImplementation(async ({ labelIds = [], q }) => {
            if (q === 'has:userlabels') return { data: { threads: makeThreadRefs(['t_b']) } }
            const primary = labelIds[0]
            if (primary === 'INBOX') return { data: { threads: makeThreadRefs(['t_a', 't_b']) } }
            if (primary === 'Label_privat') return { data: { threads: makeThreadRefs(['t_b']) } }
            return { data: { threads: [] } }
        })

        const summary = await getGmailLabelSummary('user1', 'proj1')
        const privat = summary.labels.find(label => label.labelId === 'Label_privat')
        expect(privat).toEqual(expect.objectContaining({ displayName: 'Privat', threadCount: 1, kind: 'user' }))
    })

    test('still truncates at MAX_LABELS_TO_INSPECT: a label past the ceiling gets no chip', async () => {
        // The cap still exists — this locks the throttle-bounded ceiling. 65 fillers sort before
        // "Privat" (position ~67 with INBOX), past MAX_LABELS_TO_INSPECT (60), so it is never
        // inspected and never surfaced even though it carries an inbox thread.
        const fillers = Array.from({ length: 65 }, (_, i) => ({
            id: `Label_fill_${String(i).padStart(2, '0')}`,
            name: `aaa ${String(i).padStart(2, '0')}`,
            type: 'user',
        }))
        mockLabelsList.mockResolvedValue({
            data: {
                labels: [
                    { id: 'INBOX', name: 'INBOX', type: 'system' },
                    ...fillers,
                    { id: 'Label_privat', name: 'Privat', type: 'user' },
                ],
            },
        })
        mockMessagesList.mockResolvedValue({ data: { messages: [] } })
        mockThreadsList.mockImplementation(async ({ labelIds = [], q }) => {
            if (q === 'has:userlabels') return { data: { threads: makeThreadRefs(['t_b']) } }
            const primary = labelIds[0]
            if (primary === 'INBOX') return { data: { threads: makeThreadRefs(['t_a', 't_b']) } }
            if (primary === 'Label_privat') return { data: { threads: makeThreadRefs(['t_b']) } }
            return { data: { threads: [] } }
        })

        const summary = await getGmailLabelSummary('user1', 'proj1')
        expect(summary.labels.find(label => label.labelId === 'Label_privat')).toBeUndefined()
        // Never even queried for its threads — it was truncated before the count fan-out.
        expect(mockThreadsList).not.toHaveBeenCalledWith(expect.objectContaining({ labelIds: ['Label_privat'] }))
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

    test('listMessagesForLabel no-label bucket lists inbox threads absent from has:userlabels', async () => {
        // inbox = {t_in0..t_in5}; has:userlabels = every labeled thread {t_in0..t_in4, ...}.
        // No-label = the difference = [t_in5].
        setupLabels([{ id: 'INBOX', name: 'INBOX', type: 'system' }])
        mockThreadsGet.mockImplementation(async ({ id }) => ({
            data: { id, messages: [{ id: `${id}-m`, labelIds: ['INBOX'], payload: { headers: [] } }] },
        }))

        const result = await listMessagesForLabel('u', 'p', NO_LABEL_ID, {})

        expect(mockThreadsList).toHaveBeenCalledWith(expect.objectContaining({ q: 'has:userlabels' }))
        expect(mockThreadsList).toHaveBeenCalledWith(expect.objectContaining({ labelIds: ['INBOX'] }))
        expect(mockThreadsList).not.toHaveBeenCalledWith(expect.objectContaining({ q: 'has:nouserlabels' }))
        expect(result.messages.map(row => row.threadId)).toEqual(['t_in5'])
    })

    test('listMessagesForLabel no-label bucket drops an inbox thread whose label is on a non-inbox message', async () => {
        // t_split is in the inbox (via an unlabeled reply) but carries a user label on a sent
        // message, so Gmail's thread-level has:userlabels returns it — it must NOT appear in
        // No-label, and we never need to inspect per-message labels to exclude it.
        mockThreadsList.mockImplementation(async ({ labelIds = [], q }) => {
            if (q === 'has:userlabels') return { data: { threads: makeThreadRefs(['t_split']) } }
            if (labelIds[0] === 'INBOX') return { data: { threads: makeThreadRefs(['t_clean', 't_split']) } }
            return { data: { threads: [] } }
        })
        mockThreadsGet.mockImplementation(async ({ id }) => ({
            data: {
                id,
                messages: [
                    { id: `${id}-m`, labelIds: ['INBOX'], payload: { headers: [{ name: 'Subject', value: id }] } },
                ],
            },
        }))

        const result = await listMessagesForLabel('u', 'p', NO_LABEL_ID, {})

        expect(result.messages.map(row => row.threadId)).toEqual(['t_clean'])
        expect(mockThreadsGet).not.toHaveBeenCalledWith(expect.objectContaining({ id: 't_split' }))
    })

    test("archiveMessages archives each message's THREAD (deduped), not the bare messages", async () => {
        // Message-level INBOX removal cannot dislodge a ghost inbox thread (no message
        // carries INBOX yet the thread stays listed in the inbox), so the row archive
        // resolves each message to its thread and uses threads.modify.
        mockMessagesGet.mockImplementation(async ({ id }) => ({
            data: { id, threadId: id === 'm2' ? 't_shared' : `t_${id}` },
        }))
        mockThreadsModify.mockResolvedValue({})
        const result = await archiveMessages('u', 'p', ['m1', 'm2', 'm3'])
        expect(result.processed).toBe(3)
        expect(mockBatchModify).not.toHaveBeenCalled()
        expect(mockThreadsModify).toHaveBeenCalledTimes(3)
        expect(mockThreadsModify).toHaveBeenCalledWith(
            expect.objectContaining({ id: 't_m1', requestBody: { removeLabelIds: ['INBOX'] } })
        )
        expect(mockThreadsModify).toHaveBeenCalledWith(
            expect.objectContaining({ id: 't_shared', requestBody: { removeLabelIds: ['INBOX'] } })
        )
    })

    test('archiveMessages archives a shared thread only once', async () => {
        mockMessagesGet.mockResolvedValue({ data: { threadId: 't_same' } })
        mockThreadsModify.mockResolvedValue({})
        await archiveMessages('u', 'p', ['m1', 'm2', 'm3'])
        expect(mockThreadsModify).toHaveBeenCalledTimes(1)
    })

    test('markMessagesRead removes UNREAD', async () => {
        mockBatchModify.mockResolvedValue({})
        await markMessagesRead('u', 'p', ['m1'])
        expect(mockBatchModify.mock.calls[0][0].requestBody.removeLabelIds).toEqual(['UNREAD'])
    })

    test('sweepLabel archive modifies the target THREADS, not their individual messages', async () => {
        // The threads are resolved as in the inbox (threads.list ∩ label) and archived with
        // threads.modify — the only operation that also clears a ghost inbox thread whose
        // messages carry no INBOX (message-level batchModify no-ops on those).
        mockThreadsList.mockResolvedValue({ data: { threads: [{ id: 't1' }] } })
        mockThreadsModify.mockResolvedValue({})

        const result = await sweepLabel('u', 'p', 'Label_ads', 'archiveAll')

        expect(mockThreadsList).toHaveBeenCalledWith(expect.objectContaining({ labelIds: ['INBOX'] }))
        expect(mockThreadsList).toHaveBeenCalledWith(expect.objectContaining({ labelIds: ['Label_ads'] }))
        expect(result.processed).toBe(1)
        expect(mockBatchModify).not.toHaveBeenCalled()
        expect(mockThreadsGet).not.toHaveBeenCalled()
        expect(mockThreadsModify).toHaveBeenCalledWith(
            expect.objectContaining({ id: 't1', requestBody: { removeLabelIds: ['INBOX'] } })
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

    test('sweepLabel archive caps at 500 threads and reports remaining', async () => {
        // More inbox+labeled threads than SWEEP_LIMIT: the cap must stop mutation and
        // report work remaining so the client loops another round.
        mockThreadsList.mockImplementation(async () => ({
            data: { threads: Array.from({ length: 600 }, (_, i) => ({ id: `t${i}` })) },
        }))
        mockThreadsModify.mockResolvedValue({})

        const result = await sweepLabel('u', 'p', 'Label_ads', 'archiveAll')
        expect(result.processed).toBe(500)
        expect(result.remaining).toBe(true)
        expect(mockThreadsModify).toHaveBeenCalledTimes(500)
        expect(mockThreadsModify.mock.calls[0][0].requestBody.removeLabelIds).toEqual(['INBOX'])
    })

    test('sweepLabel archives a thread whose label is only on a non-inbox (sent) message', async () => {
        // Regression: the label lives on the user's SENT reply (no INBOX) while the
        // thread stays in the inbox via a sibling message. A [label, INBOX] query would
        // match nothing; the thread-level intersection archives the whole thread.
        mockThreadsList.mockImplementation(async ({ labelIds = [] }) => {
            if (labelIds[0] === 'INBOX') return { data: { threads: [{ id: 't_convo' }, { id: 't_other' }] } }
            // Label is on t_convo (sent message) and t_archived (fully archived).
            return { data: { threads: [{ id: 't_convo' }, { id: 't_archived' }] } }
        })
        mockThreadsModify.mockResolvedValue({})

        const result = await sweepLabel('u', 'p', 'Label_ads', 'archiveAll')

        // Only t_convo is both labeled and in the inbox; t_archived is labeled but not in
        // the inbox, t_other is in the inbox but not labeled.
        expect(result.processed).toBe(1)
        expect(mockThreadsModify).toHaveBeenCalledTimes(1)
        expect(mockThreadsModify).toHaveBeenCalledWith(
            expect.objectContaining({ id: 't_convo', requestBody: { removeLabelIds: ['INBOX'] } })
        )
    })

    test('sweepLabel archive clears a GHOST inbox thread (no message carries INBOX)', async () => {
        // The "chip shows N but Archive all does nothing" bug: Gmail keeps listing the
        // thread in the inbox (threads.list / in:inbox / the UI) although no message
        // carries INBOX anymore, so message-level INBOX removal is a successful no-op
        // forever. Only threads.modify on the thread itself dislodges it — verified on
        // the stuck production threads.
        mockThreadsList.mockResolvedValue({ data: { threads: [{ id: 't_stuck' }] } })
        mockThreadsModify.mockResolvedValue({})

        const result = await sweepLabel('u', 'p', 'Label_ads', 'archiveAll')

        expect(result.processed).toBe(1)
        expect(mockBatchModify).not.toHaveBeenCalled()
        expect(mockThreadsModify).toHaveBeenCalledWith(
            expect.objectContaining({ id: 't_stuck', requestBody: { removeLabelIds: ['INBOX'] } })
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

    test('sweepLabel archives the INBOX bucket at the thread level', async () => {
        mockThreadsList.mockResolvedValue({ data: { threads: [{ id: 't_a' }, { id: 't_b' }] } })
        mockThreadsModify.mockResolvedValue({})

        const result = await sweepLabel('u', 'p', 'INBOX', 'archiveAll')

        expect(result).toEqual({ processed: 2, remaining: false })
        expect(mockThreadsModify).toHaveBeenCalledTimes(2)
        expect(mockThreadsModify).toHaveBeenCalledWith(
            expect.objectContaining({ id: 't_a', requestBody: { removeLabelIds: ['INBOX'] } })
        )
    })

    test('sweepLabel no-label bucket queries the inbox and has:userlabels sets', async () => {
        mockThreadsList.mockResolvedValue({ data: { threads: [] } })
        const result = await sweepLabel('u', 'p', NO_LABEL_ID, 'archiveAll')
        expect(result.processed).toBe(0)
        expect(mockThreadsList).toHaveBeenCalledWith(expect.objectContaining({ labelIds: ['INBOX'] }))
        expect(mockThreadsList).toHaveBeenCalledWith(expect.objectContaining({ q: 'has:userlabels' }))
        expect(mockThreadsList).not.toHaveBeenCalledWith(expect.objectContaining({ q: 'has:nouserlabels' }))
    })

    test('sweepLabel no-label bucket sweeps only inbox threads absent from has:userlabels', async () => {
        // t_labeled is in the has:userlabels set (filed under a label, even if only on a
        // sent/archived message), so an "Archive all" on No-label must skip it entirely.
        mockThreadsList.mockImplementation(async ({ labelIds = [], q }) => {
            if (q === 'has:userlabels') return { data: { threads: makeThreadRefs(['t_labeled']) } }
            if (labelIds[0] === 'INBOX') return { data: { threads: makeThreadRefs(['t_clean', 't_labeled']) } }
            return { data: { threads: [] } }
        })
        mockThreadsModify.mockResolvedValue({})

        const result = await sweepLabel('u', 'p', NO_LABEL_ID, 'archiveAll')

        expect(result.processed).toBe(1)
        expect(mockThreadsModify).toHaveBeenCalledTimes(1)
        expect(mockThreadsModify).toHaveBeenCalledWith(
            expect.objectContaining({ id: 't_clean', requestBody: { removeLabelIds: ['INBOX'] } })
        )
    })
})
