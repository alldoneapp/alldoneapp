const mockTaskEnqueue = jest.fn()
const mockTaskQueue = jest.fn(() => ({ enqueue: mockTaskEnqueue }))
jest.mock(
    'firebase-admin/functions',
    () => ({
        getFunctions: jest.fn(() => ({ taskQueue: mockTaskQueue })),
    }),
    { virtual: true }
)
jest.mock('../Assistant/assistantHelper', () => ({ getAssistantForChat: jest.fn() }))
jest.mock('./whatsAppCallConfig', () => ({
    REGION: 'europe-west1',
    getWhatsAppCallConfig: jest.fn(),
    normalizeRealtimeVoice: jest.fn(value => value || 'marin'),
}))
jest.mock('./whatsAppCallSecurity', () => ({
    extractRoutingTokenFromSipHeaders: jest.fn(() => 'route-token'),
    getRawRequestBody: jest.fn(req => req.rawBody.toString()),
    verifyOpenAIWebhookSignature: jest.fn(() => true),
}))
jest.mock('./whatsAppCallSessions', () => ({
    FINAL_STATUSES: new Set(['completed', 'failed', 'rejected', 'stale', 'cancelled']),
    consumeRoutingToken: jest.fn(),
    finalizeCallSession: jest.fn(),
    updateCallSession: jest.fn(),
}))
jest.mock('./whatsAppCallController', () => ({ sendCallRecap: jest.fn(async () => ({})) }))
jest.mock('./assistantLiveGold', () => ({ reconcileLiveUsage: jest.fn(async () => ({ currentGold: 90 })) }))
jest.mock('../Assistant/assistantConversationStyle', () => ({ getConversationStyleInstructions: () => [] }))

const { getAssistantForChat } = require('../Assistant/assistantHelper')
const { getWhatsAppCallConfig } = require('./whatsAppCallConfig')
const { extractRoutingTokenFromSipHeaders, verifyOpenAIWebhookSignature } = require('./whatsAppCallSecurity')
const { consumeRoutingToken, finalizeCallSession, updateCallSession } = require('./whatsAppCallSessions')
const { reconcileLiveUsage } = require('./assistantLiveGold')
const { getRunCallTaskId, handleOpenAIRealtimeCallWebhook } = require('./whatsAppCallOpenAIWebhook')

describe('GPT-Live-only SIP routing', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        getWhatsAppCallConfig.mockReturnValue({
            openAiApiKey: 'key',
            openAiWebhookSecret: 'secret',
            routingTokenSecret: 'route-secret',
            openAiProjectId: 'project',
        })
        global.fetch = jest.fn()
    })

    test('uses deterministic hashed Cloud Task IDs for webhook retries', () => {
        expect(getRunCallTaskId('call-1')).toBe(getRunCallTaskId('call-1'))
        expect(getRunCallTaskId('call-1')).not.toBe(getRunCallTaskId('call-2'))
        expect(getRunCallTaskId('call-1')).not.toContain('call-1')
    })

    test.each(['openai-call', 'live_1', undefined])(
        'ignores old events (%s) without consuming or rejecting the shared SIP leg',
        async call_id => {
            const res = { status: jest.fn().mockReturnThis(), send: jest.fn().mockReturnThis() }
            const log = jest.spyOn(console, 'error').mockImplementation(() => {})
            await handleOpenAIRealtimeCallWebhook(
                {
                    method: 'POST',
                    headers: {},
                    rawBody: Buffer.from(JSON.stringify({ type: 'realtime.call.incoming', data: { call_id } })),
                },
                res
            )
            expect(res.status).toHaveBeenCalledWith(200)
            expect(consumeRoutingToken).not.toHaveBeenCalled()
            expect(global.fetch).not.toHaveBeenCalled()
            expect(mockTaskEnqueue).not.toHaveBeenCalled()
            expect(log).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    code: 'gpt_live_sip_subscription_required',
                    action: expect.stringContaining('live.transport.incoming'),
                })
            )
            log.mockRestore()
        }
    )
})

