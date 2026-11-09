'use strict'

// MCP feed parity: Gmail and Calendar. executeToolNatively is the one place both MCP
// (assistantId = null) and assistants run the Gmail and Calendar tools, so it is where the Updates
// entry is written — after the tool succeeded, never for a failed call or another tool.

jest.mock('../shared/ProjectService', () => ({
    ProjectService: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        getUserProjects: jest.fn().mockResolvedValue([]),
    })),
}))
jest.mock('../GAnalytics/GAnalytics', () => ({ logEvent: jest.fn() }))
jest.mock('firebase-admin', () => {
    const firestore = { doc: jest.fn(() => ({ get: jest.fn(async () => ({ exists: false })) })) }
    return { firestore: jest.fn(() => firestore) }
})
jest.mock('openai', () => jest.fn())
jest.mock(
    '@dqbd/tiktoken/lite',
    () => ({ Tiktoken: jest.fn().mockImplementation(() => ({ encode: jest.fn(() => []), free: jest.fn() })) }),
    { virtual: true }
)
jest.mock('@dqbd/tiktoken/encoders/cl100k_base.json', () => ({ bpe_ranks: {}, special_tokens: {}, pat_str: '' }), {
    virtual: true,
})
jest.mock('firebase-functions/params', () => ({ defineString: jest.fn(() => ({ value: jest.fn(() => '') })) }), {
    virtual: true,
})
jest.mock('../shared/UserHelper', () => ({
    UserHelper: { getFeedUserData: jest.fn(async (db, uid) => ({ uid, displayName: 'Karsten Wysk' })) },
}))

const mockUpdateGmailEmail = jest.fn()
const mockFindAvailability = jest.fn()
jest.mock('../Gmail/assistantGmailMutations', () => ({
    updateGmailEmailForAssistantRequest: (...args) => mockUpdateGmailEmail(...args),
}))
jest.mock('../GoogleCalendar/assistantCalendarTools', () => ({
    findCalendarAvailabilityForAssistantRequest: (...args) => mockFindAvailability(...args),
}))

const mockRecordIntegrationToolActivity = jest.fn(async () => null)
jest.mock('../Feeds/integrationToolFeeds', () => ({
    ...jest.requireActual('../Feeds/integrationToolFeeds'),
    recordIntegrationToolActivity: (...args) => mockRecordIntegrationToolActivity(...args),
}))

// assistantHelper logs while it loads; keep the output to what this suite checks.
const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
const { executeToolNatively } = require('./assistantHelper')

afterAll(() => consoleLogSpy.mockRestore())

const mcpRuntime = { sourceChannel: 'mcp', mcpClient: 'Claude' }

describe('executeToolNatively writes the Gmail/Calendar Updates entry', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('after a successful MCP call, as the user via the client', async () => {
        const result = {
            success: true,
            projectId: 'email_google_aaaa',
            subject: 'Invoice 42',
            changedLabels: { added: [], removed: ['INBOX'] },
        }
        mockUpdateGmailEmail.mockResolvedValue(result)

        const returned = await executeToolNatively(
            'update_gmail_email',
            { messageId: 'm1', removeLabelIds: ['INBOX'] },
            'default-project',
            null,
            'user-1',
            {},
            mcpRuntime
        )

        expect(returned).toBe(result)
        expect(mockRecordIntegrationToolActivity).toHaveBeenCalledTimes(1)
        const call = mockRecordIntegrationToolActivity.mock.calls[0][0]
        expect(call).toMatchObject({
            toolName: 'update_gmail_email',
            toolArgs: { messageId: 'm1', removeLabelIds: ['INBOX'] },
            result,
            userId: 'user-1',
        })
        await expect(call.getFeedUser()).resolves.toMatchObject({ uid: 'user-1', via: 'mcp', viaClient: 'Claude' })
    })

    test('not for a failed call or for a tool that changes nothing outside Alldone', async () => {
        mockUpdateGmailEmail.mockResolvedValue({ success: false, message: 'No matching email message was found.' })
        mockFindAvailability.mockResolvedValue({ success: true, options: [] })

        await executeToolNatively('update_gmail_email', { messageId: 'm1' }, 'p1', null, 'user-1', {}, mcpRuntime)
        await executeToolNatively('find_calendar_availability', {}, 'p1', null, 'user-1', {}, mcpRuntime)

        expect(mockRecordIntegrationToolActivity).not.toHaveBeenCalled()
    })
})
