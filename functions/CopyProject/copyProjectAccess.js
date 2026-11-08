'use strict'

/**
 * Binds onCopyProjectSecondGen to the signed-in caller (security audit 2026-11).
 *
 * The callable used to copy any project id it was given, as whichever `user` object the request
 * carried, through the Admin SDK. A non-member could therefore duplicate a Private project into a
 * project of their own, or make a third user the owner of a copy. The only legitimate caller is the
 * Copy project modal in the project's own properties (`duplicateProject` in
 * `utils/backends/firestore.js`), which a member opens, so the caller must be a member of the source
 * project and owns the copy; the owner record is the caller's own user document.
 */

const { HttpsError } = require('firebase-functions/v2/https')
const {
    COPY_PROJECT_TASKS,
    COPY_PROJECT_GOALS,
    COPY_PROJECT_NOTES,
    COPY_PROJECT_CONTACTS,
    COPY_PROJECT_WORKSTREAMS,
} = require('./HelperFunctions')

const KNOWN_OPTIONS = new Set([
    COPY_PROJECT_TASKS,
    COPY_PROJECT_GOALS,
    COPY_PROJECT_NOTES,
    COPY_PROJECT_CONTACTS,
    COPY_PROJECT_WORKSTREAMS,
])

async function resolveCopyProjectRequest(db, request) {
    const uid = request?.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required')

    const data = request.data || {}
    const projectId = typeof data.projectId === 'string' ? data.projectId.trim() : ''
    if (!projectId || projectId.includes('/')) throw new HttpsError('invalid-argument', 'projectId is required')

    const [userDoc, projectDoc] = await Promise.all([
        db.doc(`users/${uid}`).get(),
        db.doc(`projects/${projectId}`).get(),
    ])
    if (!userDoc.exists) throw new HttpsError('permission-denied', 'User not found')
    const projectUserIds =
        projectDoc.exists && Array.isArray(projectDoc.data()?.userIds) ? projectDoc.data().userIds : []
    if (!projectUserIds.includes(uid)) throw new HttpsError('permission-denied', 'No access to project')

    const options = Array.isArray(data.options) ? [...new Set(data.options.filter(o => KNOWN_OPTIONS.has(o)))] : []

    // The request's `user` is ignored: the copy belongs to the caller, and the confirmation email
    // goes to the caller's own stored address.
    return { projectId, user: { ...(userDoc.data() || {}), uid }, options }
}

module.exports = { resolveCopyProjectRequest }
