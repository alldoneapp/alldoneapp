'use strict'

const mockAuditSet = jest.fn()
const mockConfigSet = jest.fn()
const mockTransactionGet = jest.fn()
const mockTransactionSet = jest.fn()
const mockCompletionCreate = jest.fn()

const mockStateRef = {
    collection: jest.fn(() => ({
        doc: jest.fn(() => ({
            set: mockAuditSet,
        })),
    })),
}

jest.mock('firebase-admin', () => ({
    firestore: Object.assign(
        jest.fn(() => ({
            runTransaction: jest.fn(async callback =>
                callback({
                    get: mockTransactionGet,
                    set: mockTransactionSet,
                })
            ),
        })),
        {
            FieldValue: {
                arrayUnion: jest.fn(value => ({ __arrayUnion: value })),
            },
            Timestamp: {
                now: jest.fn(() => 'timestamp-now'),
            },
        }
    ),
}))

jest.mock('../Assistant/assistantHelper', () => ({
    getCachedEnvFunctions: jest.fn(() => ({ OPEN_AI_KEY: 'openai-key' })),
    getOpenAIClient: jest.fn(() => ({
        chat: {
            completions: {
                create: mockCompletionCreate,
            },
        },
    })),
    logOpenAiCacheUsage: jest.fn(),
}))

jest.mock('./gmailPromptClassifier', () => ({
    extractJsonFromText: jest.fn(text => JSON.parse(text)),
    isGpt5ReasoningModel: jest.fn(() => false),
    mapAssistantModelToOpenAIModel: jest.fn(model => model),
}))

jest.mock('./gmailLabelingConfig', () => ({
    MAX_LEARNED_RULES_LENGTH: 4000,
    getGmailLabelingStateRef: jest.fn(() => mockStateRef),
}))

jest.mock('./serverSideGmailLabelingSync', () => ({
    getGmailLabelingLookupKeys: jest.fn(() => ['project-1']),
    loadConfig: jest.fn(),
    loadAuditEntry: jest.fn(),
    resolveEffectiveGmailLabelingConfig: jest.fn(),
    applyGmailThreadLabelCorrection: jest.fn(),
    executePostLabelPrompt: jest.fn(),
}))

const serverSideGmailLabelingSync = require('./serverSideGmailLabelingSync')
const { submitEmailLabelFeedback } = require('./gmailLabelFeedback')

describe('submitEmailLabelFeedback', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockTransactionGet.mockResolvedValue({ exists: false, data: () => ({}) })
        mockCompletionCreate.mockResolvedValue({
            choices: [{ message: { content: JSON.stringify({ learnedRules: '- Client emails use Client' }) } }],
        })

        const config = {
            gmailEmail: 'me@example.com',
            learnedRules: '',
            autoArchiveAllLabeled: true,
            labelDefinitions: [
                {
                    key: 'old',
                    gmailLabelName: 'Old Label',
                    postLabelPrompt: 'Old prompt',
                },
                {
                    key: 'client',
                    gmailLabelName: 'Client',
                    postLabelPrompt: 'Create the configured follow-up',
                    sourceProjectId: 'project-client',
                },
            ],
        }

        serverSideGmailLabelingSync.loadConfig.mockResolvedValue({
            exists: true,
            config,
            ref: { set: mockConfigSet },
        })
        serverSideGmailLabelingSync.resolveEffectiveGmailLabelingConfig.mockResolvedValue(config)
        serverSideGmailLabelingSync.loadAuditEntry.mockResolvedValue({
            id: 'message-1',
            gmailMessageId: 'message-1',
            gmailThreadId: 'thread-1',
            from: 'Client <client@example.com>',
            subject: 'Client request',
            snippet: 'Please handle this',
            direction: 'incoming',
            selectedLabelKey: 'old',
            selectedGmailLabelName: 'Old Label',
            reasoning: 'Previously matched old label',
            confidence: 0.77,
        })
        serverSideGmailLabelingSync.applyGmailThreadLabelCorrection.mockResolvedValue({
            applied: true,
            archived: false,
            targetLabelId: 'Label_2',
            targetGmailLabelName: 'Client',
            targetLabelKey: 'client',
        })
        serverSideGmailLabelingSync.executePostLabelPrompt.mockResolvedValue({
            status: 'completed',
            prompt: 'Create the configured follow-up',
            assistantResponse: 'Created follow-up.',
        })
    })

    test('executes the corrected label follow-up prompt after moving feedback to that label', async () => {
        const result = await submitEmailLabelFeedback({
            userId: 'user-1',
            userData: { email: 'fallback@example.com' },
            projectId: 'project-1',
            messageId: 'message-1',
            verdict: 'wrong',
            correctLabel: 'Client',
            correctLabelName: 'Client',
            currentLabelId: 'Label_1',
        })

        expect(result).toEqual(
            expect.objectContaining({
                relabeled: true,
                targetLabelId: 'Label_2',
                postLabelActionStatus: 'completed',
            })
        )
        expect(mockCompletionCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'MODEL_GPT5_6_SOL' }))
        expect(serverSideGmailLabelingSync.applyGmailThreadLabelCorrection).toHaveBeenCalledWith(
            'user-1',
            'project-1',
            {
                threadId: 'thread-1',
                currentLabelId: 'Label_1',
                targetLabelName: 'Client',
                labelDefinitions: expect.any(Array),
                autoArchiveAllLabeled: true,
            }
        )
        expect(serverSideGmailLabelingSync.executePostLabelPrompt).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'user-1',
                selectedDefinition: expect.objectContaining({
                    key: 'client',
                    gmailLabelName: 'Client',
                    postLabelPrompt: 'Create the configured follow-up',
                }),
                normalizedMessage: expect.objectContaining({
                    messageId: 'message-1',
                    threadId: 'thread-1',
                    from: 'Client <client@example.com>',
                    subject: 'Client request',
                    snippet: 'Please handle this',
                    bodyText: 'Please handle this',
                }),
                gmailEmail: 'me@example.com',
                direction: 'incoming',
                forceExecute: true,
                reasoning: 'Previously matched old label',
                confidence: 0.77,
                connectionProjectId: 'project-1',
                selectedProjectId: 'project-client',
            })
        )
        expect(mockAuditSet).toHaveBeenCalledWith(
            expect.objectContaining({
                postLabelAction: expect.objectContaining({ status: 'completed' }),
                postLabelActions: [expect.objectContaining({ status: 'completed' })],
            }),
            { merge: true }
        )
    })

    test('learns and executes a follow-up classification correction without relabeling', async () => {
        const result = await submitEmailLabelFeedback({
            userId: 'user-1',
            userData: { email: 'fallback@example.com' },
            projectId: 'project-1',
            messageId: 'message-1',
            verdict: 'wrong',
            correctFollowUpType: 'actionable',
            note: 'Direct client requests like this should create tasks.',
        })

        expect(result).toEqual(
            expect.objectContaining({
                relabeled: false,
                followUpType: 'actionable',
                postLabelActionStatus: 'completed',
            })
        )
        expect(serverSideGmailLabelingSync.applyGmailThreadLabelCorrection).not.toHaveBeenCalled()
        expect(serverSideGmailLabelingSync.executePostLabelPrompt).toHaveBeenCalledWith(
            expect.objectContaining({
                selectedDefinition: expect.objectContaining({ key: 'old' }),
                followUpType: 'actionable',
                forceExecute: true,
            })
        )
        expect(mockCompletionCreate.mock.calls[0][0].messages[1].content).toContain(
            '"correctFollowUpType": "actionable"'
        )
    })
})
