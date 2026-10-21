jest.mock('firebase-functions/v2/https', () => ({
    onCall: (_, handler) => handler,
    HttpsError: class extends Error {
        constructor(code, message) {
            super(message)
            this.code = code
        }
    },
}))
jest.mock('../envFunctionsHelper', () => ({ getEnvFunctions: () => ({ DEEPGRAM_API_KEY: 'test-key' }) }))
jest.mock('./deepgramTranscribe', () => ({ transcribeAudioBase64: jest.fn() }))
jest.mock('../Gold/goldHelper', () => ({ deductGold: jest.fn() }))
jest.mock('../firebaseConfig', () => {
    const docs = new Map()
    let tail = Promise.resolve()
    const firestore = () => ({
        doc: path => ({ path }),
        runTransaction: callback => {
            const run = tail.then(async () => {
                const writes = []
                const result = await callback({
                    get: async ref => ({ data: () => docs.get(ref.path) }),
                    set: (ref, data) => writes.push([ref.path, data]),
                })
                for (const [path, data] of writes) docs.set(path, { ...docs.get(path), ...data })
                return result
            })
            tail = run.catch(() => {})
            return run
        },
    })
    return { admin: { firestore }, docs }
})

const { transcribeMeetingAudio: call } = require('./transcribeMeeting')
const { transcribeAudioBase64 } = require('./deepgramTranscribe')
const { deductGold } = require('../Gold/goldHelper')
const { docs } = require('../firebaseConfig')
const data = {
    sessionId: 'session-1',
    chunkIndex: 0,
    audioChunk: 'data:audio/wav;base64,AAAA',
    projectId: 'p',
    noteId: 'n',
}
const invoke = (overrides = {}, uid = 'u') => call({ auth: { uid }, data: { ...data, ...overrides } })

beforeEach(() => {
    docs.clear()
    jest.clearAllMocks()
    transcribeAudioBase64.mockResolvedValue({ transcript: 'Transkript' })
    deductGold.mockResolvedValue({ success: true })
})

test('lost response / retry returns cached result, with one provider call and stable Gold key', async () => {
    expect(await invoke()).toEqual({ text: 'Transkript' })
    expect(await invoke()).toEqual({ text: 'Transkript' })
    expect(transcribeAudioBase64).toHaveBeenCalledTimes(1)
    expect(deductGold).toHaveBeenCalledTimes(1)
    expect(deductGold).toHaveBeenCalledWith(
        'u',
        0.2,
        expect.objectContaining({
            idempotencyKey: expect.stringMatching(/^meeting_transcription:/),
            projectId: 'p',
            objectId: 'n',
        })
    )
})

test('concurrent requests cannot start a second provider call', async () => {
    let finish
    transcribeAudioBase64.mockImplementationOnce(
        () =>
            new Promise(resolve => {
                finish = resolve
            })
    )
    const first = invoke()
    while (!finish) await Promise.resolve()
    await expect(invoke()).rejects.toMatchObject({ code: 'aborted' })
    finish({ transcript: 'first' })
    expect(await first).toEqual({ text: 'first' })
    expect(transcribeAudioBase64).toHaveBeenCalledTimes(1)
})

test('provider failure releases lease; retry passes same Gold idempotency key', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    transcribeAudioBase64.mockRejectedValueOnce(new Error('network'))
    await expect(invoke()).rejects.toMatchObject({ code: 'internal' })
    expect(await invoke()).toEqual({ text: 'Transkript' })
    expect(deductGold.mock.calls[0][2].idempotencyKey).toBe(deductGold.mock.calls[1][2].idempotencyKey)
    jest.restoreAllMocks()
})

test('chunk IDs are user scoped and cannot be reused with different audio', async () => {
    await invoke()
    await expect(invoke({ audioChunk: 'different' })).rejects.toMatchObject({ code: 'invalid-argument' })
    await invoke({}, 'other-user')
    expect(transcribeAudioBase64).toHaveBeenCalledTimes(2)
})

test.each([
    { sessionId: '../bad' },
    { sessionId: null },
    { chunkIndex: -1 },
    { chunkIndex: 0.2 },
    { audioChunk: '' },
    { audioChunk: 'x'.repeat(9000001) },
])('invalid payload rejected before billing: %o', async input => {
    await expect(invoke(input)).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(deductGold).not.toHaveBeenCalled()
})

test('empty transcript is also cached', async () => {
    transcribeAudioBase64.mockResolvedValueOnce({ transcript: '' })
    expect(await invoke()).toEqual({ text: '' })
    expect(await invoke()).toEqual({ text: '' })
    expect(transcribeAudioBase64).toHaveBeenCalledTimes(1)
})

test('legacy screen/tab requests retain response and billing shape', async () => {
    expect(await call({ auth: { uid: 'u' }, data: { audioChunk: data.audioChunk } })).toEqual({ text: 'Transkript' })
    expect(deductGold).toHaveBeenCalledWith('u', 0.2, { source: 'meeting_transcription', channel: 'notes' })
    expect(docs.size).toBe(0)
})

test('unauthenticated / insufficient Gold never calls provider', async () => {
    await expect(call({ data })).rejects.toMatchObject({ code: 'permission-denied' })
    deductGold.mockResolvedValueOnce({ success: false, message: 'Insufficient Gold' })
    jest.spyOn(console, 'error').mockImplementation(() => {})
    await expect(invoke()).rejects.toMatchObject({ code: 'resource-exhausted' })
    expect(transcribeAudioBase64).not.toHaveBeenCalled()
    jest.restoreAllMocks()
})
