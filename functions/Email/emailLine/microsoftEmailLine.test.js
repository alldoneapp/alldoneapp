const mockRequest = jest.fn()

jest.mock('../../MicrosoftGraph/graphClient', () => ({
    buildQuery: params => {
        const query = new URLSearchParams()
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value === undefined || value === null || value === '') return
            query.set(key, String(value))
        })
        const text = query.toString()
        return text ? `?${text}` : ''
    },
    encodePath: value => encodeURIComponent(String(value || '')),
    getMicrosoftGraphClient: jest.fn().mockResolvedValue({ request: (...args) => mockRequest(...args) }),
}))

jest.mock('../providers/microsoftEmailProvider', () => ({
    getConnectedMicrosoftEmailAccounts: jest.fn(),
}))

const { getConnectedMicrosoftEmailAccounts } = require('../providers/microsoftEmailProvider')
const {
    getMicrosoftLabelSummary,
    resolveAccountForProject,
    listMessagesForLabel,
    archiveMessages,
    markMessagesRead,
    sweepLabel,
} = require('./microsoftEmailLine')

const ACCOUNT = {
    projectId: 'proj1',
    emailAddress: 'me@outlook.com',
    gmailEmail: 'me@outlook.com',
    emailDefault: true,
}

describe('microsoftEmailLine', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('resolveAccountForProject prefers project match, then default, then first', () => {
        const accounts = [
            { projectId: 'a', emailDefault: false },
            { projectId: 'b', emailDefault: true },
        ]
        expect(resolveAccountForProject(accounts, 'a').projectId).toBe('a')
        expect(resolveAccountForProject(accounts, 'zzz').projectId).toBe('b')
        expect(resolveAccountForProject([{ projectId: 'x' }], 'zzz').projectId).toBe('x')
        expect(resolveAccountForProject([], 'x')).toBeNull()
    })

    test('throws when no connected Microsoft account', async () => {
        getConnectedMicrosoftEmailAccounts.mockResolvedValue([])
        await expect(getMicrosoftLabelSummary('user1', 'proj1')).rejects.toThrow(/No connected Microsoft/)
    })

    test('excludes junk/archive folders, keeps inbox + folders with items', async () => {
        getConnectedMicrosoftEmailAccounts.mockResolvedValue([
            { projectId: 'proj1', emailAddress: 'me@outlook.com', gmailEmail: 'me@outlook.com', emailDefault: true },
        ])
        mockRequest.mockResolvedValue({
            value: [
                { id: 'f_inbox', displayName: 'Inbox', wellKnownName: 'inbox', unreadItemCount: 5, totalItemCount: 8 },
                {
                    id: 'f_junk',
                    displayName: 'Junk',
                    wellKnownName: 'junkemail',
                    unreadItemCount: 9,
                    totalItemCount: 9,
                },
                {
                    id: 'f_archive',
                    displayName: 'Archive',
                    wellKnownName: 'archive',
                    unreadItemCount: 2,
                    totalItemCount: 2,
                },
                {
                    id: 'f_deleted',
                    displayName: 'Deleted',
                    wellKnownName: 'deleteditems',
                    unreadItemCount: 1,
                    totalItemCount: 1,
                },
                { id: 'f_clients', displayName: 'Clients', wellKnownName: '', unreadItemCount: 3, totalItemCount: 4 },
                { id: 'f_read', displayName: 'AllRead', wellKnownName: '', unreadItemCount: 0, totalItemCount: 6 },
                { id: 'f_empty', displayName: 'Empty', wellKnownName: '', unreadItemCount: 0, totalItemCount: 0 },
            ],
        })

        const summary = await getMicrosoftLabelSummary('user1', 'proj1')
        const ids = summary.labels.map(label => label.labelId)

        expect(ids).not.toContain('f_junk')
        expect(ids).not.toContain('f_archive')
        expect(ids).not.toContain('f_deleted')
        expect(ids).not.toContain('f_empty') // no items, non-inbox
        expect(ids).toContain('f_inbox')
        expect(ids).toContain('f_clients')
        expect(ids).toContain('f_read') // fully read folders stay visible until cleared

        // Inbox first, counts reported.
        expect(summary.labels[0].labelId).toBe('f_inbox')
        expect(summary.labels[0].kind).toBe('inbox')
        expect(summary.labels[0].threadCount).toBe(8)
        expect(summary.inboxUnread).toBe(5)
        expect(summary.emailAddress).toBe('me@outlook.com')
    })

    test('listMessagesForLabel normalizes rows and parses unsubscribe headers', async () => {
        getConnectedMicrosoftEmailAccounts.mockResolvedValue([ACCOUNT])
        mockRequest.mockResolvedValue({
            value: [
                {
                    id: 'm1',
                    conversationId: 'c1',
                    subject: 'Hi',
                    from: { emailAddress: { address: 'ann@ex.com' } },
                    receivedDateTime: '2026-01-01T00:00:00Z',
                    bodyPreview: 'preview',
                    isRead: false,
                    webLink: 'https://outlook/mail/m1',
                    internetMessageHeaders: [{ name: 'List-Unsubscribe', value: '<https://ex.com/u>' }],
                },
            ],
            '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/f1/messages?$skiptoken=abc',
        })

        const result = await listMessagesForLabel('u', 'proj1', 'f1', {})
        const row = result.messages[0]
        expect(row.messageId).toBe('m1')
        expect(row.from).toBe('ann@ex.com')
        expect(row.isUnread).toBe(true)
        expect(row.webUrl).toBe('https://outlook/mail/m1')
        expect(row.unsubscribe).toEqual({ httpsUrl: 'https://ex.com/u' })
        // nextLink stripped of graph root → path only.
        expect(result.nextPageToken).toBe('/me/mailFolders/f1/messages?$skiptoken=abc')
    })

    test('archiveMessages posts a $batch of move requests', async () => {
        getConnectedMicrosoftEmailAccounts.mockResolvedValue([ACCOUNT])
        mockRequest.mockResolvedValue({})
        const result = await archiveMessages('u', 'proj1', ['m1', 'm2'])
        expect(result.processed).toBe(2)
        const batchCall = mockRequest.mock.calls.find(call => call[0] === '/$batch')
        expect(batchCall).toBeTruthy()
        const body = JSON.parse(batchCall[1].body)
        expect(body.requests[0].method).toBe('POST')
        expect(body.requests[0].url).toContain('/move')
        expect(body.requests[0].body).toEqual({ destinationId: 'archive' })
    })

    test('markMessagesRead posts a $batch of PATCH isRead requests', async () => {
        getConnectedMicrosoftEmailAccounts.mockResolvedValue([ACCOUNT])
        mockRequest.mockResolvedValue({})
        await markMessagesRead('u', 'proj1', ['m1'])
        const batchCall = mockRequest.mock.calls.find(call => call[0] === '/$batch')
        const body = JSON.parse(batchCall[1].body)
        expect(body.requests[0].method).toBe('PATCH')
        expect(body.requests[0].body).toEqual({ isRead: true })
    })

    test('sweepLabel markAllRead only targets unread and caps at 500', async () => {
        getConnectedMicrosoftEmailAccounts.mockResolvedValue([ACCOUNT])
        // First calls (list ids) return full pages with nextLink → capped at 500.
        // Later calls ($batch) resolve empty.
        mockRequest.mockImplementation(async path => {
            if (path === '/$batch') return {}
            return {
                value: Array.from({ length: 100 }, (_, i) => ({ id: `x${Math.random()}${i}` })),
                '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/f1/messages?$skiptoken=next',
            }
        })
        const result = await sweepLabel('u', 'proj1', 'f1', 'markAllRead')
        expect(result.processed).toBe(500)
        expect(result.remaining).toBe(true)
        // The first (non-paginated) list request must scope to unread only.
        const firstListPath = mockRequest.mock.calls.map(call => call[0]).find(path => path !== '/$batch')
        expect(firstListPath.replace(/\+/g, ' ')).toContain('isRead eq false')
    })
})
