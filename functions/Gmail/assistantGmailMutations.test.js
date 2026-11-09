jest.mock('./assistantGmailSearch', () => ({
    getConnectedGmailAccounts: jest.fn(),
    getGmailClient: jest.fn(),
}))

const { getConnectedGmailAccounts, getGmailClient } = require('./assistantGmailSearch')
const {
    buildLabelMutationState,
    normalizeStringList,
    resolveRequestedLabelIds,
    updateGmailEmailForAssistantRequest,
} = require('./assistantGmailMutations')

describe('assistantGmailMutations helpers', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('normalizes string lists from strings or arrays', () => {
        expect(normalizeStringList('INBOX, STARRED')).toEqual(['INBOX', 'STARRED'])
        expect(normalizeStringList(['INBOX', ' ', 'STARRED'])).toEqual(['INBOX', 'STARRED'])
    })

    test('builds label mutations from explicit labels and boolean toggles', () => {
        expect(
            buildLabelMutationState({
                addLabelIds: ['CustomLabel'],
                removeLabelIds: ['INBOX'],
                markUnread: true,
                starred: false,
            })
        ).toEqual({
            addLabelIds: ['CustomLabel', 'UNREAD'],
            removeLabelIds: ['INBOX', 'STARRED'],
        })
    })

    test('boolean toggles override conflicting explicit label changes', () => {
        expect(
            buildLabelMutationState({
                addLabelIds: ['UNREAD', 'STARRED'],
                removeLabelIds: ['IMPORTANT'],
                markUnread: false,
                starred: false,
                important: true,
            })
        ).toEqual({
            addLabelIds: ['IMPORTANT'],
            removeLabelIds: ['UNREAD', 'STARRED'],
        })
    })

    test('resolves exact label names to label ids and keeps system labels', () => {
        const labelMap = new Map([
            ['Alldone/Urgent', 'Label_123'],
            ['Receipts', 'Label_456'],
        ])

        expect(resolveRequestedLabelIds(['INBOX', 'Alldone/Urgent', 'Unknown'], labelMap)).toEqual([
            'INBOX',
            'Label_123',
            'Unknown',
        ])
    })

    test('resolves label names case-insensitively so case variants reuse the same label id', () => {
        const labelMap = new Map([
            ['Ads', 'Label_ads'],
            ['Receipts', 'Label_456'],
        ])

        // Gmail label names are case-sensitive; "ads"/"ADS" must still resolve to "Ads".
        expect(resolveRequestedLabelIds(['ads', 'ADS', 'receipts'], labelMap)).toEqual([
            'Label_ads',
            'Label_ads',
            'Label_456',
        ])
    })
})

