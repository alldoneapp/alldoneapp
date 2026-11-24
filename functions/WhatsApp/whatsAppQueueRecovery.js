const admin = require('firebase-admin')
const { enqueueWhatsAppQueueRun } = require('./whatsAppQueueDispatch')

const MAX_USERS_PER_SWEEP = 25
// The sweep only dispatches, so it needs seconds, not a run budget.
const RECOVERY_SWEEP_BUDGET_MS = 90 * 1000
// One recovery dispatch per user and schedule slot (the sweep runs every two minutes).
const RECOVERY_SLOT_MS = 2 * 60 * 1000

async function recoverWhatsAppInboundQueues({ now = Date.now } = {}) {
    const db = admin.firestore()
    const deadlineAt = now() + RECOVERY_SWEEP_BUDGET_MS
    const slot = Math.floor(now() / RECOVERY_SLOT_MS)
    const cursorRef = db.doc('whatsAppInboundRecovery/cursor')
    const cursor = (await cursorRef.get()).data()?.lastUserId || ''
    // Queue parents historically have no document, only an items subcollection. listDocuments
    // includes these missing parents too, so pre-fix requests are recovered without a migration
    // or a collection-group index shared with unrelated "items" collections.
    const users = await db.collection('whatsAppInboundQueue').listDocuments()
    const ordered = [...users.filter(ref => ref.id > cursor), ...users.filter(ref => ref.id <= cursor)]
    let checked = 0
    let resumed = 0
    for (const userRef of ordered.slice(0, MAX_USERS_PER_SWEEP)) {
        if (now() + 10000 >= deadlineAt) break
        try {
            const work = await userRef
                .collection('items')
                .where('status', 'in', ['pending', 'processing'])
                .limit(1)
                .get()
            // A live lock means a worker is still answering (a run may now take 25 minutes); it
            // picks up new items itself. An expired lock means the worker died, so dispatch one
            // that resumes pending items and reports stalled ones.
            if (!work.empty && !(await hasLiveQueueLock(db, userRef.id, now()))) {
                await enqueueWhatsAppQueueRun(userRef.id, `recover:${slot}`)
                resumed++
            }
        } catch (error) {
            console.error('WhatsApp Queue: Recovery sweep failed for user', {
                userId: userRef.id,
                error: error.message,
            })
        }
        checked++
        await cursorRef.set({ lastUserId: userRef.id, updatedAt: now() })
    }
    if (resumed) console.log('WhatsApp Queue: Recovery sweep completed', { checked, resumed })
    return { checked, resumed }
}

async function hasLiveQueueLock(db, userId, nowMs) {
    const lock = await db.doc(`whatsAppInboundLocks/${userId}`).get()
    return lock.exists && (Number(lock.data()?.expiresAt) || 0) > nowMs
}

module.exports = { recoverWhatsAppInboundQueues }
