import { createCommentOutbox, installCommentOutbox, COMMENT_OUTBOX_PREFIX } from './commentOutbox'

const values = {
    id: 'comment-1',
    userId: 'user-1',
    projectId: 'p',
    objectType: 'tasks',
    objectId: 't',
    comment: 'Keep our chat interface',
}
const deferred = () => {
    let resolve, reject
    const promise = new Promise((a, b) => {
        resolve = a
        reject = b
    })
    return { promise, resolve, reject }
}
const configure = (outbox, send, activeUser = () => 'user-1', canSend = () => true) =>
    outbox.configure({ send, activeUser, canSend })
beforeEach(() => localStorage.clear())

it('installs before sign-in without reading a missing auth user or sending saved comments', () => {
    jest.useFakeTimers()
    try {
        const waitForPendingWrites = jest.fn()
        const stopAuth = jest.fn()
        const auth = {
            currentUser: null,
            onAuthStateChanged: callback => {
                callback(null)
                return stopAuth
            },
        }
        const stop = installCommentOutbox(
            { waitForPendingWrites },
            auth,
            { getState: () => ({ loggedUser: {} }) },
            {
                isOffline: () => false,
                subscribeVisible: () => () => {},
                subscribeHealth: () => () => {},
            }
        )
        jest.advanceTimersByTime(15000)
        expect(waitForPendingWrites).not.toHaveBeenCalled()
        stop()
        expect(stopAuth).toHaveBeenCalledTimes(1)
    } finally {
        jest.useRealTimers()
    }
})

it('persists the complete submission before a cold-cache read can fail, then retries after reload with the same ID', async () => {
    const first = createCommentOutbox()
    const error = Object.assign(new Error('offline read'), { code: 'unavailable' })
    const read = jest.fn(async () => {
        expect(first.list('user-1')[0].comment).toBe(values.comment)
        throw error
    })
    configure(first, read)
    await expect(first.flushOne(first.enqueue(values))).rejects.toBe(error)
    const restored = createCommentOutbox()
    const send = jest.fn(async () => {})
    configure(restored, send)
    await restored.flush()
    expect(send.mock.calls[0][0]).toMatchObject(values)
    expect(restored.list('user-1')).toEqual([])
})

it('retains a pending entry until the real acknowledgement, coalesces retries, and keeps offline input without sending', async () => {
    const outbox = createCommentOutbox()
    const write = deferred()
    const send = jest.fn(() => write.promise)
    configure(outbox, send, undefined, () => false)
    const entry = outbox.enqueue(values)
    await outbox.flush()
    expect(send).not.toHaveBeenCalled()
    configure(outbox, send)
    const first = outbox.flushOne(entry)
    expect(outbox.flushOne(entry)).toBe(first)
    await Promise.resolve()
    await Promise.resolve()
    expect(outbox.list('user-1')).toHaveLength(1)
    write.resolve()
    await first
    expect(outbox.list('user-1')).toHaveLength(0)
})

it('keeps permanent failures visible and does not endlessly retry them; explicit retry reuses the same ID', async () => {
    const outbox = createCommentOutbox()
    const send = jest.fn().mockRejectedValueOnce({ code: 'permission-denied' }).mockResolvedValue(undefined)
    configure(outbox, send)
    await expect(outbox.flushOne(outbox.enqueue(values))).rejects.toMatchObject({ code: 'permission-denied' })
    expect(outbox.list('user-1')[0].status).toBe('failed')
    await outbox.flush()
    expect(send).toHaveBeenCalledTimes(1)
    await outbox.retry('user-1', values.id)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][0].id).toBe(values.id)
})

it("does not send another account's entries or continue a read after logout", async () => {
    let user = 'user-1'
    const gate = deferred()
    const send = jest.fn(async (entry, isActive) => {
        await gate.promise
        if (!isActive()) throw { code: 'cancelled' }
    })
    const outbox = createCommentOutbox()
    configure(outbox, send, () => user)
    const entry = outbox.enqueue(values)
    const run = outbox.flushOne(entry)
    await Promise.resolve()
    await Promise.resolve()
    user = 'user-2'
    gate.resolve()
    await expect(run).rejects.toMatchObject({ code: 'cancelled' })
    await outbox.flush()
    expect(send).toHaveBeenCalledTimes(1)
    expect(outbox.list('user-1')).toHaveLength(1)
})

it('does not accept a submission when local persistence fails', () => {
    const outbox = createCommentOutbox({
        storage: () => ({
            setItem() {
                throw new Error('Quota exceeded')
            },
        }),
    })
    expect(() => outbox.enqueue(values)).toThrow('Quota exceeded')
})

it('leaves a confirmed tombstone if deleting the local entry fails', async () => {
    const storage = {
        getItem: key => localStorage.getItem(key),
        setItem: (k, v) => localStorage.setItem(k, v),
        removeItem: () => {
            throw Error('blocked')
        },
    }
    const outbox = createCommentOutbox({ storage: () => storage })
    configure(outbox, async () => {})
    await outbox.flushOne(outbox.enqueue(values))
    expect(outbox.read('user-1', 'comment-1').status).toBe('sent')
})

it('times out a stalled pre-read without losing the comment and invalidates that attempt before retry', async () => {
    jest.useFakeTimers()
    try {
        let isActive
        const send = jest.fn((entry, active) => {
            isActive = active
            return new Promise(() => {})
        })
        const outbox = createCommentOutbox({ sendTimeoutMs: 100 })
        configure(outbox, send)
        const run = outbox.flushOne(outbox.enqueue(values))
        const rejection = expect(run).rejects.toMatchObject({ code: 'deadline-exceeded' })
        await jest.advanceTimersByTimeAsync(100)
        await rejection
        expect(isActive()).toBe(false)
        expect(outbox.list('user-1')).toHaveLength(1)
        configure(outbox, async () => {})
        await outbox.flush()
        expect(outbox.list('user-1')).toHaveLength(0)
    } finally {
        jest.useRealTimers()
    }
})

it('serialises submissions in the same chat and preserves unrelated/corrupt storage entries', async () => {
    const gate = deferred()
    const outbox = createCommentOutbox()
    const send = jest
        .fn()
        .mockImplementationOnce(() => gate.promise)
        .mockResolvedValue(undefined)
    configure(outbox, send)
    outbox.enqueue(values)
    outbox.enqueue({ ...values, id: 'comment-2', created: Date.now() + 1 })
    localStorage.setItem(`${COMMENT_OUTBOX_PREFIX}user-1:broken`, 'invalid')
    localStorage.setItem('unrelated', 'keep')
    const run = outbox.flush()
    await Promise.resolve()
    await Promise.resolve()
    expect(send).toHaveBeenCalledTimes(1)
    gate.resolve()
    await run
    expect(send).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem('unrelated')).toBe('keep')
})
