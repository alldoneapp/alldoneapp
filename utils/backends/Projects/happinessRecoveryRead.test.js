import { readHappinessForSave } from './happinessRecoveryRead'

it('waits for the previous page pending batch before asking the server whether to replay', async () => {
    let finishPending
    const db = {
        waitForPendingWrites: jest.fn(
            () =>
                new Promise(resolve => {
                    finishPending = resolve
                })
        ),
    }
    const snapshot = { data: () => ({ rating: 4, comment: 'already saved' }) }
    const ref = { get: jest.fn().mockResolvedValue(snapshot) }
    const check = jest.fn()
    const read = readHappinessForSave(db, ref, true, check)
    expect(ref.get).not.toHaveBeenCalled()
    finishPending()
    expect(await read).toBe(snapshot)
    expect(ref.get).toHaveBeenCalledWith({ source: 'server' })
    expect(check).toHaveBeenCalledTimes(2)
})

it('retains the normal offline cache read for callers without a durable recovery record', async () => {
    const db = { waitForPendingWrites: jest.fn() }
    const ref = { get: jest.fn().mockResolvedValue({ exists: false }) }
    await readHappinessForSave(db, ref, false, () => {})
    expect(db.waitForPendingWrites).not.toHaveBeenCalled()
    expect(ref.get).toHaveBeenCalledWith()
})

it('does not continue after an account change during queue recovery', async () => {
    const db = { waitForPendingWrites: jest.fn().mockResolvedValue(undefined) }
    const ref = { get: jest.fn() }
    await expect(
        readHappinessForSave(db, ref, true, () => {
            throw new Error('account changed')
        })
    ).rejects.toThrow('account changed')
    expect(ref.get).not.toHaveBeenCalled()
})
