jest.mock('../envFunctionsHelper', () => ({ getEnvFunctions: jest.fn(() => ({})) }))

const { getEnvFunctions } = require('../envFunctionsHelper')
const { getWhatsAppCallConfig } = require('./whatsAppCallConfig')
const { getLiveConfigurationError, getLiveSessionDefaults } = require('./assistantLiveConfig')
const { buildLiveSession } = require('./assistantLiveProtocol')

describe('shared GPT-Live configuration', () => {
    const config = {
        openAiApiKey: 'key',
        openAiProjectId: 'project',
        openAiWebhookSecret: 'secret',
        routingTokenSecret: 'route',
    }

    test.each([
        ['openAiApiKey', 'OPEN_AI_KEY or OPENAI_API_KEY'],
        ['openAiProjectId', 'OPENAI_PROJECT_ID'],
        ['openAiWebhookSecret', 'OPENAI_WEBHOOK_SECRET'],
        ['routingTokenSecret', 'WHATSAPP_CALL_ROUTING_SECRET'],
    ])('names missing %s without exposing any configured secrets', (field, name) => {
        const message = getLiveConfigurationError({ ...config, [field]: ' ' }, { sip: true })
        expect(message).toContain(name)
        expect(message).toContain('live.transport.incoming')
        expect(message).not.toContain('route,')
        expect(message).not.toContain('secret,')
    })

    test('requires only the OpenAI key for app calls', () => {
        expect(getLiveConfigurationError({ openAiApiKey: 'key' })).toBeNull()
        expect(getLiveConfigurationError({})).toContain('OPEN_AI_KEY or OPENAI_API_KEY')
        expect(getLiveConfigurationError(config, { sip: true })).toBeNull()
    })

    test.each(['phone_call', 'whatsapp_call', 'browser_call'])(
        '%s uses the app Live model even when old model overrides remain for recaps',
        channel => {
            getEnvFunctions.mockReturnValue({
                OPENAI_REALTIME_MODEL: 'recap-model-override',
                OPENAI_REALTIME_TRANSCRIPTION_MODEL: 'transcription-override',
            })
            const runtime = getWhatsAppCallConfig()
            expect(runtime.realtimeModel).toBe('recap-model-override')
            expect(runtime.transcriptionModel).toBe('transcription-override')
            expect(buildLiveSession({ channel, voice: 'cedar', config: runtime })).toMatchObject({
                model: 'gpt-live-1',
                delegation: { type: 'client' },
                audio: { output: { voice: 'cedar' } },
            })
            expect(getLiveSessionDefaults()).toMatchObject({
                voiceProvider: 'gpt-live',
                voiceModel: 'gpt-live-1',
                realtimeModel: null,
                voiceGoldPerMinute: 40,
            })
        }
    )
})
