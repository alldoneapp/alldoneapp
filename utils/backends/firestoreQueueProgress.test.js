import { readFirestoreQueueProgress, queueHasAdvanced } from './firestoreQueueProgress'

it('bounds a stalled IndexedDB discovery so it cannot disable write recovery', async () => {
    jest.useFakeTimers()
    const previous = global.indexedDB
    const open = jest.fn()
    global.indexedDB = { databases: () => new Promise(() => {}), open }
    try {
        const result = readFirestoreQueueProgress({ app: { name: '[DEFAULT]', options: { projectId: 'p' } } }, 'u')
        await jest.advanceTimersByTimeAsync(1000)
        await expect(result).resolves.toBeNull()
        expect(open).not.toHaveBeenCalled()
    } finally {
        global.indexedDB = previous
        jest.useRealTimers()
    }
})

it('detects a draining head even when new writes keep the total queue size constant', () => {
    expect(queueHasAdvanced({ count: 20, firstBatchId: 10 }, { count: 20, firstBatchId: 11 })).toBe(true)
    expect(queueHasAdvanced({ count: 20, firstBatchId: 10 }, { count: 21, firstBatchId: 10 })).toBe(false)
    expect(queueHasAdvanced(null, { count: 20, firstBatchId: 10 })).toBe(false)
})
