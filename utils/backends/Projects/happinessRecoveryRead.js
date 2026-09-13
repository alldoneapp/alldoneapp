// Recovery must first drain the SDK's persisted mutation queue: a batch from
// the previous page may already be queued even though its Promise was lost.
export const readHappinessForSave = async (db, ref, recoverable, assertAccount) => {
    if (recoverable) await db.waitForPendingWrites()
    assertAccount()
    const snapshot = await (recoverable ? ref.get({ source: 'server' }) : ref.get())
    assertAccount()
    return snapshot
}
