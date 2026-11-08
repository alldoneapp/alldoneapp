'use strict'

/**
 * Binds the two guide welcome-message callables to the signed-in caller.
 *
 * They used to take the run's identity from the request (`userIdsToNotify[0]`, `userId`) and
 * never checked project or chat access, so any signed-in account could run a project's assistant,
 * with that assistant's tools, as any other user. The welcome flow in
 * `utils/backends/Projects/guidesFirestore.js` only ever greets the logged-in user, who has
 * already been added to the guide when it calls these, so binding to `request.auth.uid` changes
 * nothing for the legitimate path.
 *
 * Everything else that reaches the prompt or the notification fan-out is derived or validated
 * here: the caller must be able to read the welcome chat, notifications only go to current
 * project members, the greeted user's name comes from their own user document, and the task
 * link origin must be an Alldone app origin.
 */

const { HttpsError } = require('firebase-functions/v2/https')
const { assertObjectAccess } = require('../shared/privacyAccess')
const { isAllowedRedirectTarget } = require('../WebApp/openInBrowserTab')

const DEFAULT_APP_ORIGIN = 'https://my.alldone.app'
const MAX_NAME_LENGTH = 200

function requireString(value, field) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new HttpsError('invalid-argument', `${field} is required`)
    }
    return value.trim()
}

function optionalString(value, maxLength = MAX_NAME_LENGTH) {
    if (typeof value !== 'string') return ''
    return value.trim().slice(0, maxLength)
}

function resolveAppOrigin(rawOrigin) {
    if (typeof rawOrigin !== 'string' || !rawOrigin.trim()) return DEFAULT_APP_ORIGIN
    const allowed = isAllowedRedirectTarget(rawOrigin.trim())
    if (!allowed) return DEFAULT_APP_ORIGIN
    return new URL(allowed).origin
}

function getFirstName(displayName) {
    const name = optionalString(displayName)
    return name.split(/\s+/)[0] || ''
}

async function resolveWelcomeMessageRequest(db, request, { greetCaller = false } = {}) {
    const uid = request?.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required')

    const data = request.data || {}
    const projectId = requireString(data.projectId, 'projectId')
    const objectId = requireString(data.objectId, 'objectId')

    try {
        await assertObjectAccess(db, uid, projectId, 'topics', objectId)
    } catch (error) {
        throw new HttpsError('permission-denied', 'No access to this chat')
    }

    const [projectDoc, userDoc] = await Promise.all([
        db.doc(`projects/${projectId}`).get(),
        greetCaller ? db.doc(`users/${uid}`).get() : Promise.resolve(null),
    ])
    const memberIds = new Set(
        projectDoc.exists && Array.isArray(projectDoc.data()?.userIds) ? projectDoc.data().userIds : []
    )
    const requestedRecipients = Array.isArray(data.userIdsToNotify) ? data.userIdsToNotify : []
    const userIdsToNotify = [...new Set(requestedRecipients.filter(id => typeof id === 'string' && memberIds.has(id)))]

    const resolved = {
        callerUid: uid,
        projectId,
        objectId,
        userIdsToNotify,
        guideName: optionalString(data.guideName),
        language: optionalString(data.language, 64) || 'english',
        assistantId: typeof data.assistantId === 'string' ? data.assistantId.trim() : '',
    }

    if (greetCaller) {
        const userData = userDoc?.exists ? userDoc.data() || {} : {}
        resolved.userName = getFirstName(userData.displayName) || optionalString(data.userName)
        resolved.taskListUrlOrigin = resolveAppOrigin(data.taskListUrlOrigin)
    }

    return resolved
}

module.exports = {
    resolveWelcomeMessageRequest,
    resolveAppOrigin,
    DEFAULT_APP_ORIGIN,
}
