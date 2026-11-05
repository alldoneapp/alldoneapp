// Server-only deletion outbox. Detach a sandbox and record its deletion in the same
// transaction, so a provider failure cannot make it disappear from future cleanup runs.
const VM_SANDBOX_DELETIONS = 'vmSandboxDeletions'

function recordVmSandboxDeletion(transaction, db, sandboxId, sessionId, now = Date.now()) {
    if (!sandboxId) return
    transaction.set(
        db.doc(`${VM_SANDBOX_DELETIONS}/${sandboxId}`),
        { sandboxId, sessionId: sessionId || null, requestedAt: now },
        { merge: true }
    )
}

async function drainVmSandboxDeletions({ db, apiKey, killSandbox, limit = 20 }) {
    const result = { deleted: 0, failed: 0, referenced: 0 }
    if (!apiKey) return result
    const snapshot = await db.collection(VM_SANDBOX_DELETIONS).limit(limit).get()
    for (const doc of snapshot.docs) {
        // The document ID is the deletion target, never a caller-controlled payload field.
        const sandboxId = doc.id
        try {
            const references = await db.collection('vmSessions').where('sandboxId', '==', sandboxId).limit(1).get()
            if (!references.empty) {
                result.referenced += 1
                console.warn('🧹 VM SESSIONS CLEANUP: deletion still referenced', { sandboxId })
                continue
            }
            // kill() returning false means E2B already removed it, which is also success.
            await killSandbox(sandboxId, { apiKey, requestTimeoutMs: 10000 })
            await doc.ref.delete()
            result.deleted += 1
        } catch (error) {
            result.failed += 1
            console.warn('🧹 VM SESSIONS CLEANUP: deletion retained for retry', { sandboxId, error: error.message })
        }
    }
    return result
}

module.exports = { VM_SANDBOX_DELETIONS, recordVmSandboxDeletion, drainVmSandboxDeletions }
