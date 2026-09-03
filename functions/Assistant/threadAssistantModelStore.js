'use strict'

/**
 * Server-side read of a thread's pinned assistant model (AT-2502).
 *
 * The interactive chat entry point (`askToBotSecondGen`) receives no model from the client at
 * all — the model has always been resolved on the server from the assistant document. So a
 * per-thread override has to be resolved here too; sending it up with the request would make it
 * forgeable, and would silently lose the pin for every run this browser did not start.
 *
 * The thread's host document is the same one `assertObjectAccess` already reads to authorize the
 * request, and it is addressed by the same `getObjectDocPath` map the client uses to write the
 * field — one mapping, two consumers, so a new object type cannot be supported on one side only.
 *
 * The read is BEST-EFFORT by contract and returns `null` on every failure. An override is a
 * convenience; an assistant that refuses to answer because a settings read failed is an outage.
 * Note this is the same reasoning as `taskUndoCapture` and the opposite of a permission check —
 * nothing here decides whether the run may happen, only which model it uses.
 */

const { getObjectDocPath } = require('../shared/privacyAccess')
const { getThreadAssistantModelOverride } = require('./threadAssistantModel')

/**
 * The model key this thread is pinned to, or `null`.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} projectId
 * @param {string} objectType e.g. 'tasks' | 'topics' | 'notes' | 'goals' | 'contacts' | 'skills'
 * @param {string} objectId
 */
async function readThreadAssistantModelOverride(db, projectId, objectType, objectId) {
    try {
        if (!db || !projectId || !objectId) return null

        const path = getObjectDocPath(projectId, objectType, objectId)
        // An object type with no document of its own (or an unmapped one) simply cannot carry a
        // pin — that is not an error, it is the ordinary answer for those threads.
        if (!path) return null

        const doc = await db.doc(path).get()
        if (!doc || !doc.exists) return null

        return getThreadAssistantModelOverride(doc.data())
    } catch (error) {
        console.warn('[threadAssistantModel] Could not read the thread model override', {
            projectId,
            objectType,
            objectId,
            error: error?.message,
        })
        return null
    }
}

module.exports = {
    readThreadAssistantModelOverride,
}
