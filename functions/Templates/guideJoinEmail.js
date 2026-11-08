'use strict'

/**
 * The "new user has joined a community" email (`sendUserJoinsToGuideEmailSecondGen`), bound to the
 * signed-in caller (security audit 2026-11).
 *
 * The callable used to take the joining user, the guide and the recipient ids from the request, so
 * any signed-in account could have the account email of any user mailed to any other users, inside
 * Alldone-branded HTML built by plain string interpolation.
 *
 * The one caller (`setUsersAndObjectsWhenUserJoinsToAGuide` in
 * `utils/backends/Projects/guidesFirestore.js`) reports that the logged-in user has just joined a
 * guide, to the template's creator and the administrator. So: the joining user is
 * `request.auth.uid`, who must already be a member of the guide (the client adds them first); the
 * guide must be a guide (have a `parentTemplateId`); and the recipients are derived here from the
 * template's `templateCreatorId` and `roles/administrator`. Every interpolated value is
 * HTML-escaped.
 */

const { HttpsError } = require('firebase-functions/v2/https')
const { assertProjectAccess } = require('../shared/privacyAccess')
const { escapeHtml } = require('../Utils/oauthCallbackPage')

async function resolveGuideJoinEmailRequest(db, request) {
    const uid = request?.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required')

    const guideId = typeof request.data?.guideId === 'string' ? request.data.guideId.trim() : ''
    if (!guideId) throw new HttpsError('invalid-argument', 'guideId is required')

    try {
        await assertProjectAccess(db, uid, guideId)
    } catch (error) {
        throw new HttpsError('permission-denied', 'No access to this guide')
    }

    const guideDoc = await db.doc(`projects/${guideId}`).get()
    const templateId = guideDoc.exists ? guideDoc.data()?.parentTemplateId : null
    if (typeof templateId !== 'string' || !templateId) {
        throw new HttpsError('failed-precondition', 'Not a guide')
    }

    const [templateDoc, administratorDoc] = await Promise.all([
        db.doc(`projects/${templateId}`).get(),
        db.doc('roles/administrator').get(),
    ])
    const recipients = [templateDoc.exists ? templateDoc.data()?.templateCreatorId : null]
    recipients.push(administratorDoc.exists ? administratorDoc.data()?.userId : null)
    const usersToReceiveEmailIds = [...new Set(recipients.filter(id => typeof id === 'string' && id))]

    return { guideId, newUserId: uid, usersToReceiveEmailIds }
}

function buildNewUserJoinedGuideHtml({ guide, newUser, appUrl, appName }) {
    const projectUrl = `projects/${encodeURIComponent(guide.id)}/user/${encodeURIComponent(newUser.uid)}/tasks/open`
    return `
    <p>
        <b>${escapeHtml(newUser.displayName)}</b> [${escapeHtml(newUser.email)}] has joined a community:
        <br />
        <b>Community name: </b>${escapeHtml(guide.name)}
        <br />
        <b>Community link: </b>${escapeHtml(`${appUrl}${projectUrl}`)}
        <br />
        <b>App deploy: </b>${escapeHtml(appName)}
    </p>
    `
}

module.exports = { resolveGuideJoinEmailRequest, buildNewUserJoinedGuideHtml }
