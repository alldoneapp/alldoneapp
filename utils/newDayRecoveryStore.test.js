import { createNewDayRecoveryStore } from './newDayRecoveryStore'

const day = new Date(2026, 8, 12, 9).getTime()
const deferred = () => {
    let resolve, reject
    const promise = new Promise((yes, no) => {
        resolve = yes
        reject = no
    })
    return { promise, resolve, reject }
}
beforeEach(() => localStorage.clear())

it('restores an unblurred comment on a fresh page, scoped to its account, project and day', () => {
    const original = createNewDayRecoveryStore()
    original.saveDraft('u1', 'p1', day, 4, 'not blurred yet')
    const replacement = createNewDayRecoveryStore()
    expect(replacement.getDraft('u1', 'p1', day)).toMatchObject({
        rating: 4,
        comment: 'not blurred yet',
        pending: true,
    })
    expect(replacement.getDraft('u2', 'p1', day)).toBeUndefined()
    expect(replacement.getDraft('u1', 'p2', day)).toBeUndefined()
    expect(replacement.getDraft('u1', 'p1', day + 86400000)).toBeUndefined()
})

it('retains the draft until the raw server promise settles, including a stalled pre-read', async () => {
    const store = createNewDayRecoveryStore()
    const entry = store.saveDraft('u1', 'p1', day, 4, '')
    const server = deferred()
    const saving = store.flush(entry, () => server.promise)
    expect(createNewDayRecoveryStore().getDraft('u1', 'p1', day)?.pending).toBe(true)
    server.resolve()
    await saving
    expect(createNewDayRecoveryStore().getDraft('u1', 'p1', day)).toBeUndefined()
})

it('serialises revisions and never lets the old acknowledgement erase the newer comment', async () => {
    const store = createNewDayRecoveryStore()
    const first = store.saveDraft('u1', 'p1', day, 4, '')
    const server = deferred()
    const writer = jest
        .fn()
        .mockImplementationOnce(() => server.promise)
        .mockResolvedValue(undefined)
    const saving = store.flush(first, writer)
    const newer = store.saveDraft('u1', 'p1', day, 4, 'new comment')
    const savingNewer = store.flush(newer, writer)
    expect(writer).toHaveBeenCalledTimes(1)
    server.resolve()
    await saving
    expect(store.getDraft('u1', 'p1', day)?.comment).toBe('new comment')
    await savingNewer
    expect(writer.mock.calls[1][0].comment).toBe('new comment')
    expect(store.getDraft('u1', 'p1', day)).toBeUndefined()
})

it('retains failed writes for a later authenticated retry', async () => {
    const store = createNewDayRecoveryStore()
    const entry = store.saveDraft('u1', 'p1', day, 4, '')
    await expect(store.flush(entry, () => Promise.reject(new Error('offline')))).rejects.toThrow('offline')
    const replacement = createNewDayRecoveryStore()
    const writer = jest.fn().mockResolvedValue(undefined)
    await replacement.flush(replacement.getDraft('u1', 'p1', day), writer)
    expect(writer).toHaveBeenCalledTimes(1)
})

it('does not start a queued write after switching account', async () => {
    const store = createNewDayRecoveryStore()
    const entry = store.saveDraft('u1', 'p1', day, 4, '')
    const server = deferred()
    const saving = store.flush(entry, () => server.promise)
    const newer = store.saveDraft('u1', 'p1', day, 5, '')
    let active = true
    const writer = jest.fn()
    const queued = store.flush(newer, writer, () => active)
    active = false
    server.resolve()
    await Promise.all([saving, queued])
    expect(writer).not.toHaveBeenCalled()
    expect(store.getDraft('u1', 'p1', day)?.rating).toBe(5)
})

it('preserves the latest confirmation across reloads and stale server snapshots', async () => {
    const store = createNewDayRecoveryStore()
    const ack = store.acknowledge('u1', day, day + 86400000)
    expect(createNewDayRecoveryStore().getAcknowledgement('u1')).toMatchObject({ date: day + 86400000, pending: true })
    await store.flush(ack, () => Promise.resolve())
    expect(createNewDayRecoveryStore().getAcknowledgement('u1')).toMatchObject({ date: day + 86400000, pending: false })
    expect(store.acknowledge('u1', day - 86400000, day).date).toBe(day + 86400000)
    expect(store.getAcknowledgement('u2')).toBeUndefined()
})

it('blocks planned reloads when local storage fails until the server accepts the write', async () => {
    const store = createNewDayRecoveryStore(() => {
        throw new Error('Storage disabled')
    })
    const entry = store.saveDraft('u1', 'p1', day, 4, '')
    expect(store.hasUnsafeEntries()).toBe(true)
    await store.flush(entry, () => Promise.resolve())
    expect(store.hasUnsafeEntries()).toBe(false)
})

it('does not replay a draft another tab already confirmed and removed', async () => {
    const first = createNewDayRecoveryStore()
    const entry = first.saveDraft('u1', 'p1', day, 4, '')
    const second = createNewDayRecoveryStore()
    await second.flush(second.getDraft('u1', 'p1', day), () => Promise.resolve())
    const writer = jest.fn()
    await first.flush(entry, writer)
    expect(writer).not.toHaveBeenCalled()
})
