import { createNewDayAcknowledgementRetry } from './newDayAcknowledgementRetry'

let retry, pending, active, persist, onError
beforeEach(() => {
    jest.useFakeTimers()
    pending = active = true
    persist = jest.fn(async () => {
        pending = false
    })
    onError = jest.fn()
    retry = createNewDayAcknowledgementRetry({ persist, isPending: () => pending, isActive: () => active, onError })
})
afterEach(() => {
    retry.dispose()
    jest.useRealTimers()
})

it('retries a failed confirmation without waiting for another connection transition', async () => {
    persist.mockRejectedValueOnce(new Error('Timeout'))
    await expect(retry.retry()).rejects.toThrow('Timeout')
    await jest.advanceTimersByTimeAsync(10000)
    expect(persist).toHaveBeenCalledTimes(2)
    expect(pending).toBe(false)
    await jest.advanceTimersByTimeAsync(60000)
    expect(persist).toHaveBeenCalledTimes(2)
})
it('coalesces resume and connection events during the same save', async () => {
    let finish
    persist.mockImplementationOnce(
        () =>
            new Promise(resolve => {
                finish = resolve
            })
    )
    const saving = retry.retry()
    expect(retry.retry()).toBe(saving)
    expect(persist).toHaveBeenCalledTimes(1)
    pending = false
    finish()
    await saving
})
it('stops background retries on account change and resumes on the next explicit event', async () => {
    persist.mockRejectedValueOnce(new Error('Timeout'))
    await expect(retry.retry()).rejects.toThrow()
    active = false
    await jest.advanceTimersByTimeAsync(10000)
    expect(persist).toHaveBeenCalledTimes(1)
    active = true
    await retry.retry()
    expect(persist).toHaveBeenCalledTimes(2)
})
it('cancels retry timers when its account lifecycle ends', async () => {
    persist.mockRejectedValueOnce(new Error('Timeout'))
    await expect(retry.retry()).rejects.toThrow()
    retry.dispose()
    await jest.advanceTimersByTimeAsync(60000)
    expect(persist).toHaveBeenCalledTimes(1)
})
