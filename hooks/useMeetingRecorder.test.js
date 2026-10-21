import React from 'react'
import renderer, { act } from 'react-test-renderer'
import useMeetingRecorder from './useMeetingRecorder'
import { openMeetingQueue } from '../utils/meetingQueue'
import { createMeetingCapture } from '../utils/meetingCapture'
import { runHttpsCallableFunction } from '../utils/backends/firestore'

jest.mock('../utils/meetingCapture', () => ({ createMeetingCapture: jest.fn() }))
jest.mock('../utils/meetingAudio', () => ({ meetingBlobBase64: async () => 'base64-wav' }))
jest.mock('../utils/meetingQueue', () => ({
    ...jest.requireActual('../utils/meetingQueue'),
    openMeetingQueue: jest.fn(),
}))
jest.mock('../utils/backends/firestore', () => ({ runHttpsCallableFunction: jest.fn() }))

let current, view, options, rows, persist, held, queue, getInsertionTarget
const flush = async () => {
    for (let i = 0; i < 80; i++) await Promise.resolve()
}
const offline = () => Object.assign(new Error('offline'), { code: 'offline' })
const Harness = ({ enabled = true, noteId = 'n' }) => {
    current = useMeetingRecorder({ userId: 'u', noteId, projectId: 'p', enabled, persist, getInsertionTarget })
    return null
}
beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    options = null
    getInsertionTarget = undefined
    rows = new Map()
    held = new Set()
    Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: {
            request: async (name, _, callback) => {
                if (held.has(name)) return callback(null)
                held.add(name)
                try {
                    return await callback({ name })
                } finally {
                    held.delete(name)
                }
            },
        },
    })
    Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: { estimate: async () => ({ quota: 1e9, usage: 0 }), persist: async () => true },
    })
    const clone = value => ({ ...value })
    queue = {
        list: jest.fn(async owner => [...rows.values()].filter(row => row.owner === owner).map(clone)),
        enqueue: jest.fn(async chunk => {
            if (!rows.has(chunk.id)) rows.set(chunk.id, clone(chunk))
        }),
        put: jest.fn(async chunk => rows.set(chunk.id, clone(chunk))),
        remove: jest.fn(async id => rows.delete(id)),
        close: jest.fn(),
    }
    openMeetingQueue.mockResolvedValue(queue)
    createMeetingCapture.mockImplementation(callbacks => {
        options = callbacks
        let stopped = false
        return {
            start: async () => 'Test mic',
            stop: jest.fn(async () => {
                if (stopped) return
                stopped = true
                callbacks.onChunk(new Blob(['final']))
                callbacks.onStopped()
            }),
        }
    })
    runHttpsCallableFunction.mockResolvedValue({ text: 'transcript' })
    persist = jest.fn(async () => true)
})
afterEach(async () => {
    await act(async () => {
        view?.unmount()
        await flush()
    })
    jest.useRealTimers()
    delete navigator.locks
    delete navigator.storage
})
const mount = async props =>
    act(async () => {
        view = renderer.create(<Harness {...props} />)
        await flush()
    })
const start = async () =>
    act(async () => {
        current.start()
        await flush()
    })

test('captures one insertion target before microphone acquisition and stores it with every queued chunk', async () => {
    let currentTarget = { tname: 'quill', item: { client: 123, clock: 5 }, assoc: 0 }
    getInsertionTarget = jest.fn(() => currentTarget)
    let permit
    createMeetingCapture.mockImplementation(callbacks => {
        options = callbacks
        return {
            start: () =>
                new Promise(resolve => {
                    permit = resolve
                }),
            stop: async () => callbacks.onStopped(),
        }
    })
    await mount()
    await start()
    expect(getInsertionTarget).toHaveBeenCalledTimes(1)
    const startingTarget = currentTarget
    currentTarget = { tname: 'quill', item: { client: 123, clock: 99 }, assoc: 0 }
    await act(async () => {
        permit('Test mic')
        await flush()
        runHttpsCallableFunction.mockRejectedValue(offline())
        options.onChunk(new Blob(['first']))
        options.onChunk(new Blob(['second']))
        await flush()
    })
    expect([...rows.values()].map(chunk => chunk.insertionTarget)).toEqual([startingTarget, startingTarget])
    expect(getInsertionTarget).toHaveBeenCalledTimes(1)
    runHttpsCallableFunction.mockResolvedValue({ text: 'recovered' })
    await act(async () => {
        await current.retry()
        await flush()
    })
    expect(persist.mock.calls.map(([chunk]) => chunk.insertionTarget)).toEqual([startingTarget, startingTarget])
})

test('offline capture continues buffering; retry drains in order; stop persists final chunk and releases lock', async () => {
    await mount()
    await start()
    expect(current.phase).toBe('recording')
    runHttpsCallableFunction.mockRejectedValue(offline())
    await act(async () => {
        options.onChunk(new Blob(['first']))
        await flush()
    })
    expect(current.phase).toBe('recording')
    expect(rows.size).toBe(1)
    runHttpsCallableFunction.mockResolvedValue({ text: 'recovered' })
    await act(async () => {
        await current.retry()
        await flush()
        await current.stop()
        await flush()
    })
    expect(current.phase).toBe('idle')
    expect(rows.size).toBe(0)
    expect(persist.mock.calls.map(([chunk]) => chunk.sequence)).toEqual([0, 1])
    expect(held.size).toBe(0)
})

