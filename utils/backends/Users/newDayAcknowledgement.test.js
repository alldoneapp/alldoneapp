const mockAuthState = { currentUser: { uid: 'u1' } }
jest.mock('firebase/compat/app', () => ({ __esModule: true, default: { auth: () => mockAuthState } }))
jest.mock('../firestoreDirectRead', () => ({
    readDocumentDirectlyFromServer: jest.fn(),
    updateDocumentDirectlyFromServer: jest.fn(),
}))
jest.mock('../../connectionState', () => ({ isBrowserOffline: jest.fn(() => false) }))
jest.mock('../../connectionHealth', () => ({ isManualOfflineMode: jest.fn(() => false) }))

import {
    persistNewDayAcknowledgement,
    readNewDayAcknowledgement,
    NEW_DAY_ACKNOWLEDGEMENT_TIMEOUT_MS,
} from './newDayAcknowledgement'
import {
    readDocumentDirectlyFromServer as read,
    updateDocumentDirectlyFromServer as write,
} from '../firestoreDirectRead'
import { isBrowserOffline } from '../../connectionState'
import { createNewDayRecoveryStore } from '../../newDayRecoveryStore'

const snapshot = date => ({
    exists: true,
    updateTime: '2026-10-06T00:00:00.000001Z',
    data: { statisticsModalDate: date },
})
const persist = () => persistNewDayAcknowledgement('u1', 100, 200, () => 'u1')
beforeEach(() => {
    jest.clearAllMocks()
    read.mockReset().mockResolvedValue(snapshot(100))
    write.mockReset().mockResolvedValue(undefined)
    isBrowserOffline.mockReturnValue(false)
    mockAuthState.currentUser = { uid: 'u1' }
    localStorage.clear()
})
afterEach(() => jest.useRealTimers())

it('advances the date with a server-version precondition independently of the SDK queue', async () => {
    await persist()
    expect(write).toHaveBeenCalledWith(
        'users/u1',
        { statisticsModalDate: { integerValue: '200' }, previousStatisticsModalDate: { integerValue: '100' } },
        snapshot(100).updateTime,
        expect.objectContaining({ signal: expect.anything(), assertAccount: expect.any(Function) })
    )
})
it.each([200, 300])('does not overwrite a newer confirmation (%s)', async date => {
    read.mockResolvedValue(snapshot(date))
    await persist()
    expect(write).not.toHaveBeenCalled()
})
it('re-reads after another device updates the document and preserves its newer date', async () => {
    write.mockRejectedValueOnce(Object.assign(new Error('Version changed'), { code: 'FAILED_PRECONDITION' }))
    read.mockResolvedValueOnce(snapshot(100)).mockResolvedValueOnce(snapshot(300))
    await persist()
    expect(read).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenCalledTimes(1)
})
it('retries with the fresh version after an unrelated user-document edit', async () => {
    write.mockRejectedValueOnce(Object.assign(new Error('Version changed'), { code: 'FAILED_PRECONDITION' }))
    read.mockResolvedValueOnce(snapshot(100)).mockResolvedValueOnce({ ...snapshot(100), updateTime: 'new-version' })
    await persist()
    expect(write.mock.calls[1][2]).toBe('new-version')
})
it('does not retry authorization failures or clear the durable record', async () => {
    write.mockRejectedValue(Object.assign(new Error('Denied'), { code: 'PERMISSION_DENIED' }))
    const recovery = createNewDayRecoveryStore()
    const entry = recovery.acknowledge('u1', 100, 200)
    await expect(recovery.flush(entry, persist)).rejects.toThrow('Denied')
    expect(write).toHaveBeenCalledTimes(1)
    expect(recovery.getAcknowledgement('u1').pending).toBe(true)
})
it('times out a stalled read, releases recovery serialization, and aborts a late write', async () => {
    jest.useFakeTimers()
    let finishRead
    read.mockImplementationOnce(
        () =>
            new Promise(resolve => {
                finishRead = resolve
            })
    )
    const recovery = createNewDayRecoveryStore()
    const entry = recovery.acknowledge('u1', 100, 200)
    const saving = recovery.flush(entry, persist)
    const rejected = expect(saving).rejects.toMatchObject({ code: 'deadline-exceeded' })
    await jest.advanceTimersByTimeAsync(NEW_DAY_ACKNOWLEDGEMENT_TIMEOUT_MS)
    await rejected
    expect(read.mock.calls[0][1].signal.aborted).toBe(true)
    finishRead(snapshot(100))
    await Promise.resolve()
    expect(write).not.toHaveBeenCalled()
    await recovery.flush(entry, persist)
    expect(write).toHaveBeenCalledTimes(1)
    expect(recovery.getAcknowledgement('u1').pending).toBe(false)
})
it('times out a stalled commit and safely rechecks a commit whose response was lost', async () => {
    jest.useFakeTimers()
    write.mockImplementationOnce(() => new Promise(() => {}))
    const rejected = expect(persist()).rejects.toMatchObject({ code: 'deadline-exceeded' })
    await jest.advanceTimersByTimeAsync(NEW_DAY_ACKNOWLEDGEMENT_TIMEOUT_MS)
    await rejected
    read.mockResolvedValue(snapshot(200))
    await persist()
    expect(write).toHaveBeenCalledTimes(1)
})
it('does not write after an account change during the read', async () => {
    read.mockImplementationOnce(async () => {
        mockAuthState.currentUser = { uid: 'u2' }
        return snapshot(100)
    })
    await expect(persist()).rejects.toThrow('account changed')
    expect(write).not.toHaveBeenCalled()
})
it('keeps offline confirmations pending without issuing network work', async () => {
    isBrowserOffline.mockReturnValue(true)
    await expect(persist()).rejects.toMatchObject({ code: 'unavailable' })
    expect(read).not.toHaveBeenCalled()
})
it('bounds a server reconciliation read too', async () => {
    jest.useFakeTimers()
    read.mockImplementation(() => new Promise(() => {}))
    const rejected = expect(readNewDayAcknowledgement('u1', () => 'u1')).rejects.toMatchObject({
        code: 'deadline-exceeded',
    })
    await jest.advanceTimersByTimeAsync(NEW_DAY_ACKNOWLEDGEMENT_TIMEOUT_MS)
    await rejected
})
