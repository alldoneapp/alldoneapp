import { persistNewDayAcknowledgement } from './newDayAcknowledgement'

const setup = date => {
    const ref = { path: 'users/u1' }
    const transaction = {
        get: jest.fn().mockResolvedValue({ data: () => ({ statisticsModalDate: date }) }),
        update: jest.fn(),
    }
    const db = { doc: jest.fn(() => ref), runTransaction: callback => callback(transaction) }
    return { db, transaction, ref }
}
it('advances the date atomically with the previous date', async () => {
    const { db, transaction, ref } = setup(100)
    await persistNewDayAcknowledgement(db, 'u1', 100, 200, () => 'u1')
    expect(transaction.update).toHaveBeenCalledWith(ref, { statisticsModalDate: 200, previousStatisticsModalDate: 100 })
})
it.each([200, 300])('does not overwrite a newer or already confirmed day (%s)', async serverDate => {
    const { db, transaction } = setup(serverDate)
    await persistNewDayAcknowledgement(db, 'u1', 100, 200, () => 'u1')
    expect(transaction.update).not.toHaveBeenCalled()
})
it('does not write after an account switch during the transaction read', async () => {
    const { db, transaction } = setup(100)
    let uid = 'u1'
    transaction.get.mockImplementation(async () => {
        uid = 'u2'
        return { data: () => ({ statisticsModalDate: 100 }) }
    })
    await expect(persistNewDayAcknowledgement(db, 'u1', 100, 200, () => uid)).rejects.toThrow('account changed')
    expect(transaction.update).not.toHaveBeenCalled()
})
