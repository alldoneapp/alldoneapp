jest.mock('firebase-admin', () => {
    const getAll = jest.fn()
    const doc = jest.fn(path => ({
        path,
        get: jest.fn(),
    }))
    const collection = jest.fn(path => ({
        path,
        limit: jest.fn(() => ({
            get: jest.fn(),
        })),
    }))

    return {
        firestore: Object.assign(
            jest.fn(() => ({
                getAll,
                doc,
                collection,
            })),
            {
                Timestamp: {
                    now: jest.fn(() => 'timestamp-now'),
                },
            }
        ),
        __mock: {
            getAll,
            doc,
            collection,
        },
    }
})

jest.mock('googleapis', () => ({
    google: {
        gmail: jest.fn(),
    },
}))

jest.mock('../GoogleOAuth/googleOAuthHandler', () => ({
    getAccessToken: jest.fn(),
    getOAuth2Client: jest.fn(),
}))

jest.mock('../Assistant/assistantHelper', () => ({
    addBaseInstructions: jest.fn(() => Promise.resolve()),
    calculateGoldCostFromTokens: jest.fn(() => 0),
    collectAssistantTextWithToolCalls: jest.fn(),
    getAssistantForChat: jest.fn(),
    interactWithChatStream: jest.fn(),
    parseTextForUseLiKePrompt: jest.fn(text => text),
}))

jest.mock('../Firestore/assistantsFirestore', () => ({
    GLOBAL_PROJECT_ID: 'globalProject',
    getDefaultAssistantData: jest.fn(),
}))

jest.mock('../Gold/goldHelper', () => ({
    deductGold: jest.fn(),
}))

jest.mock('../Users/usersFirestore', () => ({
    adGoldToUser: jest.fn(),
}))

jest.mock('./gmailPromptClassifier', () => ({
    classifyGmailMessage: jest.fn(),
}))

const admin = require('firebase-admin')
const assistantHelper = require('../Assistant/assistantHelper')
const assistantsFirestore = require('../Firestore/assistantsFirestore')
const {
    buildGmailMessageUrl,
    createPostLabelPromptHash,
    executePostLabelPrompt,
    getDefaultAssistantIdForProject,
} = require('./serverSideGmailLabelingSync')

