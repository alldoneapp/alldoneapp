// The Firestore trigger and the recovery sweep only hand a user's WhatsApp queue to the Cloud Tasks
// worker (runWhatsAppInboundQueue in index.js). The worker drains it under the user's queue lock
// with the 25-minute assistant budget; an Eventarc trigger could carry at most 540 seconds.
const { createHash } = require('crypto')
const { getFunctions } = require('firebase-admin/functions')
const { WHATSAPP_FUNCTION_TIMEOUT_SECONDS } = require('../Assistant/assistantRunLimits')

const WHATSAPP_QUEUE_WORKER = 'locations/europe-west1/functions/runWhatsAppInboundQueue'

// `reason` names the event behind the dispatch (one queued message, one recovery slot). The task id
// is derived from it, so a redelivered trigger does not start the drain twice. Two different
// dispatches for one user are harmless: the second worker finds the lock held and stops.
async function enqueueWhatsAppQueueRun(userId, reason, { queue } = {}) {
    if (!userId) return { skipped: true }
    const id = `whatsapp-${createHash('sha256')
        .update(JSON.stringify([userId, String(reason || '')]))
        .digest('hex')}`
    const workerQueue = queue || getFunctions().taskQueue(WHATSAPP_QUEUE_WORKER)
    try {
        await workerQueue.enqueue({ userId }, { id, dispatchDeadlineSeconds: WHATSAPP_FUNCTION_TIMEOUT_SECONDS })
        return { enqueued: true }
    } catch (error) {
        if (['functions/task-already-exists', 'already-exists', 6].includes(error?.code)) return { duplicate: true }
        throw error
    }
}

module.exports = { enqueueWhatsAppQueueRun, WHATSAPP_QUEUE_WORKER }
