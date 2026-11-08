'use strict'

/**
 * Builds the notification `sendPushNotificationSecondGen` may deliver (security audit 2026-11).
 *
 * The callable used to hand `request.data` straight to `processPushNotifications`: any signed-in
 * account chose the recipients, the text, the link and the type of an FCM push and a WhatsApp
 * template message, and by naming a `projectId`/`chatId` it made the WhatsApp path look up and send
 * foreign project and chat names. It could also delete any user's chat notification by `id`.
 *
 * Its one caller (`sendPushNotifications` in `utils/backends/firestore.js`) tells a follower of a
 * project, member profile or task that the caller's feed update happened. So the request now names
 * that object, and everything else is checked or derived here:
 * - the caller must be a member of the project, and able to read the task;
 * - each recipient must be a current member, follow the object and (for a task) be able to read it;
 * - the first line of the text (the project name), the task name, the link path and the type are
 *   derived from stored data; only the update line written by the caller is kept, bounded;
 * - `chatId`, `id`, `initiatorVia` and `initiatorId` from the request are ignored, so the
 *   notification cannot reach the chat-name lookup or delete anybody's chat notification.
 */

const { HttpsError } = require('firebase-functions/v2/https')
const { assertProjectAccess, canAccessObject } = require('../shared/privacyAccess')
const { resolveAppOrigin } = require('../Assistant/welcomeMessageAccess')

const UPDATES_NOTIFICATION_TYPE = 'Updates Notification'
const SUPPORTED_OBJECT_TYPES = new Set(['projects', 'users', 'tasks'])
const MAX_RECIPIENTS = 50
const MAX_NAME_LENGTH = 200
const MAX_UPDATE_TEXT_LENGTH = 800

// Plain text only: no control characters other than the line breaks the template relies on.
function cleanText(value, maxLength) {
    if (typeof value !== 'string') return ''
    return value
        .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
        .trim()
        .slice(0, maxLength)
}

function getLinkPath(projectId, objectType, objectId) {
    const project = encodeURIComponent(projectId)
    const object = encodeURIComponent(objectId)
    if (objectType === 'projects') return `/project/${project}/properties`
    if (objectType === 'users') return `/projects/${project}/contacts/${object}/profile`
    return `/projects/${project}/tasks/${object}/properties`
}

function getRequestedOrigin(rawLink) {
    if (typeof rawLink !== 'string' || !rawLink) return null
    try {
        return new URL(rawLink).origin
    } catch (error) {
        return null
    }
}

async function resolvePushNotificationRequest(db, request) {
    const uid = request?.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required')

    const data = request.data || {}
    const projectId = typeof data.projectId === 'string' ? data.projectId.trim() : ''
    const objectType = typeof data.objectType === 'string' ? data.objectType.trim() : ''
    const objectId = typeof data.objectId === 'string' ? data.objectId.trim() : ''
    if (!projectId || !objectId || objectId.includes('/') || !SUPPORTED_OBJECT_TYPES.has(objectType)) {
        throw new HttpsError('invalid-argument', 'projectId, objectType and objectId are required')
    }

    try {
        await assertProjectAccess(db, uid, projectId)
    } catch (error) {
        throw new HttpsError('permission-denied', 'No access to project')
    }

    const projectDoc = await db.doc(`projects/${projectId}`).get()
    const project = projectDoc.data() || {}
    const memberIds = new Set(Array.isArray(project.userIds) ? project.userIds : [])

    let task = null
    if (objectType === 'projects' && objectId !== projectId) {
        throw new HttpsError('invalid-argument', 'Unknown object')
    }
    if (objectType === 'users' && !memberIds.has(objectId)) {
        throw new HttpsError('invalid-argument', 'Unknown object')
    }
    if (objectType === 'tasks') {
        const taskDoc = await db.doc(`items/${projectId}/tasks/${objectId}`).get()
        task = taskDoc.exists ? taskDoc.data() || {} : null
        if (!task || !canAccessObject(task, uid)) {
            throw new HttpsError('permission-denied', 'No access to this task')
        }
    }

    const followersDoc = await db.doc(`followers/${projectId}/${objectType}/${objectId}`).get()
    const followerIds = new Set(
        followersDoc.exists && Array.isArray(followersDoc.data()?.usersFollowing)
            ? followersDoc.data().usersFollowing
            : []
    )
    const requestedRecipients = Array.isArray(data.userIds) ? data.userIds : []
    const userIds = [
        ...new Set(
            requestedRecipients.filter(
                id =>
                    typeof id === 'string' &&
                    memberIds.has(id) &&
                    followerIds.has(id) &&
                    (!task || canAccessObject(task, id))
            )
        ),
    ].slice(0, MAX_RECIPIENTS)

    // The client's text is "<project name>\n  <object line>\n <update line>"; only the update line
    // is the caller's, the rest is rebuilt from stored data (task name, member's first name).
    const lines = typeof data.body === 'string' ? data.body.split('\n') : []
    const projectName = cleanText(project.name, MAX_NAME_LENGTH) || 'Project'
    const updateText = cleanText(lines.slice(objectType === 'projects' ? 1 : 2).join(' '), MAX_UPDATE_TEXT_LENGTH)
    let body
    if (objectType === 'projects') {
        body = `${projectName}\n  ${updateText}`
    } else {
        let objectLine
        if (objectType === 'tasks') {
            objectLine = `✔ ${cleanText(task.name || task.extendedName, MAX_NAME_LENGTH)}`
        } else {
            const memberDoc = await db.doc(`users/${objectId}`).get()
            const displayName = cleanText(memberDoc.data()?.displayName, MAX_NAME_LENGTH)
            objectLine = `👤 ${displayName.split(/\s+/)[0] || ''}`.trim()
        }
        body = `${projectName}\n  ${objectLine}\n ${updateText}`
    }

    return {
        type: UPDATES_NOTIFICATION_TYPE,
        body,
        link: `${resolveAppOrigin(getRequestedOrigin(data.link))}${getLinkPath(projectId, objectType, objectId)}`,
        userIds,
        projectId,
        initiatorId: uid,
    }
}

module.exports = { resolvePushNotificationRequest, UPDATES_NOTIFICATION_TYPE }
