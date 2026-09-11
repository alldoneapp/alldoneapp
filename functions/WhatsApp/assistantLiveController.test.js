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
            const event = JSON.parse(value)
            this.sent.push(event)
            if (Socket.autoAcknowledge && ['session.thinking.append', 'session.commentary.append'].includes(event.type))
                Promise.resolve().then(() => {
                    if (this.readyState === 1)
                        this.emit(
                            'message',
                            Buffer.from(JSON.stringify({ type: `${event.type}ed`, client_event_id: event.event_id }))
                        )
                })
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
    Socket.autoAcknowledge = true
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
let watchers
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
    watchers = new Map()
    const doc = path => ({
        path,
        get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
        collection: name => ({ doc: id => doc(`${path}/${name}/${id}`) }),
        set: async data => docs.set(path, data),
        update: async data => docs.set(path, { ...docs.get(path), ...data }),
        onSnapshot: (next, error) => {
            const unsubscribe = jest.fn(() => watchers.delete(path))
            watchers.set(path, { next, error, unsubscribe })
            return unsubscribe
        },
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
    await jest.advanceTimersByTimeAsync(2100)
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
    const run = [...docs.entries()].find(([path]) => path.includes('/liveDelegations/'))[1]
    expect(run).toMatchObject({
        deliveryStatus: 'answer_acknowledged',
        contextAcknowledgedAt: expect.any(Number),
        answerAcknowledgedAt: expect.any(Number),
    })
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

test('records the sideband close code and controller trigger separately from provider completion', async () => {
    const { updateCallSession } = require('./whatsAppCallSessions')
    const state = await start()
    state.socket.readyState = 3
    state.socket.emit('close', 1006, Buffer.from('unlogged provider detail'))
    await flush()
    expect(updateCallSession).toHaveBeenCalledWith('s', {
        sidebandClose: expect.objectContaining({ code: 1006, ending: false }),
    })
    expect(updateCallSession).toHaveBeenCalledWith(
        's',
        expect.objectContaining({ serverDisconnect: expect.objectContaining({ trigger: 'connection_lost' }) })
    )
    expect(JSON.stringify(updateCallSession.mock.calls)).not.toContain('unlogged provider detail')
    await jest.advanceTimersByTimeAsync(1200)
    const reattached = Socket.instances[1]
    reattached.emit('open')
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

const progressMessages = socket =>
    socket.sent.filter(e => e.type === 'session.commentary.append' && e.content !== 'Verified result')

test('slow work speaks occasional factual updates and completion stops them', async () => {
    let complete
    runLiveAssistant.mockImplementationOnce(
        () =>
            new Promise(resolve => {
                complete = resolve
            })
    )
    const state = await start()
    await emit(state.socket, user())
    await emit(state.socket, delegation)
    await jest.advanceTimersByTimeAsync(1200)
    const active = runLiveAssistant.mock.calls[0][0]
    active.onProgress('Searching the workspace; no result yet.')
    await jest.advanceTimersByTimeAsync(7000)
    expect(progressMessages(state.socket)).toHaveLength(0)
    await jest.advanceTimersByTimeAsync(1200)
    expect(progressMessages(state.socket)).toEqual([
        expect.objectContaining({
            delegation_id: 'd1',
            content: 'Searching the workspace; no result yet.',
        }),
    ])
    active.onProgress('Working through the results.')
    await jest.advanceTimersByTimeAsync(19000)
    expect(progressMessages(state.socket)).toHaveLength(1)
    await jest.advanceTimersByTimeAsync(1200)
    expect(progressMessages(state.socket)).toHaveLength(2)
    complete('Verified result')
    await flush()
    await jest.advanceTimersByTimeAsync(46000)
    expect(progressMessages(state.socket)).toHaveLength(2)
    await finish(state)
})

test.each(['correction', 'cancel', 'failure', 'disconnect'])('stops old progress after %s', async reason => {
    let complete, fail
    runLiveAssistant.mockImplementationOnce(
        () =>
            new Promise((resolve, reject) => {
                complete = resolve
                fail = reject
            })
    )
    const state = await start()
    await emit(state.socket, user())
    await emit(state.socket, delegation)
    await jest.advanceTimersByTimeAsync(1200)
    if (reason === 'correction') await emit(state.socket, user('new', 'Actually, stop.'))
    if (reason === 'cancel') docs.get('whatsAppCallSessions/s').cancelRequestedAt = Date.now()
    if (reason === 'failure') fail(new Error('failed'))
    if (reason === 'disconnect') state.socket.close()
    await jest.advanceTimersByTimeAsync(9000)
    expect(progressMessages(state.socket).some(e => e.content.includes('still working'))).toBe(false)
    if (reason !== 'failure') complete('Verified result')
    await flush()
    if (reason === 'disconnect') {
        const reattached = Socket.instances[1]
        reattached.emit('open')
        expect(progressMessages(reattached)).toHaveLength(0)
        await finish({ running: state.running, socket: reattached })
    } else await finish(state)
})

test('fast work needs no progress announcement', async () => {
    const state = await start()
    await emit(state.socket, user())
    await emit(state.socket, delegation)
    await jest.advanceTimersByTimeAsync(15000)
    expect(progressMessages(state.socket)).toHaveLength(0)
    await finish(state)
})

test('observes authoritative background status after dispatch and releases the listener on completion', async () => {
    runLiveAssistant.mockImplementationOnce(async ({ onBackgroundJob }) => {
        onBackgroundJob('job-1')
        return 'Verified result'
    })
    const state = await start()
    await emit(state.socket, user())
    await emit(state.socket, delegation)
    await jest.advanceTimersByTimeAsync(1200)
    const watcher = watchers.get('pendingWebhooks/job-1')
    const update = status =>
        watcher.next({ data: () => ({ kind: 'vm_job', userId: 'u', status, output: 'Private output' }) })
    update('running')
    await jest.advanceTimersByTimeAsync(9000)
    // An acknowledged answer gets a chance to speak before background updates.
    expect(progressMessages(state.socket)).toHaveLength(0)
    await jest.advanceTimersByTimeAsync(3000)
    expect(progressMessages(state.socket)).toHaveLength(1)
    expect(progressMessages(state.socket)[0].content).toContain('still running')
    update('awaiting_user')
    await jest.advanceTimersByTimeAsync(21000)
    expect(progressMessages(state.socket).at(-1).content).toContain('needs your input')
    update('completed')
    await jest.advanceTimersByTimeAsync(21000)
    expect(progressMessages(state.socket).at(-1).content).toContain('run has finished')
    expect(JSON.stringify(state.socket.sent)).not.toContain('Private output')
    expect(watcher.unsubscribe).toHaveBeenCalledTimes(1)
    await finish(state)
})

test('keeps dispatched jobs across speech, checks ownership and releases observation when the call closes', async () => {
    runLiveAssistant.mockImplementationOnce(async ({ onBackgroundJob }) => {
        onBackgroundJob('job-1')
        return 'Verified result'
    })
    const state = await start()
    await emit(state.socket, user())
    await emit(state.socket, delegation)
    await jest.advanceTimersByTimeAsync(1200)
    const watcher = watchers.get('pendingWebhooks/job-1')
    // Ignore a mismatching owner even for a tool-returned ID.
    watcher.next({ data: () => ({ kind: 'vm_job', userId: 'someone-else', status: 'completed' }) })
    await jest.advanceTimersByTimeAsync(9000)
    expect(progressMessages(state.socket)).toHaveLength(0)
    await emit(state.socket, user('new', 'Thanks, keep me posted.'))
    expect(watcher.unsubscribe).not.toHaveBeenCalled()
    watcher.next({ data: () => ({ kind: 'vm_job', userId: 'u', status: 'running' }) })
    await jest.advanceTimersByTimeAsync(3000)
    expect(progressMessages(state.socket)).toHaveLength(0)
    await jest.advanceTimersByTimeAsync(1500)
    expect(progressMessages(state.socket).at(-1).content).toContain('still running')
    await finish(state)
    expect(watcher.unsubscribe).toHaveBeenCalledTimes(1)
})
