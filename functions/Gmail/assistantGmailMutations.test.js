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

        getGmailClient.mockResolvedValue({
            users: {
                labels: { list: listLabels },
                messages: { modify },
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
            archived: true,
            message: 'Updated Gmail message message-1 in person@example.com.',
        })
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