describe('OpenAI incoming Live SIP call webhook (phone and WhatsApp)', () => {
    const config = {
        openAiApiKey: 'key',
        openAiWebhookSecret: 'secret',
        routingTokenSecret: 'route-secret',
        openAiProjectId: 'project',
    }
    const routedSession = {
        status: 'routing',
        channel: 'phone_call',
        userId: 'user-1',
        projectId: 'project-1',
        assistantId: 'assistant-1',
        language: 'de',
    }
    const call = async (type = 'live.transport.incoming', data = { type: 'sip', session_id: 'live_1' }) => {
        const res = { status: jest.fn().mockReturnThis(), send: jest.fn().mockReturnThis() }
        await handleOpenAIRealtimeCallWebhook(
            { method: 'POST', headers: {}, rawBody: Buffer.from(JSON.stringify({ type, data })) },
            res
        )
        return res
    }
    const fetchedUrls = () => global.fetch.mock.calls.map(([url]) => url)

    beforeEach(() => {
        jest.clearAllMocks()
        getWhatsAppCallConfig.mockReturnValue(config)
        global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => '' }))
        getAssistantForChat.mockResolvedValue({ displayName: 'Anna Alldone', realtimeVoice: 'cedar' })
        consumeRoutingToken.mockResolvedValue({ success: true, sessionId: 'CA1', session: routedSession })
        reconcileLiveUsage.mockResolvedValue({ currentGold: 90 })
        updateCallSession.mockResolvedValue()
    })

    test('accepts the SIP call as a gpt-live-1 session and queues the shared Live controller', async () => {
        await call()

        expect(consumeRoutingToken).toHaveBeenCalledWith(expect.objectContaining({ openAiCallId: 'live_1' }))
        expect(updateCallSession).toHaveBeenCalledWith(
            'CA1',
            expect.objectContaining({
                openAiSessionId: 'live_1',
                voiceProvider: 'gpt-live',
                voiceModel: 'gpt-live-1',
                voiceGoldPerMinute: 40,
                realtimeModel: null,
            })
        )
        expect(fetchedUrls()).toEqual(['https://api.openai.com/v1/live/sessions/live_1/accept'])
        const { session } = JSON.parse(global.fetch.mock.calls[0][1].body)
        expect(session).toEqual(
            expect.objectContaining({
                type: 'live',
                model: 'gpt-live-1',
                store: false,
                delegation: { type: 'client' },
                audio: { output: { voice: 'cedar' } },
            })
        )
        expect(session.instructions).toContain('You are Anna, answering a phone call from the user.')
        expect(reconcileLiveUsage).toHaveBeenCalledWith({ sessionId: 'CA1', seconds: 15 })
        expect(mockTaskEnqueue).toHaveBeenCalledWith(
            { sessionId: 'CA1' },
            { id: getRunCallTaskId('CA1'), dispatchDeadlineSeconds: 1800 }
        )
        expect(updateCallSession).toHaveBeenCalledWith(
            'CA1',
            expect.objectContaining({ status: 'controller_queued', realtimeVoice: 'cedar' })
        )
    })

    test.each(['phone_call', 'whatsapp_call'])(
        'lets Live accept %s after an old event arrives first',
        async channel => {
            consumeRoutingToken.mockResolvedValue({
                success: true,
                sessionId: 'CA1',
                session: { ...routedSession, channel, voiceProvider: 'gpt-live', voiceBilledGold: 0 },
            })
            await call('realtime.call.incoming', { call_id: 'old_id' })
            expect(consumeRoutingToken).not.toHaveBeenCalled()
            await call()
            expect(fetchedUrls()).toEqual(['https://api.openai.com/v1/live/sessions/live_1/accept'])
            expect(mockTaskEnqueue).toHaveBeenCalledTimes(1)
            await call('realtime.call.incoming', { call_id: 'old_id' })
            expect(fetchedUrls()).toHaveLength(1)
            expect(mockTaskEnqueue).toHaveBeenCalledTimes(1)
        }
    )

    test('reports missing SIP configuration without accepting or consuming the route', async () => {
        getWhatsAppCallConfig.mockReturnValue({ ...config, openAiProjectId: '' })
        const res = await call()
        expect(res.status).toHaveBeenCalledWith(503)
        expect(res.send).toHaveBeenCalledWith(expect.stringContaining('OPENAI_PROJECT_ID'))
        expect(consumeRoutingToken).not.toHaveBeenCalled()
        expect(mockTaskEnqueue).not.toHaveBeenCalled()
        expect(fetchedUrls()).toEqual(['https://api.openai.com/v1/live/sessions/live_1/reject'])
    })

    test.each([403, 404, 500])('fails explicitly on Live accept HTTP %s without a Realtime fallback', async status => {
        global.fetch.mockResolvedValueOnce({ ok: false, status, text: async () => 'unavailable' })
        await call()
        expect(mockTaskEnqueue).not.toHaveBeenCalled()
        expect(finalizeCallSession).toHaveBeenCalledWith('CA1', 'openai_accept_failed', 'failed')
        expect(updateCallSession).toHaveBeenCalledWith(
            'CA1',
            expect.objectContaining({
                lastError: 'gpt_live_accept_failed',
                configurationAction: expect.stringContaining('live.transport.incoming'),
            })
        )
        expect(fetchedUrls()).toEqual([
            'https://api.openai.com/v1/live/sessions/live_1/accept',
            'https://api.openai.com/v1/live/sessions/live_1/hangup',
        ])
    })

    test('accepts the deprecated live.call.incoming name during the subscription migration', async () => {
        await call('live.call.incoming', { session_id: 'live_1' })
        expect(fetchedUrls()).toEqual(['https://api.openai.com/v1/live/sessions/live_1/accept'])
    })

    test('names the WhatsApp channel in the Live prompt', async () => {
        consumeRoutingToken.mockResolvedValue({
            success: true,
            sessionId: 'CA1',
            session: { ...routedSession, channel: 'whatsapp_call' },
        })
        await call()
        const { session } = JSON.parse(global.fetch.mock.calls[0][1].body)
        expect(session.instructions).toContain('answering a WhatsApp call from the user')
    })

    test('ignores non-SIP Live transports', async () => {
        await call('live.transport.incoming', { type: 'webrtc', session_id: 'live_1' })
        expect(consumeRoutingToken).not.toHaveBeenCalled()
        expect(global.fetch).not.toHaveBeenCalled()
    })

    test('rejects an invalid route through the Live reject endpoint', async () => {
        consumeRoutingToken.mockResolvedValue({ success: false, reason: 'expired_route' })
        await call()
        expect(global.fetch).toHaveBeenCalledWith(
            'https://api.openai.com/v1/live/sessions/live_1/reject',
            expect.objectContaining({ body: JSON.stringify({ status_code: 486 }) })
        )
        expect(mockTaskEnqueue).not.toHaveBeenCalled()
    })

    test('does not reject a route already consumed by another event for the same SIP call', async () => {
        consumeRoutingToken.mockResolvedValue({ success: false, reason: 'replayed_route' })
        await call()
        expect(global.fetch).not.toHaveBeenCalled()
    })

    test('does not start a worker when a retry cannot confirm Live acceptance', async () => {
        consumeRoutingToken.mockResolvedValue({
            success: true,
            duplicate: true,
            sessionId: 'CA1',
            session: { ...routedSession, voiceProvider: 'gpt-live' },
        })
        global.fetch.mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'Live access missing' })
        await call()
        expect(mockTaskEnqueue).not.toHaveBeenCalled()
        expect(reconcileLiveUsage).not.toHaveBeenCalled()
        expect(finalizeCallSession).toHaveBeenCalledWith('CA1', 'openai_accept_failed', 'failed')
    })

    test('acknowledges an already queued Live retry without accepting or charging twice', async () => {
        consumeRoutingToken.mockResolvedValue({
            success: true,
            duplicate: true,
            sessionId: 'CA1',
            session: { ...routedSession, voiceProvider: 'gpt-live', status: 'controller_queued', acceptCompletedAt: 1 },
        })
        await call()
        expect(global.fetch).not.toHaveBeenCalled()
        expect(reconcileLiveUsage).not.toHaveBeenCalled()
        expect(mockTaskEnqueue).not.toHaveBeenCalled()
    })

    test('rejects a missing SIP route using only the Live endpoint', async () => {
        extractRoutingTokenFromSipHeaders.mockReturnValueOnce('')
        await call()
        expect(consumeRoutingToken).not.toHaveBeenCalled()
        expect(fetchedUrls()).toEqual(['https://api.openai.com/v1/live/sessions/live_1/reject'])
    })

    test('does not consume routes or contact the provider for an invalid signature', async () => {
        verifyOpenAIWebhookSignature.mockReturnValueOnce(false)
        const res = await call()
        expect(res.status).toHaveBeenCalledWith(403)
        expect(consumeRoutingToken).not.toHaveBeenCalled()
        expect(global.fetch).not.toHaveBeenCalled()
    })

    test('does not reset voice billing when a webhook retry arrives after the first accept', async () => {
        consumeRoutingToken.mockResolvedValue({
            success: true,
            duplicate: true,
            sessionId: 'CA1',
            session: {
                ...routedSession,
                status: 'accepted',
                voiceProvider: 'gpt-live',
                openAiSessionId: 'live_1',
                acceptCompletedAt: 1,
            },
        })
        await call()
        expect(global.fetch).not.toHaveBeenCalled()
        expect(updateCallSession).not.toHaveBeenCalledWith('CA1', expect.objectContaining({ voiceBilledGold: 0 }))
        expect(mockTaskEnqueue).toHaveBeenCalled()
    })

    test('hangs up and settles the call when the Gold minimum cannot be charged', async () => {
        reconcileLiveUsage.mockResolvedValue({ insufficientBalance: true, currentGold: 0 })
        await call()
        expect(fetchedUrls()).toContain('https://api.openai.com/v1/live/sessions/live_1/hangup')
        expect(finalizeCallSession).toHaveBeenCalledWith('CA1', 'openai_accept_failed', 'failed')
        expect(mockTaskEnqueue).not.toHaveBeenCalled()
    })
})
