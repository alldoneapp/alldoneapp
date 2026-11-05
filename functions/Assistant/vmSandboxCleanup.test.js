const { recordVmSandboxDeletion, drainVmSandboxDeletions } = require('./vmSandboxCleanup')

function fixture({ referenced = false, killError, deleteError, notBefore } = {}) {
    const ref = {
        delete: jest.fn(async () => {
            if (deleteError) throw deleteError
        }),
    }
    const deletions = {
        get: jest.fn(async () => ({ docs: [{ id: 'sandbox-old', ref, data: () => ({ notBefore }) }] })),
    }
    const references = { where: jest.fn(() => ({ limit: () => ({ get: async () => ({ empty: !referenced }) }) })) }
    const db = { collection: jest.fn(name => (name === 'vmSandboxDeletions' ? deletions : references)) }
    const killSandbox = jest.fn(async () => {
        if (killError) throw killError
        return false
    })
    return { db, ref, killSandbox }
}

test('records a deletion in the same transaction as session detachment', () => {
    const transaction = { set: jest.fn() }
    const ref = {}
    const db = { doc: jest.fn(() => ref) }
    recordVmSandboxDeletion(transaction, db, 'sandbox-old', 'thread', 123)
    expect(db.doc).toHaveBeenCalledWith('vmSandboxDeletions/sandbox-old')
    expect(transaction.set).toHaveBeenCalledWith(
        ref,
        { sandboxId: 'sandbox-old', sessionId: 'thread', requestedAt: 123 },
        { merge: true }
    )
})

test('keeps the deletion record when E2B fails, then retries successfully', async () => {
    const f = fixture({ killError: new Error('provider unavailable') })
    expect(await drainVmSandboxDeletions({ ...f, apiKey: 'key' })).toEqual({ deleted: 0, failed: 1, referenced: 0 })
    expect(f.ref.delete).not.toHaveBeenCalled()
    f.killSandbox.mockResolvedValueOnce(true)
    expect(await drainVmSandboxDeletions({ ...f, apiKey: 'key' })).toEqual({ deleted: 1, failed: 0, referenced: 0 })
    expect(f.ref.delete).toHaveBeenCalledTimes(1)
})

test('treats an already missing provider sandbox as a successful deletion', async () => {
    const f = fixture()
    expect(await drainVmSandboxDeletions({ ...f, apiKey: 'key' })).toEqual({ deleted: 1, failed: 0, referenced: 0 })
    expect(f.killSandbox).toHaveBeenCalledWith('sandbox-old', { apiKey: 'key', requestTimeoutMs: 10000 })
})

test('does not kill a sandbox that still has a session reference', async () => {
    const f = fixture({ referenced: true })
    expect(await drainVmSandboxDeletions({ ...f, apiKey: 'key' })).toEqual({ deleted: 0, failed: 0, referenced: 1 })
    expect(f.killSandbox).not.toHaveBeenCalled()
    expect(f.ref.delete).not.toHaveBeenCalled()
})

test('keeps a retry record if the provider succeeded but Firestore deletion failed', async () => {
    const f = fixture({ deleteError: new Error('database unavailable') })
    expect(await drainVmSandboxDeletions({ ...f, apiKey: 'key' })).toEqual({ deleted: 0, failed: 1, referenced: 0 })
    expect(f.killSandbox).toHaveBeenCalledTimes(1)
})

test('does nothing without credentials', async () => {
    const f = fixture()
    await drainVmSandboxDeletions({ ...f, apiKey: '' })
    expect(f.db.collection).not.toHaveBeenCalled()
})

test('retains a recent orphan until its seven-day deadline, then deletes it', async () => {
    const f = fixture({ notBefore: 3000 })
    await drainVmSandboxDeletions({ ...f, apiKey: 'key', now: 2000 })
    expect(f.killSandbox).not.toHaveBeenCalled()
    expect(f.ref.delete).not.toHaveBeenCalled()
    await drainVmSandboxDeletions({ ...f, apiKey: 'key', now: 3000 })
    expect(f.killSandbox).toHaveBeenCalledTimes(1)
    expect(f.ref.delete).toHaveBeenCalledTimes(1)
})

test('future cleanup records do not consume the bounded deletion budget', async () => {
    const f = fixture()
    const future = { id: 'future', data: () => ({ notBefore: 5000 }), ref: { delete: jest.fn() } }
    const due = { id: 'due', data: () => ({}), ref: { delete: jest.fn() } }
    const extra = { id: 'extra', data: () => ({}), ref: { delete: jest.fn() } }
    const collection = f.db.collection('vmSandboxDeletions')
    collection.get.mockResolvedValue({ docs: [future, due, extra] })
    await drainVmSandboxDeletions({ ...f, apiKey: 'key', now: 3000, limit: 1 })
    expect(f.killSandbox).toHaveBeenCalledTimes(1)
    expect(f.killSandbox).toHaveBeenCalledWith('due', expect.any(Object))
    expect(future.ref.delete).not.toHaveBeenCalled()
    expect(extra.ref.delete).not.toHaveBeenCalled()
})
