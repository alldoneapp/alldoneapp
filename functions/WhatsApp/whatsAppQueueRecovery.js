const admin = require('firebase-admin')
const { WHATSAPP_PROMPT_MAX_RUN_WALL_CLOCK_MS } = require('../Assistant/assistantRunLimits')
const { processWhatsAppInboundQueueItem } = require('./whatsAppInboundQueueProcessor')

const MAX_USERS_PER_SWEEP = 25

async function recoverWhatsAppInboundQueues() {
    const db = admin.firestore()
    const deadlineAt = Date.now() + WHATSAPP_PROMPT_MAX_RUN_WALL_CLOCK_MS
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
        if (Date.now() + 10000 >= deadlineAt) break
        try {
            const work = await userRef
                .collection('items')
                .where('status', 'in', ['pending', 'processing'])
                .limit(1)
                .get()
            if (!work.empty) {
                await processWhatsAppInboundQueueItem({ params: { userId: userRef.id } }, { deadlineAt })
                resumed++
            }
        } catch (error) {
            console.error('WhatsApp Queue: Recovery sweep failed for user', {
                userId: userRef.id,
                error: error.message,
            })
        }
        checked++
        await cursorRef.set({ lastUserId: userRef.id, updatedAt: Date.now() })
    }
    if (resumed) console.log('WhatsApp Queue: Recovery sweep completed', { checked, resumed })
    return { checked, resumed }
}

module.exports = { recoverWhatsAppInboundQueues }
