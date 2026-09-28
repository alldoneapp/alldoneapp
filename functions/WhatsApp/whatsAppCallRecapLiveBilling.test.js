jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))
jest.mock('ws', () => jest.fn())
jest.mock('../Services/TwilioWhatsAppService', () => jest.fn())
jest.mock('../Assistant/assistantHelper', () => ({}))
jest.mock('./whatsAppDailyTopic', () => ({ getConversationHistory: jest.fn() }))
jest.mock('./whatsAppCallConfig', () => ({
    getWhatsAppCallConfig: () => ({ realtimeModel: 'gpt-realtime-2' }),
    normalizeRealtimeVoice: jest.fn(),
}))
jest.mock('./whatsAppCallGold', () => ({ TOKENS_PER_GOLD: 100, reconcileCallUsage: jest.fn() }))
jest.mock('./assistantLiveGold', () => ({ reconcileLiveUsage: jest.fn(async () => ({ chargedGold: 3 })) }))
jest.mock('./whatsAppCallRecap', () => ({
    EMPTY_CALL_RECAP: 'empty',
    generateCallRecap: jest.fn(async () => ({ text: 'We booked the dentist.', tokens: 300 })),
}))
jest.mock('./whatsAppCallSessions', () => ({
    FINAL_STATUSES: new Set(['completed', 'failed']),
    claimRecap: jest.fn(async () => true),
    getCallSession: jest.fn(),
    updateCallSession: jest.fn(async () => {}),
}))
jest.mock('./whatsAppCallTranscript', () => ({
    getCallTranscript: jest.fn(async () => []),
    getCallTranscriptTurn: jest.fn(async () => null),
    storeCallTranscriptTurn: jest.fn(async () => {}),
}))

const admin = require('firebase-admin')
const TwilioWhatsAppService = require('../Services/TwilioWhatsAppService')
const { reconcileCallUsage } = require('./whatsAppCallGold')
const { reconcileLiveUsage } = require('./assistantLiveGold')
const { getCallSession } = require('./whatsAppCallSessions')
const { sendCallRecap } = require('./whatsAppCallController')

const session = { id: 'CA1', channel: 'whatsapp_call', userId: 'u', projectId: 'p', chatId: 'c', assistantId: 'a' }

beforeEach(() => {
    jest.clearAllMocks()
    admin.firestore.mockReturnValue({
        doc: () => ({ get: async () => ({ exists: true, data: () => ({ phone: '+49123' }) }) }),
    })
    TwilioWhatsAppService.mockImplementation(() => ({ sendWhatsAppMessage: async () => ({ success: true }) }))
})

// A Live session's billedGold already holds voice minutes; the token reconciler would
// read them as prepaid recap tokens and never charge the recap.
test('charges the recap of a GPT-Live WhatsApp call through the Live ledger', async () => {
    getCallSession.mockResolvedValue({ ...session, voiceProvider: 'gpt-live' })

    await expect(sendCallRecap('CA1')).resolves.toEqual({ sent: true })

    expect(reconcileLiveUsage).toHaveBeenCalledWith({
        sessionId: 'CA1',
        backend: { id: 'recap:CA1', model: 'gpt-realtime-2', tokensPerGold: 100, tokens: 300 },
    })
    expect(reconcileCallUsage).not.toHaveBeenCalled()
})

test('keeps token billing for a legacy Realtime call recap', async () => {
    getCallSession.mockResolvedValue(session)

    await sendCallRecap('CA1')

    expect(reconcileCallUsage).toHaveBeenCalledWith({ sessionId: 'CA1', eventId: 'recap:CA1', totalTokens: 300 })
    expect(reconcileLiveUsage).not.toHaveBeenCalled()
})
