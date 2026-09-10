import { createNewDayProjectLoader } from './newDayProjectLoader'

const deferred = () => {
    let resolve, reject
    const promise = new Promise((yes, no) => {
        resolve = yes
        reject = no
    })
    return { promise, resolve, reject }
}
let options, reads, maintenance, loader
const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
}
beforeEach(() => {
    jest.useFakeTimers()
    reads = []
    maintenance = deferred()
    options = {
        read: jest.fn((success, failure) => {
            reads.push({ success, failure })
        }),
        reconcile: jest.fn(() => maintenance.promise),
        isCurrent: jest.fn(() => true),
        onStatistics: jest.fn(),
        onReadStart: jest.fn(),
        onReadError: jest.fn(),
        onDayRateState: jest.fn(),
        onMaintenanceError: jest.fn(),
        timeoutMs: 15000,
    }
    loader = createNewDayProjectLoader(options)
})
afterEach(() => {
    loader.dispose()
    jest.useRealTimers()
})

it('loads saved figures before maintenance settles and preserves them through its timeout and retries', async () => {
    loader.load()
    expect(reads).toHaveLength(1)
    reads[0].success({ doneTasks: 24, doneTime: 480 })
    await flush()
    expect(options.onStatistics).toHaveBeenCalledWith({ doneTasks: 24, doneTime: 480 })
    await jest.advanceTimersByTimeAsync(15000)
    expect(options.onReadError).not.toHaveBeenCalled()
    expect(options.onDayRateState).toHaveBeenLastCalledWith('delayed')
    expect(options.onMaintenanceError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'deadline-exceeded' }),
        expect.objectContaining({ stage: 'day-rate-reconciliation' })
    )
    loader.load()
    loader.load()
    await flush()
    expect(options.reconcile).toHaveBeenCalledTimes(1)
    expect(reads).toHaveLength(1)
})

it('refreshes after even a late reconciliation and ignores a stale initial read', async () => {
    loader.load()
    await flush()
    await jest.advanceTimersByTimeAsync(15000)
    maintenance.resolve([])
    await flush()
    expect(reads).toHaveLength(2)
    reads[1].success({ doneTime: 480 })
    reads[0].success({ doneTime: 20 })
    expect(options.onStatistics.mock.calls).toEqual([[{ doneTime: 480 }]])
    expect(options.onDayRateState).toHaveBeenLastCalledWith('complete')
})

it('keeps saved figures if refresh fails, and retries the read without repeating completed maintenance', async () => {
    loader.load()
    reads[0].success({ doneTime: 20 })
    maintenance.resolve([])
    await flush()
    reads[1].failure({ code: 'UNAVAILABLE' })
    expect(options.onReadError).not.toHaveBeenCalled()
    expect(options.onMaintenanceError).toHaveBeenCalledWith(
        { code: 'UNAVAILABLE' },
        expect.objectContaining({ stage: 'statistics-refresh' })
    )
    loader.load()
    expect(reads).toHaveLength(3)
    reads[2].success({ doneTime: 480 })
    expect(options.reconcile).toHaveBeenCalledTimes(1)
    expect(options.onDayRateState).toHaveBeenLastCalledWith('complete')
})

it('retries failed maintenance once and continues displaying the saved summary', async () => {
    loader.load()
    reads[0].success({ doneTasks: 24 })
    maintenance.reject(new Error('Write failed'))
    await flush()
    expect(options.onDayRateState).toHaveBeenLastCalledWith('failed')
    const retry = deferred()
    options.reconcile.mockReturnValue(retry.promise)
    loader.load()
    loader.load()
    await flush()
    expect(options.reconcile).toHaveBeenCalledTimes(2)
    retry.resolve([])
    await flush()
    reads[1].success({ doneTasks: 24, doneTime: 480 })
    expect(options.onStatistics).toHaveBeenLastCalledWith({ doneTasks: 24, doneTime: 480 })
})

it('disposes maintenance and ignores late reads or writes when the popup closes', async () => {
    loader.load()
    await flush()
    const signal = options.reconcile.mock.calls[0][0]
    loader.dispose()
    expect(signal.aborted).toBe(true)
    maintenance.resolve([])
    reads[0].success({ doneTime: 480 })
    await flush()
    expect(options.onStatistics).not.toHaveBeenCalled()
    expect(reads).toHaveLength(1)
    expect(jest.getTimerCount()).toBe(0)
})

it('ignores callbacks for a different account or date even before disposal', async () => {
    loader.load()
    await flush()
    options.isCurrent.mockReturnValue(false)
    reads[0].failure(new Error('Old failure'))
    maintenance.resolve([])
    await flush()
    expect(options.onReadError).not.toHaveBeenCalled()
    expect(reads).toHaveLength(1)
})

it('does not invoke maintenance if disposed before it starts', async () => {
    loader.load()
    loader.dispose()
    await flush()
    expect(options.reconcile).not.toHaveBeenCalled()
})
