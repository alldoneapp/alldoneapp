import { publishAnnaActivityContext, flushAnnaActivityContext } from './annaActivityContext'
import { getDb } from '../../utils/backends/firestore'

jest.mock('../../utils/backends/firestore', () => ({ getDb: jest.fn() }))
let set, doc
const notice = (userId, suffix = 'm1') => ({
    id: `chat/p1/topic/${suffix}`,
    userId,
    kind: 'chat',
    sourceProjectId: 'p1',
    projectId: 'home',
    chatId: 'anna',
    created: 1,
})
beforeEach(() => {
    set = jest.fn(async () => {})
    doc = jest.fn(() => ({ set }))
    getDb.mockReturnValue({ doc })
})

it('deduplicates writes and merges later enrichment without erasing it on a fallback render', async () => {
    const item = notice('dedupe-user')
    await Promise.all([publishAnnaActivityContext(item.userId, item), publishAnnaActivityContext(item.userId, item)])
    await publishAnnaActivityContext(item.userId, item)
    expect(set).toHaveBeenCalledTimes(1)
    await publishAnnaActivityContext(item.userId, { ...item, content: { label: 'Meeting', preview: 'Ready' } })
    expect(set).toHaveBeenLastCalledWith(
        expect.objectContaining({ content: expect.objectContaining({ preview: 'Ready' }) }),
        { merge: true }
    )
    await publishAnnaActivityContext(item.userId, item)
    expect(set.mock.calls[2][0]).not.toHaveProperty('content')
    expect(set.mock.calls[2][1]).toEqual({ merge: true })
    expect(doc).toHaveBeenCalledWith('users/dedupe-user/private/assistantActivity/notices/chat%2Fp1%2Ftopic%2Fm1')
})

it('flushes the sending account only and waits for its queued write', async () => {
    let resolve
    set.mockImplementationOnce(
        () =>
            new Promise(done => {
                resolve = done
            })
    )
    const item = notice('flush-user')
    const write = publishAnnaActivityContext(item.userId, item)
    await flushAnnaActivityContext('another-user')
    let flushed = false
    const flush = flushAnnaActivityContext(item.userId).then(() => {
        flushed = true
    })
    await Promise.resolve()
    expect(flushed).toBe(false)
    resolve()
    await Promise.all([write, flush])
    expect(flushed).toBe(true)
})

it('rejects foreign ownership and retries failed sync without blocking optional context', async () => {
    const item = notice('retry-user')
    await publishAnnaActivityContext('other-user', item)
    expect(set).not.toHaveBeenCalled()
    set.mockRejectedValueOnce(new Error('offline'))
    const failed = publishAnnaActivityContext(item.userId, item)
    await expect(failed).rejects.toThrow('offline')
    await flushAnnaActivityContext(item.userId)
    await publishAnnaActivityContext(item.userId, item)
    expect(set).toHaveBeenCalledTimes(2)
})
