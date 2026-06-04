jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))
jest.mock('ws', () => jest.fn())
jest.mock('../Services/TwilioWhatsAppService', () => jest.fn())
jest.mock('../Assistant/assistantHelper', () => ({
    addBaseInstructions: jest.fn(),
    buildConversationSafeToolResult: jest.fn(),
    executeToolNatively: jest.fn(),
    filterAllowedToolsForRuntimeContext: jest.fn(),
    getAssistantForChat: jest.fn(),
    getDynamicToolSchemasWithCache: jest.fn(),
    isToolAllowedForExecution: jest.fn(),
}))
jest.mock('./whatsAppDailyTopic', () => ({ getConversationHistory: jest.fn() }))
jest.mock('./whatsAppCallConfig', () => ({
    getWhatsAppCallConfig: jest.fn(),
    normalizeRealtimeVoice: jest.fn(value => value || 'marin'),
}))
jest.mock('./whatsAppCallGold', () => ({ reconcileCallUsage: jest.fn() }))
jest.mock('./whatsAppCallSessions', () => ({
    FINAL_STATUSES: new Set(['completed', 'failed']),
    claimRecap: jest.fn(),
    cleanupExpiredCallSessions: jest.fn(),
    finalizeCallSession: jest.fn(),
    getCallSession: jest.fn(),
    updateCallSession: jest.fn(),
}))
jest.mock('./whatsAppCallTranscript', () => ({
    getCallTranscript: jest.fn(),
    getCallTranscriptTurn: jest.fn(),
    storeCallTranscriptTurn: jest.fn(),
}))

const admin = require('firebase-admin')
const TwilioWhatsAppService = require('../Services/TwilioWhatsAppService')
const { getWhatsAppCallConfig } = require('./whatsAppCallConfig')
const { reconcileCallUsage } = require('./whatsAppCallGold')
const { claimRecap, getCallSession, updateCallSession } = require('./whatsAppCallSessions')
const { getCallTranscript, getCallTranscriptTurn } = require('./whatsAppCallTranscript')
const {
    buildRealtimeSessionUpdate,
    createConversationItem,
    generateCallRecap,
    sendCallRecap,
} = require('./whatsAppCallController')

describe('WhatsApp call sideband configuration', () => {
    const config = {
        openAiApiKey: 'key',
        realtimeModel: 'gpt-realtime-2',
        transcriptionModel: 'gpt-realtime-whisper',
        reasoningEffort: 'medium',
    }

    beforeEach(() => {
        jest.clearAllMocks()
        getWhatsAppCallConfig.mockReturnValue(config)
        global.fetch = jest.fn()
    })

    test('configures audio output, semantic VAD, interruption, transcription, reasoning, and tools', () => {
        expect(
            buildRealtimeSessionUpdate({
                config,
                assistant: { realtimeVoice: 'cedar' },
                instructions: 'Speak briefly.',
                tools: [{ type: 'function', name: 'create_task' }],
            })
        ).toEqual({
            type: 'session.update',
            session: {
                type: 'realtime',
                model: 'gpt-realtime-2',
                output_modalities: ['audio'],
                instructions: 'Speak briefly.',
                reasoning: { effort: 'medium' },
                audio: {
                    input: {
                        transcription: { model: 'gpt-realtime-whisper' },
                        turn_detection: {
                            type: 'semantic_vad',
                            eagerness: 'auto',
                            create_response: true,
                            interrupt_response: true,
                        },
                    },
                    output: { voice: 'cedar' },
                },
                tools: [{ type: 'function', name: 'create_task' }],
                tool_choice: 'auto',
            },
        })
    })

    test('does not try to update the immutable voice after reconnect', () => {
        const update = buildRealtimeSessionUpdate({
            config,
            assistant: { realtimeVoice: 'cedar' },
            instructions: 'Speak briefly.',
            tools: [],
            includeVoice: false,
        })
        expect(update.session.audio.output).toBeUndefined()
    })

    test('converts stored history into Realtime conversation items', () => {
        expect(createConversationItem('user', 'Hello')).toEqual({
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: 'Hello' }],
            },
        })
    })

    test('generates the recap in text-only Responses mode without tools or storage', async () => {
        global.fetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({
                id: 'recap-response',
                output_text: 'A short recap.',
                usage: { total_tokens: 25 },
            }),
        }))

        await expect(generateCallRecap(config, {}, [{ role: 'user', text: 'Hello' }])).resolves.toEqual({
            text: 'A short recap.',
            tokens: 25,
            responseId: 'recap-response',
        })
        const body = JSON.parse(global.fetch.mock.calls[0][1].body)
        expect(body).toEqual(
            expect.objectContaining({
                model: 'gpt-realtime-2',
                reasoning: { effort: 'medium' },
                store: false,
                tools: [],
            })
        )
    })

    test('reuses a stored recap across delivery retries without regenerating or rebilling it', async () => {
        claimRecap.mockResolvedValue(true)
        getCallSession.mockResolvedValue({
            id: 'call-1',
            userId: 'user-1',
            projectId: 'project-1',
            chatId: 'chat-1',
            assistantId: 'assistant-1',
        })
        getCallTranscriptTurn.mockResolvedValue({ role: 'assistant', text: 'Call recap: Existing recap.' })
        admin.firestore.mockReturnValue({
            doc: jest.fn(() => ({
                get: jest.fn(async () => ({ exists: true, data: () => ({ phone: '+1234567890' }) })),
            })),
        })
        const sendWhatsAppMessage = jest.fn(async () => ({ success: true }))
        TwilioWhatsAppService.mockImplementation(() => ({ sendWhatsAppMessage }))

        await expect(sendCallRecap('call-1')).resolves.toEqual({ sent: true })

        expect(global.fetch).not.toHaveBeenCalled()
        expect(getCallTranscript).not.toHaveBeenCalled()
        expect(reconcileCallUsage).not.toHaveBeenCalled()
        expect(sendWhatsAppMessage).toHaveBeenCalledWith('+1234567890', 'Call recap: Existing recap.', {
            suppressSensitiveLogging: true,
        })
        expect(updateCallSession).toHaveBeenCalledWith('call-1', expect.objectContaining({ recapStatus: 'sent' }))
    })
})
