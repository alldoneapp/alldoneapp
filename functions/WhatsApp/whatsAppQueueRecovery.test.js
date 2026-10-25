jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))
jest.mock('./whatsAppInboundQueueProcessor', () => ({ processWhatsAppInboundQueueItem: jest.fn(async () => {}) }))

const admin = require('firebase-admin')
const { processWhatsAppInboundQueueItem } = require('./whatsAppInboundQueueProcessor')
const { recoverWhatsAppInboundQueues } = require('./whatsAppQueueRecovery')

function prepareQueues(ids, cursor = '', activeIds = ids) {
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
        doc: jest.fn(() => cursorRef),
        collection: jest.fn(() => ({ listDocuments: jest.fn(async () => users) })),
    })
    return { cursorRef, users }
}

beforeEach(() => jest.clearAllMocks())

test('resumes queued work even when its historical queue parent has no document', async () => {
    prepareQueues(['u1', 'u2'], '', ['u2'])
    await expect(recoverWhatsAppInboundQueues()).resolves.toEqual({ checked: 2, resumed: 1 })
    expect(processWhatsAppInboundQueueItem).toHaveBeenCalledWith(
        { params: { userId: 'u2' } },
        { deadlineAt: expect.any(Number) }
    )
})

test('bounds scans and rotates past the persisted cursor so busy early users cannot starve later ones', async () => {
    const { cursorRef } = prepareQueues(
        Array.from({ length: 30 }, (_, i) => `u${String(i).padStart(2, '0')}`),
        'u20',
        []
    )
    await recoverWhatsAppInboundQueues()
    expect(cursorRef.set.mock.calls[0][0].lastUserId).toBe('u21')
    expect(cursorRef.set).toHaveBeenCalledTimes(25)
    expect(cursorRef.set.mock.calls.at(-1)[0].lastUserId).toBe('u15')
})

test('continues scanning other users after a worker error', async () => {
    prepareQueues(['u1', 'u2'])
    processWhatsAppInboundQueueItem.mockRejectedValueOnce(new Error('transient failure'))
    await recoverWhatsAppInboundQueues()
    expect(processWhatsAppInboundQueueItem).toHaveBeenCalledTimes(2)
})
