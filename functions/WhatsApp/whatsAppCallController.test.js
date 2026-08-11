jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))
jest.mock('ws', () => jest.fn())
jest.mock('../Services/TwilioWhatsAppService', () => jest.fn())
jest.mock('../Assistant/assistantHelper', () => ({
    addBaseInstructions: jest.fn(),
    buildCompactThreadContextMessage: jest.fn(),
    buildConversationSafeToolResult: jest.fn(),
    executeToolNatively: jest.fn(),
    filterAllowedToolsForRuntimeContext: jest.fn(),
    getAssistantForChat: jest.fn(),
    getDynamicToolSchemasWithCache: jest.fn(),
    getOpenTasksContextMessage: jest.fn(),
    isToolAllowedForExecution: jest.fn(),
    loadAssistantThreadState: jest.fn(),
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
const WebSocket = require('ws')
const {
    addBaseInstructions,
    buildCompactThreadContextMessage,
    filterAllowedToolsForRuntimeContext,
    getAssistantForChat,
    getDynamicToolSchemasWithCache,
    getOpenTasksContextMessage,
    loadAssistantThreadState,
} = require('../Assistant/assistantHelper')
const TwilioWhatsAppService = require('../Services/TwilioWhatsAppService')
const { getConversationHistory } = require('./whatsAppDailyTopic')
const { getWhatsAppCallConfig } = require('./whatsAppCallConfig')
const { reconcileCallUsage } = require('./whatsAppCallGold')
const { claimRecap, finalizeCallSession, getCallSession, updateCallSession } = require('./whatsAppCallSessions')
const { getCallTranscript, getCallTranscriptTurn } = require('./whatsAppCallTranscript')
const {
    buildRealtimeSessionUpdate,
    createConversationItem,
    runWhatsAppRealtimeCall,
    sendCallRecap,
} = require('./whatsAppCallController')

describe('WhatsApp call sideband configuration', () => {
    const config = {
        openAiApiKey: 'key',
        realtimeModel: 'gpt-realtime-2',
        transcriptionModel: 'gpt-realtime-whisper',
        reasoningEffort: 'medium',
        maxDurationSeconds: 1800,
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

    test.each(['phone_call', 'browser_call'])('skips the recap for %s calls (non-WhatsApp)', async channel => {
        claimRecap.mockResolvedValue(true)
        updateCallSession.mockResolvedValue()
        getCallSession.mockResolvedValue({
            id: 'call-1',
            userId: 'user-1',
            projectId: 'project-1',
            chatId: 'chat-1',
            assistantId: 'assistant-1',
            channel,
        })
        getCallTranscriptTurn.mockResolvedValue({ role: 'assistant', text: 'Call recap: Existing recap.' })
        const sendWhatsAppMessage = jest.fn(async () => ({ success: true }))
        TwilioWhatsAppService.mockImplementation(() => ({ sendWhatsAppMessage }))

        await expect(sendCallRecap('call-1')).resolves.toEqual({
            sent: false,
            reason: 'recap_disabled_for_channel',
        })

        expect(claimRecap).not.toHaveBeenCalled()
        expect(getCallTranscriptTurn).not.toHaveBeenCalled()
        expect(sendWhatsAppMessage).not.toHaveBeenCalled()
        expect(updateCallSession).toHaveBeenCalledWith('call-1', { recapStatus: 'skipped' })
    })

    test('connects and greets before slow dynamic tool context finishes loading', async () => {
        let resolveDynamicTools
        const dynamicToolsPending = new Promise(resolve => {
            resolveDynamicTools = resolve
        })
        let resolveGreetingSent
        const greetingSent = new Promise(resolve => {
            resolveGreetingSent = resolve
        })
        const socket = {
            readyState: 1,
            send: jest.fn(payload => {
                if (JSON.parse(payload).type === 'response.create') resolveGreetingSent()
            }),
            on: jest.fn(),
            once: jest.fn(),
            close: jest.fn(),
        }
        const eventHandlers = {}
        socket.on.mockImplementation((event, handler) => {
            eventHandlers[event] = handler
            return socket
        })
        socket.once.mockImplementation((event, handler) => {
            eventHandlers[event] = handler
            return socket
        })
        WebSocket.OPEN = 1
        WebSocket.mockImplementation(() => {
            setImmediate(() => eventHandlers.open())
            return socket
        })

        const now = Date.now()
        getCallSession.mockResolvedValue({
            id: 'call-1',
            status: 'controller_queued',
            openAiCallId: 'openai-call-1',
            userId: 'user-1',
            projectId: 'project-1',
            assistantId: 'assistant-1',
            chatId: 'chat-1',
            createdAt: now,
            startedAt: now,
        })
        admin.firestore.mockReturnValue({
            doc: jest.fn(() => ({
                get: jest.fn(async () => ({
                    exists: true,
                    data: () => ({ language: 'English' }),
                })),
            })),
        })
        getAssistantForChat.mockResolvedValue({
            name: 'Anna',
            instructions: 'Help the caller.',
            allowedTools: ['get_tasks'],
        })
        getConversationHistory.mockResolvedValue([['user', 'Earlier context']])
        filterAllowedToolsForRuntimeContext.mockReturnValue(['get_tasks'])
        getDynamicToolSchemasWithCache.mockReturnValue(dynamicToolsPending)
        addBaseInstructions.mockImplementation(async messages => {
            messages.push(['system', 'Full instructions'])
        })
        getOpenTasksContextMessage.mockResolvedValue({
            message: 'Today (including overdue) the user has 5 open tasks in total.',
        })
        loadAssistantThreadState.mockResolvedValue({ trimHistoryBeforeMs: 1700000000000 })
        buildCompactThreadContextMessage.mockReturnValue('Compacted thread summary: prior progress.')
        updateCallSession.mockResolvedValue()
        finalizeCallSession.mockResolvedValue()
        claimRecap.mockResolvedValue(false)

        const callPromise = runWhatsAppRealtimeCall('call-1')
        await greetingSent

        expect(getDynamicToolSchemasWithCache).toHaveBeenCalled()
        expect(addBaseInstructions).not.toHaveBeenCalled()
        const sentEvents = socket.send.mock.calls.map(([payload]) => JSON.parse(payload))
        expect(sentEvents.map(event => event.type)).toEqual(
            expect.arrayContaining(['session.update', 'response.create'])
        )
        expect(sentEvents.find(event => event.type === 'session.update').session.audio.output).toBeUndefined()
        expect(sentEvents.find(event => event.type === 'session.update').session.tools).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: 'function',
                    name: 'get_tasks',
                }),
            ])
        )
        expect(sentEvents.find(event => event.type === 'session.update').session.instructions).toContain(
            'Never say you are ChatGPT'
        )
        expect(sentEvents.find(event => event.type === 'session.update').session.instructions).toContain(
            'All task IDs are silent by default'
        )
        expect(sentEvents.find(event => event.type === 'response.create').response.instructions).toContain(
            'introduce yourself only as Anna'
        )
        expect(sentEvents.find(event => event.type === 'response.create').response.instructions).toContain(
            'Greet the caller briefly in English'
        )
        expect(sentEvents.find(event => event.type === 'session.update').session.instructions).toContain(
            'Start the call in English'
        )
        // Prior thread history is carried as a labeled background-context block in the
        // instructions, not replayed as live conversation turns.
        expect(sentEvents.find(event => event.type === 'session.update').session.instructions).toContain(
            'Background context — here is what was discussed'
        )
        expect(sentEvents.find(event => event.type === 'session.update').session.instructions).toContain(
            'User: Earlier context'
        )
        expect(sentEvents.some(event => event.type === 'conversation.item.create')).toBe(false)

        resolveDynamicTools([])
        await new Promise(resolve => setImmediate(resolve))
        expect(addBaseInstructions).toHaveBeenCalled()
        expect(getOpenTasksContextMessage).toHaveBeenCalledWith('user-1', null)
        expect(getConversationHistory).toHaveBeenCalledWith('project-1', 'chat-1', 20, null, 1700000000000)
        const enrichedSessionUpdate = socket.send.mock.calls
            .map(([payload]) => JSON.parse(payload))
            .reverse()
            .find(event => event.type === 'session.update')
        expect(enrichedSessionUpdate.session.instructions).toContain(
            'Today (including overdue) the user has 5 open tasks in total.'
        )
        expect(enrichedSessionUpdate.session.instructions).toContain('Compacted thread summary: prior progress.')
        expect(enrichedSessionUpdate.session.instructions).toContain('Start the call in English')
        expect(enrichedSessionUpdate.session.instructions).toContain('All task IDs are silent by default')
        expect(enrichedSessionUpdate.session.instructions).toContain('User: Earlier context')
        // History is never replayed as live conversation items, only carried in instructions.
        expect(
            socket.send.mock.calls
                .map(([payload]) => JSON.parse(payload))
                .some(event => event.type === 'conversation.item.create')
        ).toBe(false)

        socket.readyState = 3
        eventHandlers.close(1000)
        await callPromise
    })

    test('lets the assistant end the call: acks end_call, plays the farewell, then hangs up', async () => {
        // Collapse the farewell grace (and other short waits) to near-zero so the hangup path runs
        // fast, while keeping the long max-duration deadline timer real (it never fires in the test).
        const originalSetTimeout = global.setTimeout
        global.setTimeout = (fn, delay = 0, ...args) => originalSetTimeout(fn, delay >= 60000 ? delay : 0, ...args)
        try {
            const socket = { readyState: 1, send: jest.fn(), on: jest.fn(), once: jest.fn(), close: jest.fn() }
            let resolveGreetingSent
            const greetingSent = new Promise(resolve => {
                resolveGreetingSent = resolve
            })
            socket.send.mockImplementation(payload => {
                if (JSON.parse(payload).type === 'response.create') resolveGreetingSent()
            })
            const eventHandlers = {}
            socket.on.mockImplementation((event, handler) => {
                eventHandlers[event] = handler
                return socket
            })
            socket.once.mockImplementation((event, handler) => {
                eventHandlers[event] = handler
                return socket
            })
            socket.close.mockImplementation(() => {
                socket.readyState = 3
                if (eventHandlers.close) eventHandlers.close(1000)
            })
            WebSocket.OPEN = 1
            WebSocket.mockImplementation(() => {
                setImmediate(() => eventHandlers.open())
                return socket
            })

            const now = Date.now()
            getCallSession.mockResolvedValue({
                id: 'call-1',
                status: 'controller_queued',
                openAiCallId: 'openai-call-1',
                userId: 'user-1',
                projectId: 'project-1',
                assistantId: 'assistant-1',
                chatId: 'chat-1',
                createdAt: now,
                startedAt: now,
            })
            admin.firestore.mockReturnValue({
                doc: jest.fn(() => ({
                    get: jest.fn(async () => ({ exists: true, data: () => ({ language: 'English' }) })),
                })),
            })
            getAssistantForChat.mockResolvedValue({
                name: 'Anna',
                instructions: 'Help the caller.',
                allowedTools: ['get_tasks'],
            })
            getConversationHistory.mockResolvedValue([])
            filterAllowedToolsForRuntimeContext.mockReturnValue(['get_tasks'])
            getDynamicToolSchemasWithCache.mockResolvedValue([])
            addBaseInstructions.mockImplementation(async messages => {
                messages.push(['system', 'Full instructions'])
            })
            getOpenTasksContextMessage.mockResolvedValue({ message: '' })
            loadAssistantThreadState.mockResolvedValue(null)
            updateCallSession.mockResolvedValue()
            finalizeCallSession.mockResolvedValue()
            claimRecap.mockResolvedValue(false)
            global.fetch = jest.fn(async () => ({ ok: true, status: 200 }))

            const callPromise = runWhatsAppRealtimeCall('call-1')
            await greetingSent

            // The assistant speaks a farewell and calls end_call in the same response.
            eventHandlers.message(
                JSON.stringify({
                    type: 'response.done',
                    event_id: 'evt-1',
                    response: {
                        id: 'resp-1',
                        output: [
                            {
                                id: 'msg-1',
                                type: 'message',
                                content: [{ type: 'audio', transcript: 'Talk soon, take care. Bye!' }],
                            },
                            {
                                id: 'fc-1',
                                type: 'function_call',
                                name: 'end_call',
                                call_id: 'fc-1',
                                arguments: '{"reason":"caller said goodbye"}',
                            },
                        ],
                    },
                })
            )

            await callPromise

            const sentEvents = socket.send.mock.calls.map(([payload]) => JSON.parse(payload))
            const ack = sentEvents.find(
                event => event.type === 'conversation.item.create' && event.item?.type === 'function_call_output'
            )
            expect(ack.item.call_id).toBe('fc-1')
            expect(ack.item.output).toContain('"status":"ending"')
            // A farewell was already spoken, so no second closing response is generated after end_call.
            const responseCreateAfterEndCall = sentEvents
                .slice(sentEvents.indexOf(ack) + 1)
                .filter(event => event.type === 'response.create')
            expect(responseCreateAfterEndCall).toHaveLength(0)

            expect(global.fetch).toHaveBeenCalledWith(
                'https://api.openai.com/v1/realtime/calls/openai-call-1/hangup',
                expect.objectContaining({ method: 'POST' })
            )
            expect(socket.close).toHaveBeenCalled()
            expect(finalizeCallSession).toHaveBeenCalledWith('call-1', 'assistant_ended_call', 'completed')
        } finally {
            global.setTimeout = originalSetTimeout
        }
    })
})