describe('updateGmailEmailForAssistantRequest', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('returns an error when no change is requested', async () => {
        const result = await updateGmailEmailForAssistantRequest({
            userId: 'user-1',
            messageId: 'message-1',
        })

        expect(result).toEqual({
            success: false,
            message: 'Gmail email update requires at least one label or property change.',
        })
    })

    test('updates a message and derives archived state from INBOX removal', async () => {
        getConnectedGmailAccounts.mockResolvedValue([{ projectId: 'project-1', gmailEmail: 'person@example.com' }])

        const modify = jest.fn().mockResolvedValue({
            data: {
                id: 'message-1',
                threadId: 'thread-1',
                labelIds: ['UNREAD', 'Label_123'],
            },
        })
        const listLabels = jest.fn().mockResolvedValue({
            data: {
                labels: [
                    { id: 'INBOX', name: 'INBOX' },
                    { id: 'UNREAD', name: 'UNREAD' },
                    { id: 'Label_123', name: 'Alldone/Urgent' },
                ],
            },
        })

        const get = jest.fn().mockResolvedValue({
            data: {
                id: 'message-1',
                labelIds: ['INBOX', 'UNREAD'],
                payload: { headers: [{ name: 'Subject', value: 'Invoice 42' }] },
            },
        })

        getGmailClient.mockResolvedValue({
            users: {
                labels: { list: listLabels },
                messages: { modify, get },
            },
        })

        const result = await updateGmailEmailForAssistantRequest({
            userId: 'user-1',
            messageId: 'message-1',
            removeLabelIds: ['INBOX'],
            addLabelIds: ['Alldone/Urgent'],
        })

        expect(modify).toHaveBeenCalledWith({
            userId: 'me',
            id: 'message-1',
            requestBody: {
                addLabelIds: ['Label_123'],
                removeLabelIds: ['INBOX'],
            },
        })
        expect(result).toEqual({
            success: true,
            projectId: 'project-1',
            gmailEmail: 'person@example.com',
            messageId: 'message-1',
            threadId: 'thread-1',
            appliedChanges: {
                addLabelIds: ['Label_123'],
                removeLabelIds: ['INBOX'],
            },
            labelIds: ['UNREAD', 'Label_123'],
            labelNames: ['UNREAD', 'Alldone/Urgent'],
            subject: 'Invoice 42',
            changedLabels: { added: ['Alldone/Urgent'], removed: ['INBOX'] },
            archived: true,
            message: 'Updated Gmail message message-1 in person@example.com.',
        })
        expect(get).toHaveBeenCalledWith({
            userId: 'me',
            id: 'message-1',
            format: 'metadata',
            metadataHeaders: ['Subject'],
        })
    })

    test('reports only what really changed, and the request when the message could not be read first', async () => {
        getConnectedGmailAccounts.mockResolvedValue([{ projectId: 'project-1', gmailEmail: 'person@example.com' }])
        const modify = jest.fn().mockResolvedValue({ data: { id: 'message-1', labelIds: ['UNREAD'] } })
        const listLabels = jest.fn().mockResolvedValue({ data: { labels: [] } })
        const get = jest
            .fn()
            .mockResolvedValueOnce({ data: { id: 'message-1', labelIds: ['UNREAD'] } })
            .mockRejectedValueOnce(new Error('rate limited'))
        getGmailClient.mockResolvedValue({ users: { labels: { list: listLabels }, messages: { modify, get } } })

        // Already archived: archiving again changes nothing, so no Updates entry follows.
        const unchanged = await updateGmailEmailForAssistantRequest({
            userId: 'user-1',
            messageId: 'message-1',
            removeLabelIds: ['INBOX'],
        })
        expect(unchanged.success).toBe(true)
        expect(unchanged.changedLabels).toEqual({ added: [], removed: [] })
        expect(unchanged.subject).toBe('')

        const unknown = await updateGmailEmailForAssistantRequest({
            userId: 'user-1',
            messageId: 'message-1',
            removeLabelIds: ['INBOX'],
        })
        expect(unknown.success).toBe(true)
        expect(unknown.changedLabels).toEqual({ added: [], removed: ['INBOX'] })
        expect(modify).toHaveBeenCalledTimes(2)
    })

    test('prefers the requested project account before falling back to other accounts', async () => {
        getConnectedGmailAccounts.mockResolvedValue([
            { projectId: 'project-1', gmailEmail: 'first@example.com' },
            { projectId: 'project-2', gmailEmail: 'second@example.com' },
        ])

        const firstModify = jest.fn().mockRejectedValue(new Error('404 Requested entity was not found'))
        const secondModify = jest.fn().mockResolvedValue({
            data: {
                id: 'message-1',
                threadId: 'thread-1',
                labelIds: ['INBOX'],
            },
        })

        getGmailClient
            .mockResolvedValueOnce({
                users: {
                    labels: { list: jest.fn().mockResolvedValue({ data: { labels: [] } }) },
                    messages: { modify: firstModify },
                },
            })
            .mockResolvedValueOnce({
                users: {
                    labels: { list: jest.fn().mockResolvedValue({ data: { labels: [] } }) },
                    messages: { modify: secondModify },
                },
            })

        const result = await updateGmailEmailForAssistantRequest({
            userId: 'user-1',
            messageId: 'message-1',
            projectId: 'project-2',
            addLabelIds: ['INBOX'],
        })

        expect(getGmailClient).toHaveBeenNthCalledWith(1, 'user-1', 'project-2')
        expect(getGmailClient).toHaveBeenNthCalledWith(2, 'user-1', 'project-1')
        expect(result.success).toBe(true)
        expect(result.projectId).toBe('project-1')
    })
})
