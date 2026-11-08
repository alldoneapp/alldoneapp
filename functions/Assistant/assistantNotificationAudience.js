'use strict'

/**
 * Who an assistant answer may notify (push, WhatsApp, email, in-app unread rows, the
 * last-assistant-comment pointer on users/{uid}).
 *
 * security audit 2026-11: askToBotSecondGen and generatePreConfigTaskResultSecondGen took
 * `followerIds` and `userIdsToNotify` from request.data and handed them, unchanged, to the
 * Admin SDK notification fan-out, so any signed-in user could push an assistant answer to an
 * arbitrary uid. The client still proposes the lists (it knows the followers and applies each
 * member's settings); the server only ever NARROWS them, to the same audience
 * firestore.rules `hasValidNotificationRecipients` allows a client comment to notify:
 * current members of the project (projects/{pid}.userIds) who can read the thread's parent
 * object (isPublicFor holds 0 or the user).
 */

const { getObjectDocPath } = require('../shared/privacyAccess')

const FEED_PUBLIC_FOR_ALL = 0

// Parent documents of a comment thread, as `commentParentPath` in firestore.rules resolves them.
// A contact thread may also be a project member's own board, which has no contact document.
function getThreadParentPath(projectId, objectType, objectId) {
    const type = String(objectType || '').trim()
    if (type === 'contacts' || type === 'users') return `projectsContacts/${projectId}/contacts/${objectId}`
    if (type === 'assistants' || type === 'assistant') return null
    return getObjectDocPath(projectId, type, objectId)
}

async function resolveThreadAudience(db, { projectId, objectType, objectId }) {
    if (!projectId || !objectId) return { members: new Set(), canRead: () => false }

    const projectDoc = await db.doc(`projects/${projectId}`).get()
    const memberIds = projectDoc.exists && Array.isArray(projectDoc.data()?.userIds) ? projectDoc.data().userIds : []
    const members = new Set(memberIds)

    const type = String(objectType || '').trim()
    const parentPath = getThreadParentPath(projectId, type, objectId)
    if (!parentPath) {
        // Assistant boards: every member may read them (rules: recipients.hasOnly(project userIds)).
        return { members, canRead: () => true }
    }

    const parentDoc = await db.doc(parentPath).get()
    if (!parentDoc.exists) {
        // A member's own board in a contact-typed thread has no contact document.
        const isMemberBoard = (type === 'contacts' || type === 'users') && members.has(objectId)
        return { members, canRead: () => isMemberBoard }
    }

    const isPublicFor = Array.isArray(parentDoc.data()?.isPublicFor) ? parentDoc.data().isPublicFor : []
    const visibleToAll = isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
    return { members, canRead: uid => visibleToAll || isPublicFor.includes(uid) }
}

/**
 * Narrows caller-proposed recipient lists to the thread's audience. Returns new arrays and never
 * adds anyone. Fails closed: if the audience cannot be read, nobody is notified.
 */
async function narrowAssistantNotificationRecipients(db, thread, { followerIds, userIdsToNotify } = {}) {
    let audience
    try {
        audience = await resolveThreadAudience(db, thread)
    } catch (error) {
        console.warn('assistantNotificationAudience: could not resolve the thread audience', {
            projectId: thread?.projectId,
            objectType: thread?.objectType,
            objectId: thread?.objectId,
            error: error?.message,
        })
        audience = { members: new Set(), canRead: () => false }
    }
    const narrow = list =>
        Array.isArray(list)
            ? [
                  ...new Set(
                      list.filter(uid => typeof uid === 'string' && audience.members.has(uid) && audience.canRead(uid))
                  ),
              ]
            : list
    return { followerIds: narrow(followerIds), userIdsToNotify: narrow(userIdsToNotify) }
}

module.exports = {
    narrowAssistantNotificationRecipients,
    resolveThreadAudience,
}
