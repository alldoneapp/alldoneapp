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
const { storeCallTranscriptTurn } = require('./whatsAppCallTranscript')
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
        answerAcknowledgedAt: expect.any(Number),
    })
    expect(reconcileLiveUsage).toHaveBeenLastCalledWith({ sessionId: 's', seconds: 20, final: true })
    expect(finalizeCallSession).toHaveBeenCalledWith('s', 'close_requested', 'completed')
})

test('passes the latest transcript snapshot when new speech arrives during a slow chat write', async () => {
    const state = await start()
    let finishWrite
    storeCallTranscriptTurn.mockImplementationOnce(
        () =>
            new Promise(resolve => {
                finishWrite = resolve
            })
    )
    await emit(state.socket, user('audio-check', 'Hallo, hörst du mich?'))
    await emit(state.socket, delegation)
    await jest.advanceTimersByTimeAsync(300)
    expect(finishWrite).toBeDefined()
    await emit(state.socket, { ...user('sunday', 'Okay, was ist denn am Sonntag?'), start_ms: 3000, end_ms: 4200 })
    await jest.advanceTimersByTimeAsync(1200)
    expect(runLiveAssistant).not.toHaveBeenCalled()
    finishWrite({})
    await flush()
    expect(runLiveAssistant).toHaveBeenCalledWith(
        expect.objectContaining({
            lastUserTurn: expect.objectContaining({ text: 'Okay, was ist denn am Sonntag?' }),
            liveConversation: [
                { role: 'user', text: 'Hallo, hörst du mich?' },
                { role: 'user', text: 'Okay, was ist denn am Sonntag?' },
            ],
        })
    )
    await finish(state)
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
    active.onProgress({ status: 'running', step: 'Searching the workspace; no result yet.' })
    await jest.advanceTimersByTimeAsync(7000)
    expect(progressMessages(state.socket)).toHaveLength(0)
    await jest.advanceTimersByTimeAsync(1200)
    expect(progressMessages(state.socket)).toEqual([
        expect.objectContaining({
            delegation_id: 'd1',
            content: expect.stringContaining('Searching the workspace; no result yet.'),
        }),
    ])
    active.onProgress({ status: 'running', step: 'Working through the results.' })
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
    expect(JSON.parse(progressMessages(state.socket)[0].content)).toMatchObject({ status: 'running', error: null })
    update('awaiting_user')
    await jest.advanceTimersByTimeAsync(21000)
    expect(JSON.parse(progressMessages(state.socket).at(-1).content)).toMatchObject({
        status: 'awaiting_user',
        error: null,
    })
    update('completed')
    await jest.advanceTimersByTimeAsync(21000)
    expect(JSON.parse(progressMessages(state.socket).at(-1).content)).toMatchObject({
        status: 'completed',
        error: null,
    })
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
    // The fallback also handles the new utterance before background speech resumes.
    await jest.advanceTimersByTimeAsync(15000)
    expect(JSON.parse(progressMessages(state.socket).at(-1).content)).toMatchObject({ status: 'running', error: null })
    await finish(state)
    expect(watcher.unsubscribe).toHaveBeenCalledTimes(1)
})

test('recovers an undelegated spoken request and does not execute it again when the provider delegation arrives late', async () => {
    const state = await start()
    await emit(state.socket, user('approval', 'Ja, bitte eintragen'))
    await jest.advanceTimersByTimeAsync(3300)
    expect(runLiveAssistant).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(900)
    expect(runLiveAssistant).toHaveBeenCalledTimes(1)
    expect(runLiveAssistant.mock.calls[0][0].lastUserTurn.text).toBe('Ja, bitte eintragen')
    expect(state.socket.sent).toContainEqual(
        expect.objectContaining({ type: 'session.commentary.append', delegation_id: null, content: 'Verified result' })
    )
    await emit(state.socket, delegation)
    await jest.advanceTimersByTimeAsync(12000)
    expect(runLiveAssistant).toHaveBeenCalledTimes(1)
    expect(state.socket.sent.filter(event => event.type === 'session.commentary.append')).toHaveLength(1)
    await finish(state)
})

