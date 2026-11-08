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
 *
 * The run is platform-paid on purpose (no Gold is charged): it is the greeting a guide posts when
 * somebody joins, the joiner did not ask for it, and a newcomer without Gold must still get it.
 * What keeps that from being a free assistant (security audit 2026-11,
 * assistantWelcomeMessageForGuide.js:uncharged-assistant-run): the project must be a guide, the
 * guide name in the prompt comes from the stored template or guide, not from the request, and
 * each greeting runs once (`claimWelcomeMessage`): the group welcome once per guide, the personal
 * welcome once per guide and member. A repeat call returns without a model call.
 */

const { HttpsError } = require('firebase-functions/v2/https')
const { assertObjectAccess } = require('../shared/privacyAccess')
const { isAllowedRedirectTarget } = require('../WebApp/openInBrowserTab')

const DEFAULT_APP_ORIGIN = 'https://my.alldone.app'
const MAX_NAME_LENGTH = 200
// Server-only (no client rule, so firestore.rules' default deny applies).
const WELCOME_CLAIMS_COLLECTION = 'assistantWelcomeMessageClaims'

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
    const projectData = projectDoc.exists ? projectDoc.data() || {} : {}
    const parentTemplateId = typeof projectData.parentTemplateId === 'string' ? projectData.parentTemplateId : ''
    if (!parentTemplateId) throw new HttpsError('failed-precondition', 'Welcome messages are only posted in guides')
    const templateDoc = await db.doc(`projects/${parentTemplateId}`).get()
    // The app sends the template's name; read it rather than take it from the request.
    const guideName =
        optionalString(templateDoc.exists ? templateDoc.data()?.name : '') || optionalString(projectData.name)

    const memberIds = new Set(Array.isArray(projectData.userIds) ? projectData.userIds : [])
    const requestedRecipients = Array.isArray(data.userIdsToNotify) ? data.userIdsToNotify : []
    const userIdsToNotify = [...new Set(requestedRecipients.filter(id => typeof id === 'string' && memberIds.has(id)))]

    const resolved = {
        callerUid: uid,
        projectId,
        objectId,
        userIdsToNotify,
        guideName,
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

function getWelcomeClaimRef(db, resolved, { greetCaller = false } = {}) {
    const scope = greetCaller ? `user__${resolved.callerUid}` : 'guide'
    return db.doc(`${WELCOME_CLAIMS_COLLECTION}/${resolved.projectId}__${scope}`)
}

// True when this call may run the greeting; false when it already ran (or is running).
async function claimWelcomeMessage(db, resolved, options = {}) {
    try {
        await getWelcomeClaimRef(db, resolved, options).create({
            projectId: resolved.projectId,
            objectId: resolved.objectId,
            userId: resolved.callerUid,
            createdAt: Date.now(),
        })
        return true
    } catch (error) {
        if (error?.code === 6 || error?.code === 'already-exists') return false
        throw error
    }
}

// A run that failed gives its claim back, so the greeting is not lost to a transient error.
async function releaseWelcomeMessage(db, resolved, options = {}) {
    try {
        await getWelcomeClaimRef(db, resolved, options).delete()
    } catch (error) {
        console.warn('welcomeMessageAccess: could not release the claim', { error: error?.message })
    }
}

async function runWelcomeMessageOnce(db, resolved, options, run) {
    if (!(await claimWelcomeMessage(db, resolved, options))) return { skipped: 'already_welcomed' }
    try {
        return await run()
    } catch (error) {
        await releaseWelcomeMessage(db, resolved, options)
        throw error
    }
}

module.exports = {
    resolveWelcomeMessageRequest,
    claimWelcomeMessage,
    runWelcomeMessageOnce,
    WELCOME_CLAIMS_COLLECTION,
    resolveAppOrigin,
    DEFAULT_APP_ORIGIN,
}
