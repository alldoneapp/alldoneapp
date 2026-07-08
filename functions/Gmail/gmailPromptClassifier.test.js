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

    test('audits no-match results when reasoning says the email should be labeled as a configured label', async () => {
        // Production repro: nano model argued for Privat in its reasoning but returned
        // matched:false — the audit gate previously missed the "should be labeled as X" phrasing.
        mockCreateCompletion
            .mockResolvedValueOnce(
                mockCompletion({
                    matched: false,
                    labelKey: null,
                    confidence: 0.74,
                    reasoning:
                        'The email is a real-estate newsletter from Engel & Völkers (Berlin/Brandenburg) featuring multiple property listings for sale, with unsubscribe headers and marketing-style content. This fits the user’s house-hunting context, so it should be labeled as Privat rather than Ads.',
                })
            )
            .mockResolvedValueOnce(
                mockCompletion({
                    matched: true,
                    labelKey: 'Privat',
                    confidence: 0.9,
                    reasoning: 'Real-estate newsletter matching the user’s personal house hunt: Privat.',
                })
            )

        const result = await classifyGmailMessage({
            config: {
                prompt: 'Classify by configured label.',
                model: 'MODEL_GPT5_4_NANO',
                confidenceThreshold: 0.6,
                labelDefinitions: [
                    { key: 'privat', gmailLabelName: 'Privat' },
                    { key: 'urgent_client', gmailLabelName: 'Ads' },
                ],
            },
            message: { subject: 'Immobilie - Leben im Turm', direction: 'incoming' },
        })

        expect(mockCreateCompletion).toHaveBeenCalledTimes(2)
        expect(result).toEqual(
            expect.objectContaining({
                matched: true,
                labelKey: 'privat',
                confidence: 0.9,
                consistencyCheck: expect.objectContaining({
                    ran: true,
                    corrected: true,
                    trigger: { otherKey: 'privat', token: 'privat' },
                    originalLabelKey: null,
                }),
            })
        )
    })

    test('audits no-match results when reasoning says the email fits a configured label', async () => {
        mockCreateCompletion
            .mockResolvedValueOnce(
                mockCompletion({
                    matched: false,
                    labelKey: null,
                    confidence: 0.8,
                    reasoning:
                        'The email is an automated real-estate alert from Engel & Völkers about buying a home in Hamburg. This fits the Privat label guidance for house search alerts and is not a promotional pitch.',
                })
            )
            .mockResolvedValueOnce(
                mockCompletion({
                    matched: true,
                    labelKey: 'privat',
                    confidence: 0.88,
                    reasoning: 'Saved-search home alert for the user’s personal house hunt: Privat.',
                })
            )

        const result = await classifyGmailMessage({
            config: {
                prompt: 'Classify by configured label.',
                model: 'MODEL_GPT5_4_NANO',
                confidenceThreshold: 0.6,
                labelDefinitions: [
                    { key: 'privat', gmailLabelName: 'Privat' },
                    { key: 'urgent_client', gmailLabelName: 'Ads' },
                ],
            },
            message: { subject: 'Gespeicherte Suche', direction: 'incoming' },
        })

        expect(mockCreateCompletion).toHaveBeenCalledTimes(2)
        expect(result).toEqual(
            expect.objectContaining({
                matched: true,
                labelKey: 'privat',
                consistencyCheck: expect.objectContaining({
                    ran: true,
                    corrected: true,
                    trigger: { otherKey: 'privat', token: 'privat' },
                }),
            })
        )
    })

    test('resolves a case-mismatched labelKey to the configured key without an audit', async () => {
        mockCreateCompletion.mockResolvedValueOnce(
            mockCompletion({
                matched: true,
                labelKey: 'Privat',
                confidence: 0.82,
                reasoning: 'Personal email addressed directly to Karsten about a family matter.',
            })
        )

        const result = await classifyGmailMessage({
            config: {
                prompt: 'Classify by configured label.',
                model: 'MODEL_GPT5_4_NANO',
                confidenceThreshold: 0.6,
                labelDefinitions: [
                    { key: 'privat', gmailLabelName: 'Privat' },
                    { key: 'urgent_client', gmailLabelName: 'Ads' },
                ],
            },
            message: { subject: 'Hallo', direction: 'incoming' },
        })

        expect(mockCreateCompletion).toHaveBeenCalledTimes(1)
        expect(result).toEqual(
            expect.objectContaining({
                matched: true,
                labelKey: 'privat',
                rawLabelKey: 'Privat',
            })
        )
        expect(result.consistencyCheck).toBeUndefined()
    })

    test('resolves a returned Gmail label name to its configured key', async () => {
        mockCreateCompletion.mockResolvedValueOnce(
            mockCompletion({
                matched: true,
                labelKey: 'Ads',
                confidence: 0.9,
                reasoning: 'Promotional bulk mailing with marketing content and an unsubscribe header.',
            })
        )

        const result = await classifyGmailMessage({
            config: {
                prompt: 'Classify by configured label.',
                model: 'MODEL_GPT5_4_NANO',
                confidenceThreshold: 0.6,
                labelDefinitions: [
                    { key: 'privat', gmailLabelName: 'Privat' },
                    { key: 'urgent_client', gmailLabelName: 'Ads' },
                ],
            },
            message: { subject: 'Sale', direction: 'incoming' },
        })

        expect(mockCreateCompletion).toHaveBeenCalledTimes(1)
        expect(result).toEqual(
            expect.objectContaining({
                matched: true,
                labelKey: 'urgent_client',
                rawLabelKey: 'Ads',
            })
        )
        expect(result.consistencyCheck).toBeUndefined()
    })

    test('audits when the model returned a labelKey that was demoted to no-match', async () => {
        mockCreateCompletion
            .mockResolvedValueOnce(
                mockCompletion({
                    matched: false,
                    labelKey: 'Marketing',
                    confidence: 0.85,
                    reasoning: 'Bulk promotional mailing.',
                })
            )
            .mockResolvedValueOnce(
                mockCompletion({
                    matched: false,
                    labelKey: null,
                    confidence: 0.9,
                    reasoning: 'No configured label clearly applies.',
                })
            )

        const result = await classifyGmailMessage({
            config: {
                prompt: 'Classify by configured label.',
                model: 'MODEL_GPT5_4_NANO',
                confidenceThreshold: 0.6,
                labelDefinitions: [{ key: 'privat', gmailLabelName: 'Privat' }],
            },
            message: { subject: 'Sale', direction: 'incoming' },
        })

        expect(mockCreateCompletion).toHaveBeenCalledTimes(2)
        expect(result).toEqual(
            expect.objectContaining({
                matched: false,
                labelKey: null,
                consistencyCheck: expect.objectContaining({
                    ran: true,
                    corrected: false,
                    trigger: { type: 'demoted_label_key', rawLabelKey: 'Marketing' },
                    originalRawLabelKey: 'Marketing',
                }),
            })
        )
    })

    test('audits zero-confidence results with the stronger consistency model', async () => {
        mockCreateCompletion
            .mockResolvedValueOnce(
                mockCompletion({
                    matched: true,
                    labelKey: 'project_private',
                    confidence: 0,
                    reasoning: 'The classifier could not make a reliable decision.',
                })
            )
            .mockResolvedValueOnce(
                mockCompletion({
                    matched: true,
                    labelKey: 'project_product',
                    confidence: 0.96,
                    reasoning: 'The message concerns an Alldone product capability.',
                })
            )

        const result = await classifyGmailMessage({
            config: {
                prompt: 'Classify by active project.',
                model: 'MODEL_GPT5_4_NANO',
                confidenceThreshold: 0.7,
                labelDefinitions: [
                    { key: 'project_private', gmailLabelName: 'Privat' },
                    { key: 'project_product', gmailLabelName: 'Alldone Product' },
                ],
            },
            message: { subject: 'WhatsApp location support', direction: 'incoming' },
        })

        expect(mockCreateCompletion).toHaveBeenCalledTimes(2)
        expect(mockCreateCompletion.mock.calls[1][0].model).toBe('gpt-5.5')
        expect(result).toEqual(
            expect.objectContaining({
                matched: true,
                labelKey: 'project_product',
                confidence: 0.96,
                consistencyCheck: expect.objectContaining({
                    ran: true,
                    corrected: true,
                    trigger: { type: 'zero_confidence' },
                    auditModel: 'gpt-5.5',
                    originalLabelKey: null,
                    originalConfidence: 0,
                }),
            })
        )
    })
})
