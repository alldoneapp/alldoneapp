const mockCreate = jest.fn()

jest.mock('../../Assistant/assistantHelper', () => ({
    getCachedEnvFunctions: jest.fn(() => ({ OPEN_AI_KEY: 'key' })),
    getOpenAIClient: jest.fn(() => ({ chat: { completions: { create: (...args) => mockCreate(...args) } } })),
}))

const { getCachedEnvFunctions } = require('../../Assistant/assistantHelper')
const { composeReply, buildUserContent } = require('./replyComposer')

describe('replyComposer', () => {
    beforeEach(() => jest.clearAllMocks())

    test('buildUserContent includes guidance when provided', () => {
        const content = buildUserContent({
            context: { from: 'a@ex.com', subject: 'Hi', body: 'Question?' },
            guidance: 'Be brief and say yes',
            language: 'German',
        })
        expect(content).toContain('a@ex.com')
        expect(content).toContain('Be brief and say yes')
        expect(content).toContain('User app language for background context only: German.')
        expect(content).toContain('write the reply in that same language')
        expect(content).not.toContain('Write the reply in this language: German.')
    })

    test('buildUserContent includes user and project context when provided', () => {
        const content = buildUserContent({
            context: { subject: 'Hi', body: 'Question?' },
            groundingContext: {
                userName: 'Anna',
                globalUserDescription: 'Prefers concise replies.',
                projectName: 'Client launch',
                projectUserDescription: 'Handles stakeholder updates.',
                projectDescription: 'Launching the new site.',
            },
        })

        expect(content).toContain('Prefers concise replies.')
        expect(content).toContain('Client launch')
        expect(content).toContain('Launching the new site.')
        expect(content).toContain('do not invent facts')
    })

    test('buildUserContent falls back to a generic instruction without guidance', () => {
        const content = buildUserContent({ context: { subject: 'Hi' } })
        expect(content).toContain('Write an appropriate, helpful reply.')
    })

    test('composeReply returns the model body and token usage', async () => {
        mockCreate.mockResolvedValue({
            choices: [{ message: { content: '  Sure, that works.  ' } }],
            usage: { total_tokens: 123 },
        })
        const result = await composeReply({ context: { subject: 'Hi', body: 'x' }, guidance: 'ok' })
        expect(result.body).toBe('Sure, that works.')
        expect(result.totalTokens).toBe(123)
    })

    test('composeReply instructs the model to match the original email language over app language', async () => {
        mockCreate.mockResolvedValue({
            choices: [{ message: { content: 'Gerne, das passt.' } }],
            usage: { total_tokens: 42 },
        })

        await composeReply({
            context: { subject: 'Termin', body: 'Hallo Anna, passt dir der Termin morgen?' },
            language: 'English',
        })

        const userMessage = mockCreate.mock.calls[0][0].messages.find(message => message.role === 'user').content
        expect(userMessage).toContain('Hallo Anna')
        expect(userMessage).toContain('write the reply in that same language')
        expect(userMessage).toContain('User app language for background context only: English.')
        expect(userMessage).not.toContain('Write the reply in this language: English.')
    })

    test('composeReply throws when the OpenAI key is missing', async () => {
        getCachedEnvFunctions.mockReturnValueOnce({})
        await expect(composeReply({ context: {} })).rejects.toThrow(/OpenAI key/)
    })

    test('composeReply tolerates a malformed completion (no crash)', async () => {
        mockCreate.mockResolvedValue({})
        const result = await composeReply({ context: {} })
        expect(result.body).toBe('')
        expect(result.totalTokens).toBe(0)
    })
})
