'use strict'

/**
 * Who may read and who may change an assistant through a callable.
 *
 * Reading follows the assistant's project: a member of the project, or, for the global catalog
 * (`globalProject`), a member of any project that lists the assistant in `globalAssistantIds`.
 *
 * Writing a global catalog assistant is administrator-only, exactly as `firestore.rules`
 * (`isGlobalAssistantCatalog`) requires for client writes (security audit 2026-11). A callable writes
 * with the Admin SDK, so it must apply that rule itself: before this check,
 * `generateAssistantDelegationDescriptionSecondGen` used the read gate and let any member of a
 * project that lists a global assistant overwrite that catalog entry, which template sync then
 * copies into every project using it.
 */

const { HttpsError } = require('firebase-functions/v2/https')
const { assertProjectAccess } = require('../shared/privacyAccess')

const GLOBAL_PROJECT_ID = 'globalProject'

async function isAdministrator(db, userId) {
    const administratorDoc = await db
        .doc('roles/administrator')
        .get()
        .catch(() => null)
    return !!administratorDoc?.exists && administratorDoc.data()?.userId === userId
}

async function assertAssistantProjectAccess(db, userId, projectId, assistantId, { forWrite = false } = {}) {
    if (!userId) throw new HttpsError('unauthenticated', 'Sign in required')
    const userDoc = await db.doc(`users/${userId}`).get()
    if (!userDoc.exists) throw new HttpsError('permission-denied', 'User not found')

    if (projectId !== GLOBAL_PROJECT_ID) {
        try {
            await assertProjectAccess(db, userId, projectId)
        } catch (error) {
            throw new HttpsError('permission-denied', 'No access to project')
        }
        return
    }

    const assistantDoc = await db.doc(`assistants/${GLOBAL_PROJECT_ID}/items/${assistantId}`).get()
    if (!assistantDoc.exists) throw new HttpsError('not-found', 'Assistant not found')

    if (await isAdministrator(db, userId)) return
    if (forWrite) {
        throw new HttpsError('permission-denied', 'Only administrators can change global assistants')
    }

    const memberProjects = await db.collection('projects').where('userIds', 'array-contains', userId).get()
    const listsAssistant = memberProjects.docs.some(doc => {
        const globalAssistantIds = doc.data()?.globalAssistantIds
        return Array.isArray(globalAssistantIds) && globalAssistantIds.includes(assistantId)
    })
    if (!listsAssistant) {
        throw new HttpsError('permission-denied', 'No access to global assistant')
    }
}

module.exports = { assertAssistantProjectAccess, GLOBAL_PROJECT_ID }
