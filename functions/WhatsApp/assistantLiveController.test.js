jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))
jest.mock('ws', () => {
    const { EventEmitter } = require('events')
    class Socket extends EventEmitter {
        constructor(url) {
            super()
            this.url = url
            this.sent = []
            this.readyState = 1
            Socket.instances.push(this)
        }
        send(value) {
            this.sent.push(JSON.parse(value))
        }
        close() {
            this.readyState = 3
            this.emit('close')
        }
        terminate() {
            this.close()
        }
    }
    Socket.OPEN = 1
    Socket.instances = []
    return Socket
})
jest.mock('./whatsAppCallConfig', () => ({ getWhatsAppCallConfig: () => ({ openAiApiKey: 'key' }) }))
jest.mock('./whatsAppCallSessions', () => ({
    getCallSession: jest.fn(),
    updateCallSession: jest.fn(async () => {}),
    finalizeCallSession: jest.fn(async () => {}),
    FINAL_STATUSES: new Set(['completed', 'failed']),
}))
jest.mock('./whatsAppCallTranscript', () => ({ storeCallTranscriptTurn: jest.fn(async () => ({})) }))
jest.mock('./assistantLiveGold', () => ({ reconcileLiveUsage: jest.fn(async () => ({ currentGold: 100 })) }))
jest.mock('./assistantLiveBackend', () => ({ runLiveAssistant: jest.fn(async () => 'Verified result') }))
const admin = require('firebase-admin')
const Socket = require('ws')
const { getCallSession, finalizeCallSession } = require('./whatsAppCallSessions')
const { reconcileLiveUsage } = require('./assistantLiveGold')
const { runLiveAssistant } = require('./assistantLiveBackend')
const { runAssistantLiveCall, appendText } = require('./assistantLiveController')
let docs
const flush = async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve()
}
const emit = async (socket, event) => {
    socket.emit('message', Buffer.from(JSON.stringify(event)))
    await flush()
}
const user = (id = 't1', text = 'Find tasks') => ({
    type: 'session.input_transcript.delta',
    event_id: id,
    delta: text,
    start_ms: 100,
    end_ms: 600,
})
const delegation = { type: 'session.delegation.created', offset_ms: 700, delegation: { id: 'd1', target: 'client' } }
beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    Socket.instances = []
    const session = {
        id: 's',
        openAiSessionId: 'live_s',
        voiceProvider: 'gpt-live',
        userId: 'u',
        assistantId: 'a',
        projectId: 'p',
        chatId: 'c',
        startedAt: Date.now(),
        expiresAt: Date.now() + 120000,
    }
    getCallSession.mockResolvedValue(session)
    docs = new Map([['whatsAppCallSessions/s', session]])
    const doc = path => ({
        path,
        get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
        collection: name => ({ doc: id => doc(`${path}/${name}/${id}`) }),
        set: async data => docs.set(path, data),
        update: async data => docs.set(path, { ...docs.get(path), ...data }),
    })
    admin.firestore.mockReturnValue({
        doc,
        runTransaction: async fn =>
            fn({
                get: async ref => ({ exists: docs.has(ref.path), data: () => docs.get(ref.path) }),
                set: (ref, data) => docs.set(ref.path, data),
                update: (ref, data) => docs.set(ref.path, { ...docs.get(ref.path), ...data }),
            }),
    })
    runLiveAssistant.mockResolvedValue('Verified result')
})
afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
})

async function start() {
    const running = runAssistantLiveCall('s')
    await flush()
    const socket = Socket.instances[0]
    socket.emit('open')
    await flush()
    return { running, socket }
}
async function finish({ running, socket }) {
    await emit(socket, { type: 'session.closed', reason: 'close_requested', usage: { seconds: 20 } })
    await running
}

test('attaches to the Live session, waits for transcript context and deduplicates delegations', async () => {
    const state = await start()
    expect(state.socket.url).toBe('wss://api.openai.com/v1/live/sessions/live_s/attach')
    await emit(state.socket, delegation)
    await jest.advanceTimersByTimeAsync(1200)
    expect(runLiveAssistant).not.toHaveBeenCalled()
    await emit(state.socket, user())
    await emit(state.socket, delegation)
    await jest.advanceTimersByTimeAsync(1200)
    expect(runLiveAssistant).toHaveBeenCalledTimes(1)
    expect(state.socket.sent).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                type: 'session.commentary.append',
                delegation_id: 'd1',
                content: 'Verified result',
            }),
        ])
    )
    await finish(state)
    expect(reconcileLiveUsage).toHaveBeenLastCalledWith({ sessionId: 's', seconds: 20, final: true })
    expect(finalizeCallSession).toHaveBeenCalledWith('s', 'close_requested', 'completed')
})

test('keeps receiving speech while backend work runs and rejects stale side effects', async () => {
    let resolveBackend
    runLiveAssistant.mockImplementationOnce(
        () =>
            new Promise(resolve => {
                resolveBackend = resolve
            })
    )
    const state = await start()
    await emit(state.socket, user())
    await emit(state.socket, delegation)
    await jest.advanceTimersByTimeAsync(1200)
    const active = runLiveAssistant.mock.calls[0][0]
    await emit(state.socket, user('t2', ' Actually, tomorrow.'))
    await expect(active.assertActive()).rejects.toThrow('voice_request_superseded')
    resolveBackend('Old result')
    await flush()
    expect(state.socket.sent.some(event => event.content === 'Old result')).toBe(false)
    await finish(state)
})

test('bounds append payloads even for multibyte text', () => {
    expect(Buffer.byteLength(appendText('界'.repeat(1000)), 'utf8')).toBeLessThanOrEqual(480)
})

test('after losing sideband speech, reattaches only to close and settle', async () => {
    const state = await start()
    await emit(state.socket, user())
    await emit(state.socket, delegation)
    state.socket.close()
    await jest.advanceTimersByTimeAsync(1500)
    const reattached = Socket.instances[1]
    expect(reattached).toBeDefined()
    reattached.emit('open')
    await emit(reattached, user('new', 'Do something'))
    await jest.advanceTimersByTimeAsync(1200)
    expect(runLiveAssistant).not.toHaveBeenCalled()
    expect(reattached.sent).toContainEqual({ type: 'session.close' })
    await finish({ running: state.running, socket: reattached })
})

test('honors browser cancellation while idle and does not execute another delegation', async () => {
    const state = await start()
    docs.get('whatsAppCallSessions/s').cancelRequestedAt = Date.now()
    await jest.advanceTimersByTimeAsync(2400)
    expect(state.socket.sent).toContainEqual({ type: 'session.close' })
    expect(runLiveAssistant).not.toHaveBeenCalled()
    await finish(state)
})

test('controller connection does not request a greeting and records its later browser acknowledgement', async () => {
    const { updateCallSession } = require('./whatsAppCallSessions')
    const state = await start()
    expect(state.socket.sent.find(e => e.event_id === 'alldone_live_ready').content).toContain('Remain silent')
    expect(state.socket.sent.some(e => e.type === 'session.commentary.append')).toBe(false)
    await emit(state.socket, { type: 'session.commentary.appended', client_event_id: 'alldone_live_greeting' })
    expect(updateCallSession).toHaveBeenCalledWith('s', { greetingAcknowledgedAt: expect.any(Number) })
    await finish(state)
})
