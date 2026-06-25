const mockCreateCompletion = jest.fn()

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(),
}))

jest.mock('../Assistant/assistantHelper', () => ({
    getCachedEnvFunctions: jest.fn(() => ({ OPEN_AI_KEY: 'openai-key' })),
    getOpenAIClient: jest.fn(() => ({
        chat: {
            completions: {
                create: mockCreateCompletion,
            },
        },
    })),
    normalizeModelKey: jest.fn(modelKey => modelKey),
}))

const { classifyGmailMessage } = require('./gmailPromptClassifier')

describe('gmailPromptClassifier', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    function mockCompletion(content, usage = { total_tokens: 100, prompt_tokens: 80, completion_tokens: 20 }) {
        return {
            choices: [{ message: { content: JSON.stringify(content) } }],
            usage,
        }
    }

    test('audits no-match results when reasoning references a configured label', async () => {
        mockCreateCompletion
            .mockResolvedValueOnce(
                mockCompletion(
                    {
                        matched: false,
                        labelKey: null,
                        confidence: 0.97,
                        reasoning:
                            'Email is explicitly titled "Project Juno | Bi-Weekly Check-in" and the sender is from JTL Software.',
                    },
                    { total_tokens: 10, prompt_tokens: 8, completion_tokens: 2 }
                )
            )
            .mockResolvedValueOnce(
                mockCompletion(
                    {
                        matched: true,
                        labelKey: 'project_jtl',
                        confidence: 0.95,
                        reasoning: 'The email clearly matches JTL Software - Project Juno.',
                    },
                    { total_tokens: 20, prompt_tokens: 16, completion_tokens: 4 }
                )
            )

        const result = await classifyGmailMessage({
            config: {
                prompt: 'Classify by active project.',
                model: 'MODEL_GPT5_4_NANO',
                confidenceThreshold: 0.83,
                labelDefinitions: [
                    {
                        key: 'project_jtl',
                        gmailLabelName: 'JTL Software - Project Juno',
                        description: 'JTL Project Juno work.',
                    },
                    {
                        key: 'project_bechtle',
                        gmailLabelName: 'Bechtle',
                        description: 'Bechtle work.',
                    },
                ],
            },
            message: {
                subject: 'Project Juno | Bi-Weekly Check-in',
                from: 'Y Chi Cindy Lange <YChi-Cindy.Lange@jtl-software.com>',
                direction: 'incoming',
            },
        })

        expect(mockCreateCompletion).toHaveBeenCalledTimes(2)
        expect(mockCreateCompletion.mock.calls[0][0].messages[1].content).toContain(
            'Configured confidence threshold: 0.83'
        )
        expect(mockCreateCompletion.mock.calls[0][0].messages[1].content).toContain(
            'For matched:false, confidence means confidence that no configured label matches.'
        )
        expect(mockCreateCompletion.mock.calls[1][0].messages[1].content).toContain(
            'Configured confidence threshold: 0.83'
        )
        expect(mockCreateCompletion.mock.calls[1][0].messages[1].content).toContain('"matched": false')
        expect(result).toEqual(
            expect.objectContaining({
                matched: true,
                labelKey: 'project_jtl',
                confidence: 0.95,
                consistencyCheck: expect.objectContaining({
                    ran: true,
                    corrected: true,
                    trigger: { otherKey: 'project_jtl', token: 'jtl' },
                    originalLabelKey: null,
                    originalConfidence: 0.97,
                }),
            })
        )
        expect(result.usage).toEqual({ totalTokens: 30, promptTokens: 24, completionTokens: 6 })
    })

    test('does not audit no-match results when reasoning references no configured label', async () => {
        mockCreateCompletion.mockResolvedValueOnce(
            mockCompletion({
                matched: false,
                labelKey: null,
                confidence: 0.2,
                reasoning: 'This is an unrelated newsletter.',
            })
        )

        const result = await classifyGmailMessage({
            config: {
                prompt: 'Classify by active project.',
                model: 'MODEL_GPT5_4_NANO',
                confidenceThreshold: 0.7,
                labelDefinitions: [{ key: 'project_jtl', gmailLabelName: 'JTL Software - Project Juno' }],
            },
            message: { subject: 'Newsletter', direction: 'incoming' },
        })

        expect(mockCreateCompletion).toHaveBeenCalledTimes(1)
        expect(result).toEqual(
            expect.objectContaining({
                matched: false,
                labelKey: null,
                confidence: 0.2,
            })
        )
        expect(result.consistencyCheck).toBeUndefined()
    })

    test('does not audit no-match results when label names are only mentioned as non-matches', async () => {
        mockCreateCompletion.mockResolvedValueOnce(
            mockCompletion({
                matched: false,
                labelKey: null,
                confidence: 0.9,
                reasoning:
                    'This is a generic newsletter and does not mention any configured active project such as Alldone Product, Privat, or JTL Software - Project Juno.',
            })
        )

        const result = await classifyGmailMessage({
            config: {
                prompt: 'Classify by active project.',
                model: 'MODEL_GPT5_4_NANO',
                confidenceThreshold: 0.7,
                labelDefinitions: [
                    { key: 'project_product', gmailLabelName: 'Alldone Product' },
                    { key: 'project_jtl', gmailLabelName: 'JTL Software - Project Juno' },
                ],
            },
            message: { subject: 'Newsletter', direction: 'incoming' },
        })

        expect(mockCreateCompletion).toHaveBeenCalledTimes(1)
        expect(result).toEqual(
            expect.objectContaining({
                matched: false,
                labelKey: null,
                confidence: 0.9,
            })
        )
        expect(result.consistencyCheck).toBeUndefined()
    })

    test('audits no-match results when reasoning says a label aligns best', async () => {
        mockCreateCompletion
            .mockResolvedValueOnce(
                mockCompletion({
                    matched: false,
                    labelKey: null,
                    confidence: 0.74,
                    reasoning:
                        'The email is an incoming Qonto payment notification with accounting-related wording. This aligns best with the Alldone Business label.',
                })
            )
            .mockResolvedValueOnce(
                mockCompletion({
                    matched: true,
                    labelKey: 'project_business',
                    confidence: 0.81,
                    reasoning: 'The payment notification matches Alldone Business accounting work.',
                })
            )

        const result = await classifyGmailMessage({
            config: {
                prompt: 'Classify by active project.',
                model: 'MODEL_GPT5_4_NANO',
                confidenceThreshold: 0.7,
                labelDefinitions: [
                    { key: 'project_business', gmailLabelName: 'Alldone Business' },
                    { key: 'project_jtl', gmailLabelName: 'JTL Software - Project Juno' },
                ],
            },
            message: { subject: 'Qonto payment notification', direction: 'incoming' },
        })

        expect(mockCreateCompletion).toHaveBeenCalledTimes(2)
        expect(result).toEqual(
            expect.objectContaining({
                matched: true,
                labelKey: 'project_business',
                confidence: 0.81,
                consistencyCheck: expect.objectContaining({
                    ran: true,
                    corrected: true,
                    trigger: { otherKey: 'project_business', token: 'business' },
                    originalLabelKey: null,
                    originalConfidence: 0.74,
                }),
            })
        )
    })
})
