'use strict'

/**
 * Security audit 2026-11: the global assistant catalog (`assistants/globalProject/items/*`) is
 * curated by the administrator alone. `firestore.rules` already says so for client writes, but
 * the assistant tools (`update_assistant_settings`, `update_heartbeat_settings`) write through the
 * Admin SDK, which bypasses the rules. They used to treat `globalProject` as accessible to every
 * caller, so any signed-in user could rewrite the default assistant every other account talks to.
 *
 * Invariant: a server-side write to an assistant document in `globalProject` happens only when the
 * requesting user is `roles/administrator.userId`. Every Admin SDK write to an assistant ref that a
 * tool resolved must pass through `assertCanWriteAssistantInProject` first.
 */

const admin = require('firebase-admin')

const GLOBAL_ASSISTANT_PROJECT_ID = 'globalProject'
const GLOBAL_ASSISTANT_WRITE_DENIED_MESSAGE =
    'Global assistants are shared by every Alldone account and can only be changed by the administrator. Create or copy the assistant into one of your projects to change its settings.'

async function isAssistantCatalogAdministrator(requestUserId, db = admin.firestore()) {
    if (typeof requestUserId !== 'string' || !requestUserId) return false
    const roleDoc = await db
        .doc('roles/administrator')
        .get()
        .catch(() => null)
    const adminUserId = roleDoc?.exists ? (roleDoc.data() || {}).userId : null
    return !!adminUserId && adminUserId === requestUserId
}

async function assertCanWriteAssistantInProject(projectIdForRef, requestUserId, db = admin.firestore()) {
    if (projectIdForRef !== GLOBAL_ASSISTANT_PROJECT_ID) return
    if (!(await isAssistantCatalogAdministrator(requestUserId, db))) {
        throw new Error(GLOBAL_ASSISTANT_WRITE_DENIED_MESSAGE)
    }
}

module.exports = {
    GLOBAL_ASSISTANT_WRITE_DENIED_MESSAGE,
    isAssistantCatalogAdministrator,
    assertCanWriteAssistantInProject,
}