test('reopening a note recovers stored chunks without requesting microphone access', async () => {
    const insertionTarget = { tname: 'quill', item: { client: 123, clock: 5 }, assoc: 0 }
    getInsertionTarget = jest.fn()
    rows.set('old:0', {
        id: 'old:0',
        owner: 'u:n',
        sessionId: 'old',
        sequence: 0,
        createdAt: 1,
        blob: new Blob(['stored']),
        insertionTarget,
    })
    rows.set('other:0', { id: 'other:0', owner: 'other-user:n', sequence: 0, createdAt: 1 })
    await mount()
    expect(createMeetingCapture).not.toHaveBeenCalled()
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ insertionTarget }))
    expect(getInsertionTarget).not.toHaveBeenCalled()
    expect(rows.size).toBe(1)
    expect(rows.has('other:0')).toBe(true)
})

test('failed local write stops capture; retry saves retained audio before upload', async () => {
    await mount()
    await start()
    queue.enqueue.mockRejectedValueOnce(new Error('quota'))
    await act(async () => {
        options.onChunk(new Blob(['first']))
        await flush()
    })
    expect(current.phase).toBe('idle')
    // The failed first write is retried along with the final chunk, never uploaded from memory.
    await act(async () => {
        await current.retry()
        await flush()
    })
    expect(rows.size).toBe(0)
    expect(persist.mock.calls.map(([chunk]) => chunk.sequence)).toEqual([0, 1])
})

test('Gold exhaustion stops mic while retaining audio; retry after funding does not restart mic', async () => {
    await mount()
    await start()
    runHttpsCallableFunction.mockRejectedValue(Object.assign(new Error('Gold'), { code: 'resource-exhausted' }))
    await act(async () => {
        options.onChunk(new Blob(['first']))
        await flush()
    })
    expect(current.phase).toBe('idle')
    expect(rows.size).toBe(2)
    runHttpsCallableFunction.mockResolvedValue({ text: 'recovered' })
    await act(async () => {
        await current.retry()
        await flush()
    })
    expect(rows.size).toBe(0)
    expect(createMeetingCapture).toHaveBeenCalledTimes(1)
})

test('stop during pending permissions cannot activate the mic afterwards', async () => {
    let permit
    createMeetingCapture.mockImplementation(callbacks => ({
        start: () =>
            new Promise(resolve => {
                permit = resolve
            }),
        stop: async () => callbacks.onStopped(),
    }))
    await mount()
    await start()
    expect(current.phase).toBe('starting')
    await act(async () => {
        await current.stop()
        permit('Late mic')
        await flush()
    })
    expect(current.phase).toBe('idle')
    expect(held.size).toBe(0)
})

test('read-only/unavailable editor cannot recover or start microphone', async () => {
    await mount({ enabled: false })
    await start()
    expect(openMeetingQueue).not.toHaveBeenCalled()
    expect(createMeetingCapture).not.toHaveBeenCalled()
})

test('losing edit rights stops capture and clears the old recording display', async () => {
    await mount()
    await start()
    expect(current.phase).toBe('recording')
    await act(async () => {
        view.update(<Harness enabled={false} />)
        await flush()
    })
    expect(current.phase).toBe('idle')
    expect(current.device).toBe('')
    expect(held.size).toBe(0)
})

test('rapid double start during permission acquisition opens only one capture', async () => {
    let permit
    createMeetingCapture.mockImplementation(callbacks => ({
        start: () =>
            new Promise(resolve => {
                permit = resolve
            }),
        stop: async () => callbacks.onStopped(),
    }))
    await mount()
    await act(async () => {
        current.start()
        current.start()
        await flush()
    })
    expect(current.phase).toBe('starting')
    expect(createMeetingCapture).toHaveBeenCalledTimes(1)
    await act(async () => {
        permit('Test mic')
        await flush()
        await current.stop()
        await current.stop()
        await flush()
    })
    expect(current.phase).toBe('idle')
    expect(held.size).toBe(0)
})

test('elapsed duration exceeds five minutes and one hour without an automatic stop', async () => {
    await mount()
    await start()
    await act(async () => {
        jest.advanceTimersByTime(3601000)
        await flush()
    })
    expect(current.phase).toBe('recording')
    expect(current.elapsed).toBe(3601)
    await act(async () => {
        await current.stop()
        await flush()
    })
    expect(persist).toHaveBeenCalledTimes(1)
    expect(current.phase).toBe('idle')
})

test('online event recovers an offline backlog in order without restarting the mic', async () => {
    await mount()
    await start()
    runHttpsCallableFunction.mockRejectedValue(offline())
    await act(async () => {
        options.onChunk(new Blob(['first']))
        options.onChunk(new Blob(['second']))
        await flush()
        await current.stop()
        await flush()
    })
    expect(current.error).toBe('offline')
    expect(current.pending).toBe(3)
    runHttpsCallableFunction.mockResolvedValue({ text: 'online' })
    await act(async () => {
        window.dispatchEvent(new Event('online'))
        await flush()
    })
    expect(persist.mock.calls.map(([chunk]) => chunk.sequence)).toEqual([0, 1, 2])
    expect(current.pending).toBe(0)
    expect(current.error).toBe('')
    expect(current.phase).toBe('idle')
    expect(createMeetingCapture).toHaveBeenCalledTimes(1)
})
