import { createNoteSaveScheduler } from './noteSaveScheduler'

const tick = async ms => {
    await jest.advanceTimersByTimeAsync(ms)
}
const deferred = () => {
    let resolve
    const promise = new Promise(r => {
        resolve = r
    })
    return { promise, resolve }
}
let scheduler
beforeEach(() => jest.useFakeTimers())
afterEach(async () => {
    await scheduler?.close()
    jest.useRealTimers()
})

it('debounces a typing burst and snapshots only once', async () => {
    const capture = jest.fn(() => jest.fn())
    scheduler = createNoteSaveScheduler({ capture })
    for (let i = 0; i < 10; i++) {
        scheduler.markLocal()
        await tick(1000)
    }
    expect(capture).not.toHaveBeenCalled()
    await tick(2000)
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith(true)
})
it('caps continuous typing at 15 seconds even when idle callbacks never fire', async () => {
    const capture = jest.fn(() => jest.fn())
    scheduler = createNoteSaveScheduler({ capture, requestIdle: () => 1, cancelIdle: jest.fn() })
    for (let i = 0; i < 15; i++) {
        scheduler.markLocal()
        await tick(1000)
    }
    expect(capture).toHaveBeenCalledTimes(1)
})
it('waits for idle at a pause, bounded by the maximum timer', async () => {
    let idleCallback
    const capture = jest.fn(() => jest.fn())
    const cancelIdle = jest.fn()
    scheduler = createNoteSaveScheduler({
        capture,
        requestIdle: cb => {
            idleCallback = cb
            return 5
        },
        cancelIdle,
    })
    scheduler.markLocal()
    await tick(3000)
    expect(capture).not.toHaveBeenCalled()
    idleCallback()
    await tick(0)
    expect(capture).toHaveBeenCalledTimes(1)
})
it('preserves edits received during an in-flight upload and serializes the next snapshot', async () => {
    const upload = deferred()
    let document = 'first'
    const snapshots = []
    const jobs = []
    const capture = jest.fn(() => {
        const bytes = document
        snapshots.push(bytes)
        return () => {
            jobs.push(bytes)
            return jobs.length === 1 ? upload.promise : true
        }
    })
    scheduler = createNoteSaveScheduler({ capture })
    scheduler.markLocal()
    await tick(3000)
    document = 'second'
    scheduler.markLocal()
    await tick(15000)
    expect(snapshots).toEqual(['first'])
    upload.resolve(true)
    await tick(3000)
    expect(jobs).toEqual(['first', 'second'])
})
it('captures the final snapshot synchronously on close during an upload, then drains after teardown', async () => {
    const upload = deferred()
    let document = 'first'
    const jobs = []
    scheduler = createNoteSaveScheduler({
        capture: () => {
            const bytes = document
            return () => {
                jobs.push(bytes)
                return jobs.length === 1 ? upload.promise : true
            }
        },
    })
    scheduler.markLocal()
    await tick(3000)
    document = 'last'
    scheduler.markLocal()
    const closing = scheduler.close()
    document = null // the live Y.Doc has been destroyed
    upload.resolve(true)
    await closing
    expect(jobs).toEqual(['first', 'last'])
})
it('saves remote-only edits after 60 seconds, coalescing them with a local save', async () => {
    const capture = jest.fn(() => jest.fn())
    scheduler = createNoteSaveScheduler({ capture })
    scheduler.markRemote()
    await tick(59000)
    expect(capture).not.toHaveBeenCalled()
    scheduler.markLocal()
    await tick(3000)
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith(true)
})
it('keeps a snapshot pending until the initial background merge can complete', async () => {
    let verified = false
    const job = jest.fn()
    scheduler = createNoteSaveScheduler({ capture: () => (verified ? job : null) })
    scheduler.markLocal()
    await tick(3000)
    expect(job).not.toHaveBeenCalled()
    verified = true
    await scheduler.flush()
    expect(job).toHaveBeenCalledTimes(1)
})
it('persists received-only content without claiming local authorship', async () => {
    const capture = jest.fn(() => jest.fn())
    scheduler = createNoteSaveScheduler({ capture })
    scheduler.markRemote()
    await tick(60000)
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith(false)
})
it('captures on page hide while an upload runs, and remains usable after a cancelled close', async () => {
    const upload = deferred()
    const capture = jest.fn(() => () => upload.promise)
    scheduler = createNoteSaveScheduler({ capture })
    scheduler.markLocal()
    await tick(3000)
    scheduler.markLocal()
    const hidden = scheduler.flushForPageHide()
    expect(capture).toHaveBeenCalledTimes(2)
    upload.resolve(true)
    await hidden
    scheduler.markLocal()
    await tick(3000)
    expect(capture).toHaveBeenCalledTimes(3)
})
