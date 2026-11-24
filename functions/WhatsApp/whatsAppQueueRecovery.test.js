jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))
jest.mock('./whatsAppQueueDispatch', () => ({ enqueueWhatsAppQueueRun: jest.fn(async () => ({ enqueued: true })) }))

const admin = require('firebase-admin')
const { enqueueWhatsAppQueueRun } = require('./whatsAppQueueDispatch')
const { recoverWhatsAppInboundQueues } = require('./whatsAppQueueRecovery')

const NOW = 1795540000000

function prepareQueues(ids, cursor = '', activeIds = ids, locks = {}) {
    const cursorRef = {
        get: jest.fn(async () => ({ data: () => ({ lastUserId: cursor }) })),
        set: jest.fn(async () => {}),
    }
    const users = ids.map(id => {
        const query = {
            where: jest.fn(() => query),
            limit: jest.fn(() => query),
            get: jest.fn(async () => ({ empty: !activeIds.includes(id) })),
        }
        return { id, collection: jest.fn(() => query) }
    })
    admin.firestore.mockReturnValue({
        doc: jest.fn(path => {
            if (path === 'whatsAppInboundRecovery/cursor') return cursorRef
            const userId = path.split('/')[1]
            return {
                get: jest.fn(async () => ({
                    exists: userId in locks,
                    data: () => ({ expiresAt: locks[userId] }),
                })),
            }
        }),
        collection: jest.fn(() => ({ listDocuments: jest.fn(async () => users) })),
    })
    return { cursorRef, users }
}

const recover = () => recoverWhatsAppInboundQueues({ now: () => NOW })

beforeEach(() => jest.clearAllMocks())

test('dispatches queued work to the worker even when its historical queue parent has no document', async () => {
    prepareQueues(['u1', 'u2'], '', ['u2'])
    await expect(recover()).resolves.toEqual({ checked: 2, resumed: 1 })
    expect(enqueueWhatsAppQueueRun).toHaveBeenCalledTimes(1)
    expect(enqueueWhatsAppQueueRun).toHaveBeenCalledWith('u2', expect.stringMatching(/^recover:\d+$/))
})

test('leaves a user alone while a worker holds a live lock, and recovers once the lock has expired', async () => {
    prepareQueues(['u1', 'u2'], '', ['u1', 'u2'], { u1: NOW + 60000, u2: NOW - 1 })
    await expect(recover()).resolves.toEqual({ checked: 2, resumed: 1 })
    expect(enqueueWhatsAppQueueRun).toHaveBeenCalledWith('u2', expect.any(String))
    expect(enqueueWhatsAppQueueRun).not.toHaveBeenCalledWith('u1', expect.any(String))
})

test('bounds scans and rotates past the persisted cursor so busy early users cannot starve later ones', async () => {
    const { cursorRef } = prepareQueues(
        Array.from({ length: 30 }, (_, i) => `u${String(i).padStart(2, '0')}`),
        'u20',
        []
    )
    await recover()
    expect(cursorRef.set.mock.calls[0][0].lastUserId).toBe('u21')
    expect(cursorRef.set).toHaveBeenCalledTimes(25)
    expect(cursorRef.set.mock.calls.at(-1)[0].lastUserId).toBe('u15')
})

test('continues scanning other users after a dispatch error', async () => {
    prepareQueues(['u1', 'u2'])
    enqueueWhatsAppQueueRun.mockRejectedValueOnce(new Error('transient failure'))
    await recover()
    expect(enqueueWhatsAppQueueRun).toHaveBeenCalledTimes(2)
})