test('a correction extends the fallback settling window before starting backend work', async () => {
    const state = await start()
    await emit(state.socket, user('first', 'Trag es ganztägig ein'))
    await jest.advanceTimersByTimeAsync(3000)
    await emit(state.socket, user('correction', 'Nein, von elf bis zwanzig Uhr'))
    await jest.advanceTimersByTimeAsync(3000)
    expect(runLiveAssistant).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(900)
    expect(runLiveAssistant).toHaveBeenCalledTimes(1)
    expect(runLiveAssistant.mock.calls[0][0].lastUserTurn.text).toContain('von elf bis zwanzig Uhr')
    await finish(state)
})

test('shares current page quietly, deduplicates it and freezes context for each running request', async () => {
    const first = { path: '/projects/p/tasks/one/properties', title: 'First task' }
    const second = { path: '/projects/p/notes/two/editor', title: 'Second note' }
    docs.get('whatsAppCallSessions/s').pageContext = first
    let complete
    runLiveAssistant.mockImplementationOnce(
        () =>
            new Promise(resolve => {
                complete = resolve
            })
    )
    const state = await start()
    const pages = () => state.socket.sent.filter(event => event.event_id?.startsWith('alldone_live_page_'))
    expect(pages()).toHaveLength(1)
    expect(pages()[0]).toMatchObject({
        type: 'session.thinking.append',
        delegation_id: null,
        content: expect.stringContaining(first.path),
    })
    await jest.advanceTimersByTimeAsync(4500)
    expect(pages()).toHaveLength(1)
    expect(runLiveAssistant).not.toHaveBeenCalled()
    await emit(state.socket, user('task-request', 'Update this task'))
    await emit(state.socket, delegation)
    await jest.advanceTimersByTimeAsync(1200)
    expect(runLiveAssistant.mock.calls[0][0].session.pageContext).toEqual(first)
    docs.get('whatsAppCallSessions/s').pageContext = second
    await jest.advanceTimersByTimeAsync(2400)
    expect(pages()).toHaveLength(2)
    expect(pages()[1].content).toContain(second.path)
    expect(runLiveAssistant).toHaveBeenCalledTimes(1)
    expect(runLiveAssistant.mock.calls[0][0].session.pageContext).toEqual(first)
    expect(state.socket.sent.filter(event => event.type === 'session.commentary.append')).toHaveLength(0)
    complete('Task updated')
    await flush()
    await emit(state.socket, { ...user('note-request', 'Summarize this note'), start_ms: 5000, end_ms: 6000 })
    await emit(state.socket, { ...delegation, delegation: { id: 'd2', target: 'client' } })
    await jest.advanceTimersByTimeAsync(1200)
    expect(runLiveAssistant).toHaveBeenCalledTimes(2)
    expect(runLiveAssistant.mock.calls[1][0].session.pageContext).toEqual(second)
    await finish(state)
})

const applicationStatuses = socket =>
    socket.sent
        .filter(event => event.type === 'session.commentary.append' && event.content.startsWith('{'))
        .map(event => JSON.parse(event.content))
const errorContexts = socket =>
    socket.sent
        .filter(event => event.type === 'session.thinking.append' && event.content.startsWith('{'))
        .map(event => JSON.parse(event.content))
        .filter(value => value.type === 'application_error_state')

test('does not promote a free-form error claim into an announced status', async () => {
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
    const { onProgress } = runLiveAssistant.mock.calls[0][0]
    onProgress('An error came in')
    await jest.advanceTimersByTimeAsync(10000)
    expect(applicationStatuses(state.socket)).toEqual([])
    onProgress({
        status: 'running',
        step: 'Searching Sunday events',
        content: 'Made-up permission error',
        urgent: true,
    })
    await jest.advanceTimersByTimeAsync(9000)
    expect(applicationStatuses(state.socket)).toContainEqual(
        expect.objectContaining({ status: 'running', error: null, step: 'Searching Sunday events' })
    )
    expect(JSON.stringify(state.socket.sent)).not.toMatch(/An error came in|Made-up permission/)
    complete('Verified result')
    await flush()
    await finish(state)
})

