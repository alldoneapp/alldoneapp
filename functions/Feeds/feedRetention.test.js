const { trimFeedCollection, MAX_STORED_FEEDS, MAX_DELETES_PER_RUN } = require('./feedRetention')
const makeDb = count => {
    const docs = Array.from({ length: count }, (_, i) => ({ id: String(i), ref: `feeds/${i}` }))
    const query = { orderBy: jest.fn(() => query), limit: jest.fn(() => query), get: jest.fn(async () => ({ docs })) }
    const batch = { delete: jest.fn(), commit: jest.fn(async () => {}) }
    return { db: { collection: jest.fn(() => query), batch: () => batch }, query, batch }
}
it('keeps the newest 200 and deletes overflow in one bounded Admin SDK batch', async () => {
    const { db, query, batch } = makeDb(400)
    expect(await trimFeedCollection(db, 'feedsStore/project/all')).toBe(200)
    expect(query.limit).toHaveBeenCalledWith(MAX_STORED_FEEDS + MAX_DELETES_PER_RUN)
    expect(batch.delete.mock.calls[0]).toEqual(['feeds/200'])
    expect(batch.delete).toHaveBeenCalledTimes(200)
    expect(batch.commit).toHaveBeenCalledTimes(1)
})
it('does no writes for a collection within retention', async () => {
    const { db, batch } = makeDb(200)
    expect(await trimFeedCollection(db, 'feedsStore/project/all')).toBe(0)
    expect(batch.commit).not.toHaveBeenCalled()
})
it('propagates backend failure so a failed maintenance run is observable', async () => {
    const { db, batch } = makeDb(201)
    batch.commit.mockRejectedValue(Error('unavailable'))
    await expect(trimFeedCollection(db, 'feedsStore/project/all')).rejects.toThrow('unavailable')
})
