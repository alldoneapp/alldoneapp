jest.mock('../firestoreDirectRead', () => ({ readDocumentDirectlyFromServer: jest.fn() }))
jest.mock('../../connectionState', () => ({ isBrowserOffline: jest.fn(() => false) }))
jest.mock('../../connectionHealth', () => ({ isManualOfflineMode: jest.fn(() => false) }))

import { readDocumentDirectlyFromServer } from '../firestoreDirectRead'
import { isBrowserOffline } from '../../connectionState'
import { isManualOfflineMode } from '../../connectionHealth'
import { readUserStatistics, STATISTICS_READ_TIMEOUT_MS } from './userStatisticsRead'

const path = '/statistics/p1/u1/06092026'
let get
let db
beforeEach(() => {
    jest.useFakeTimers()
    jest.resetAllMocks()
    get = jest.fn()
    db = { doc: jest.fn(() => ({ get })) }
})
afterEach(() => jest.useRealTimers())

it('reads yesterday directly without waiting for the busy SDK listener queue', async () => {
    readDocumentDirectlyFromServer.mockResolvedValue({ exists: true, data: { doneTasks: 7 } })
    expect(await readUserStatistics(db, path, { preferDirect: true })).toEqual({ doneTasks: 7 })
    expect(get).not.toHaveBeenCalled()
    expect(readDocumentDirectlyFromServer).toHaveBeenCalledWith(path, { signal: expect.anything() })
})

it('treats only a server-confirmed missing day as zero statistics', async () => {
    readDocumentDirectlyFromServer.mockResolvedValue({ exists: false })
    expect(await readUserStatistics(db, path, { preferDirect: true })).toEqual({})
    isBrowserOffline.mockReturnValue(true)
    get.mockResolvedValue({ exists: false })
    await expect(readUserStatistics(db, path, { preferDirect: true })).rejects.toMatchObject({ code: 'unavailable' })
})

it('automatically retries transient server errors', async () => {
    readDocumentDirectlyFromServer
        .mockRejectedValueOnce({ code: 'UNAVAILABLE' })
        .mockResolvedValueOnce({ exists: true, data: { doneTasks: 3 } })
    const result = readUserStatistics(db, path, { preferDirect: true })
    await jest.advanceTimersByTimeAsync(500)
    expect(await result).toEqual({ doneTasks: 3 })
    expect(readDocumentDirectlyFromServer).toHaveBeenCalledTimes(2)
})

it('preserves an authorization error instead of showing cached data', async () => {
    readDocumentDirectlyFromServer.mockRejectedValue({ code: 'PERMISSION_DENIED', message: 'Denied' })
    await expect(readUserStatistics(db, path, { preferDirect: true })).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
    })
    expect(get).not.toHaveBeenCalled()
    expect(readDocumentDirectlyFromServer).toHaveBeenCalledTimes(1)
})

it('preserves the server failure when the cache fallback also fails', async () => {
    const serverError = Object.assign(new Error('Backend unavailable'), { code: 'UNAVAILABLE' })
    const cacheError = Object.assign(new Error('No cached document'), { code: 'unavailable' })
    readDocumentDirectlyFromServer.mockRejectedValue(serverError)
    get.mockRejectedValue(cacheError)
    const result = readUserStatistics(db, path, { preferDirect: true })
    const assertion = expect(result).rejects.toMatchObject({
        code: 'UNAVAILABLE',
        message: 'Backend unavailable',
        cacheError,
    })
    await jest.advanceTimersByTimeAsync(500)
    await assertion
})

it.each(['browser', 'manual'])('uses the existing cache when %s offline', async kind => {
    ;(kind === 'browser' ? isBrowserOffline : isManualOfflineMode).mockReturnValue(true)
    get.mockResolvedValue({ exists: true, data: () => ({ doneTasks: 4 }) })
    expect(await readUserStatistics(db, path, { preferDirect: true })).toEqual({ doneTasks: 4 })
    expect(get).toHaveBeenCalledWith({ source: 'cache' })
    expect(readDocumentDirectlyFromServer).not.toHaveBeenCalled()
})

it('bounds stalled REST and cache operations and aborts timed-out requests', async () => {
    const signals = []
    readDocumentDirectlyFromServer.mockImplementation((path, { signal }) => {
        signals.push(signal)
        return new Promise(() => {})
    })
    get.mockImplementation(() => new Promise(() => {}))
    const result = readUserStatistics(db, path, { preferDirect: true })
    const assertion = expect(result).rejects.toMatchObject({ code: 'deadline-exceeded' })
    await jest.advanceTimersByTimeAsync(STATISTICS_READ_TIMEOUT_MS * 2 + 1500)
    await assertion
    expect(signals).toHaveLength(2)
    expect(signals.every(signal => signal.aborted)).toBe(true)
})