describe('serverSideGmailLabelingSync helpers', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('builds a Gmail message web url', () => {
        expect(buildGmailMessageUrl('person@example.com', 'msg-123')).toBe(
            'https://mail.google.com/mail/u/person%40example.com/#inbox/msg-123'
        )
    })

    test('hashes follow-up prompt by rule key and prompt', () => {
        const hashA = createPostLabelPromptHash('urgent', 'create a task')
        const hashB = createPostLabelPromptHash('urgent', 'create a task')
        const hashC = createPostLabelPromptHash('urgent', 'create another task')

        expect(hashA).toBe(hashB)
        expect(hashA).not.toBe(hashC)
    })

    test('prefers project assistant when resolving default assistant id', async () => {
        const projectGet = jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ assistantId: 'assistant-project' }),
        })
        const projectDocRef = { get: projectGet }
        const docMock = admin.__mock.doc
        docMock.mockImplementation(path => {
            if (path === 'projects/default-project') return projectDocRef
            return { path }
        })

        admin.__mock.getAll.mockResolvedValue([{ exists: true }, { exists: false }])

        const assistantId = await getDefaultAssistantIdForProject(
            { defaultAssistantId: 'assistant-user' },
            'default-project'
        )

        expect(assistantId).toBe('assistant-project')
    })

    test('falls back to global default assistant when project has none', async () => {
        const projectGet = jest.fn().mockResolvedValue({
            exists: false,
            data: () => ({}),
        })
        const collectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] })
        admin.__mock.doc.mockImplementation(path => {
            if (path === 'projects/default-project') return { get: projectGet }
            return { path }
        })
        admin.__mock.collection.mockImplementation(() => ({
            limit: () => ({
                get: collectionGet,
            }),
        }))
        assistantsFirestore.getDefaultAssistantData.mockResolvedValue({ uid: 'assistant-global' })

        const assistantId = await getDefaultAssistantIdForProject({}, 'default-project')

        expect(assistantId).toBe('assistant-global')
    })

    test('skips follow-up execution when prompt is empty', async () => {
        const result = await executePostLabelPrompt({
            userId: 'user-1',
            userData: { defaultProjectId: 'default-project' },
            selectedDefinition: { key: 'urgent', postLabelPrompt: '   ' },
            normalizedMessage: { messageId: 'message-1' },
            gmailEmail: 'person@example.com',
        })

        expect(result.status).toBe('skipped')
        expect(result.executedToolCallsCount).toBe(0)
    })

    test('records a completed follow-up with executed tools', async () => {
        admin.__mock.doc.mockImplementation(path => {
            if (path === 'projects/default-project') {
                return {
                    get: jest.fn().mockResolvedValue({
                        exists: true,
                        data: () => ({ assistantId: 'assistant-project' }),
                    }),
                }
            }
            return { path }
        })
        admin.__mock.getAll.mockResolvedValue([{ exists: true }, { exists: false }])
        assistantHelper.getAssistantForChat.mockResolvedValue({
            model: 'MODEL_GPT5_4',
            temperature: 'TEMPERATURE_NORMAL',
            instructions: 'Be useful',
            allowedTools: ['create_task'],
            displayName: 'Default Assistant',
        })
        assistantHelper.interactWithChatStream.mockResolvedValue({})
        assistantHelper.collectAssistantTextWithToolCalls.mockResolvedValue({
            assistantResponse: 'Created a task with the email link.',
            executedToolCallsCount: 1,
            executedToolNames: ['create_task'],
        })

        const result = await executePostLabelPrompt({
            userId: 'user-1',
            userData: { defaultProjectId: 'default-project' },
            selectedDefinition: {
                key: 'urgent',
                gmailLabelName: 'Alldone/Urgent',
                postLabelPrompt: 'Create a task for this email',
            },
            normalizedMessage: {
                messageId: 'message-1',
                threadId: 'thread-1',
                from: 'sender@example.com',
                to: 'me@example.com',
                cc: '',
                date: 'Tue, 11 Mar 2026 10:00:00 +0100',
                subject: 'Urgent request',
                snippet: 'Please respond today',
                bodyText: 'Please respond today',
            },
            gmailEmail: 'person@example.com',
        })

        expect(result.status).toBe('completed')
        expect(result.executedToolNames).toEqual(['create_task'])
        expect(result.assistantResponse).toBe('Created a task with the email link.')
    })

    test('records blocked follow-up when assistant tool execution is not permitted', async () => {
        admin.__mock.doc.mockImplementation(path => {
            if (path === 'projects/default-project') {
                return {
                    get: jest.fn().mockResolvedValue({
                        exists: true,
                        data: () => ({ assistantId: 'assistant-project' }),
                    }),
                }
            }
            return { path }
        })
        admin.__mock.getAll.mockResolvedValue([{ exists: true }, { exists: false }])
        assistantHelper.getAssistantForChat.mockResolvedValue({
            model: 'MODEL_GPT5_4',
            temperature: 'TEMPERATURE_NORMAL',
            instructions: 'Be useful',
            allowedTools: ['get_tasks'],
            displayName: 'Default Assistant',
        })
        assistantHelper.interactWithChatStream.mockResolvedValue({})
        assistantHelper.collectAssistantTextWithToolCalls.mockRejectedValue(
            new Error('Tool not permitted: create_task')
        )

        const result = await executePostLabelPrompt({
            userId: 'user-1',
            userData: { defaultProjectId: 'default-project' },
            selectedDefinition: {
                key: 'urgent',
                gmailLabelName: 'Alldone/Urgent',
                postLabelPrompt: 'Create a task for this email',
            },
            normalizedMessage: {
                messageId: 'message-1',
                threadId: 'thread-1',
                subject: 'Urgent request',
                bodyText: 'Please respond today',
            },
            gmailEmail: 'person@example.com',
        })

        expect(result.status).toBe('blocked')
        expect(result.error).toContain('Tool not permitted')
    })
})