test('emits a verified cause and clears it before delivering a fast retry result', async () => {
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
    const { onProgress } = runLiveAssistant.mock.calls[0][0]
    onProgress({ status: 'failed', cause: 'Calendar write permission missing', step: 'Creating the calendar entry' })
    await jest.advanceTimersByTimeAsync(4200)
    expect(applicationStatuses(state.socket)).toContainEqual(
        expect.objectContaining({
            error: {
                status: 'failed',
                cause: 'Calendar write permission missing',
                step: 'Creating the calendar entry',
            },
        })
    )
    // Recovery and completion between ticks must still clear the old error.
    onProgress({ status: 'result_received', step: 'Creating the calendar entry' })
    complete('Verified result')
    await flush()
    expect(errorContexts(state.socket).at(-1).error).toBeNull()
    await jest.advanceTimersByTimeAsync(45000)
    expect(applicationStatuses(state.socket).filter(value => value.error)).toHaveLength(1)
    expect(
        state.socket.sent.filter(
            event => event.type === 'session.commentary.append' && event.content === 'Verified result'
        )
    ).toHaveLength(1)
    await finish(state)
})

test.each([
    ['Specific HTTP 429 rate limit', 'failed'],
    ['', 'outcome_unconfirmed'],
])('backend failure uses actual cause or a neutral unknown outcome: %s', async (message, status) => {
    runLiveAssistant.mockRejectedValueOnce(new Error(message))
    const state = await start()
    await emit(state.socket, user())
    await emit(state.socket, delegation)
    await jest.advanceTimersByTimeAsync(1500)
    const update = applicationStatuses(state.socket).at(-1)
    expect(update.status).toBe(status)
    expect(update.error?.cause || null).toBe(message || null)
    await finish(state)
})

test('announces one failure once even when progress repeats and the backend then throws it', async () => {
    let fail
    runLiveAssistant.mockImplementationOnce(
        () =>
            new Promise((resolve, reject) => {
                fail = reject
            })
    )
    const state = await start()
    await emit(state.socket, user())
    await emit(state.socket, delegation)
    await jest.advanceTimersByTimeAsync(1200)
    const { onProgress } = runLiveAssistant.mock.calls[0][0]
    onProgress({ status: 'failed', cause: 'Note not found', step: 'Loading the note' })
    await jest.advanceTimersByTimeAsync(4200)
    onProgress({ status: 'failed', cause: 'Note not found', step: 'Reviewing the lookup' })
    await jest.advanceTimersByTimeAsync(46000)
    fail(new Error('Note not found'))
    await flush()
    expect(applicationStatuses(state.socket).filter(value => value.error)).toHaveLength(1)
    expect(applicationStatuses(state.socket).find(value => value.error).error.cause).toBe('Note not found')
    const failedRun = [...docs.values()].find(value => value.status === 'failed' && value.error === 'backend_failed')
    expect(failedRun.outcome).toEqual({ status: 'failed', cause: 'Note not found' })
    await finish(state)
})

test('does not suppress a new cause or the same cause in a new user request', async () => {
    let fail
    runLiveAssistant.mockImplementationOnce(
        () =>
            new Promise((resolve, reject) => {
                fail = reject
            })
    )
    const state = await start()
    await emit(state.socket, user())
    await emit(state.socket, delegation)
    await jest.advanceTimersByTimeAsync(1200)
    const { onProgress } = runLiveAssistant.mock.calls[0][0]
    onProgress({ status: 'failed', cause: 'Note not found', step: 'Loading a note' })
    await jest.advanceTimersByTimeAsync(4200)
    fail(new Error('Calendar write permission missing'))
    await flush()
    runLiveAssistant.mockRejectedValueOnce(new Error('Note not found'))
    await emit(state.socket, { ...user('next', 'Check another note'), start_ms: 10000, end_ms: 11000 })
    await emit(state.socket, { ...delegation, delegation: { id: 'd2', target: 'client' } })
    await jest.advanceTimersByTimeAsync(1500)
    expect(
        applicationStatuses(state.socket)
            .filter(value => value.error)
            .map(value => value.error.cause)
    ).toEqual(['Note not found', 'Calendar write permission missing', 'Note not found'])
    await finish(state)
})

test('does not announce a delayed failure from the request replaced by newer speech', async () => {
    let fail
    runLiveAssistant.mockImplementationOnce(
        () =>
            new Promise((resolve, reject) => {
                fail = reject
            })
    )
    const state = await start()
    await emit(state.socket, user())
    await emit(state.socket, delegation)
    await jest.advanceTimersByTimeAsync(1200)
    await emit(state.socket, { ...user('correction', 'Actually check the other day'), start_ms: 4000, end_ms: 5000 })
    fail(new Error('Old lookup timed out'))
    await flush()
    expect(applicationStatuses(state.socket).some(value => value.error)).toBe(false)
    expect(errorContexts(state.socket).some(value => value.error)).toBe(false)
    await finish(state)
})
