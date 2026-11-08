'use strict'

/**
 * Binds copyTemplateObjectsSecondGen to the signed-in caller (security audit 2026-11).
 *
 * The callable used to take templateId, creatorId, guideId and userId from the request and copy
 * through the Admin SDK, so any signed-in account could copy another project's open tasks (private
 * ones included) and their notes into a project of its choosing, as anybody. The legitimate caller is
 * the guide join flow (`utils/backends/Projects/guidesFirestore.js`), which adds the logged-in user
 * to the guide and links the guide to its template BEFORE it calls this. So everything can be
 * derived from stored documents:
 *
 * - the acting user is `request.auth.uid`;
 * - the template must be a template the caller can read (member, or not a private project, exactly
 *   the `projects/{id}` read rule a joiner passes to open it);
 * - whose content is copied is the template's own `templateCreatorId`, never a request value;
 * - the guide must have the caller as a member and name this template as `parentTemplateId`;
 * - the global assistants come from the template document.
 */

const { HttpsError } = require('firebase-functions/v2/https')

const PRIVATE_PROJECT = 2
const MAX_NAME_LENGTH = 200
const MAX_URL_LENGTH = 2048
const DAY_MS = 24 * 60 * 60 * 1000

function requireId(value, field) {
    if (typeof value !== 'string' || !value.trim() || value.includes('/')) {
        throw new HttpsError('invalid-argument', `${field} is required`)
    }
    return value.trim()
}

function optionalString(value, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function finiteNumber(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function canReadProject(projectData, uid) {
    const userIds = Array.isArray(projectData.userIds) ? projectData.userIds : []
    if (userIds.includes(uid)) return true
    // Mirrors firestore.rules: a project without isShared counts as private.
    const isShared = projectData.isShared === undefined ? PRIVATE_PROJECT : projectData.isShared
    return isShared !== PRIVATE_PROJECT
}

async function resolveTemplateCopyRequest(db, request, now = Date.now()) {
    const uid = request?.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required')

    const data = request.data || {}
    const templateId = requireId(data.templateId, 'templateId')
    const guideId = requireId(data.guideId, 'guideId')
    if (templateId === guideId) throw new HttpsError('invalid-argument', 'A template cannot be its own guide')

    const [templateDoc, guideDoc, userDoc] = await Promise.all([
        db.doc(`projects/${templateId}`).get(),
        db.doc(`projects/${guideId}`).get(),
        db.doc(`users/${uid}`).get(),
    ])
    if (!userDoc.exists) throw new HttpsError('permission-denied', 'User not found')

    const template = templateDoc.exists ? templateDoc.data() || {} : null
    const creatorId = template && typeof template.templateCreatorId === 'string' ? template.templateCreatorId : ''
    if (!template || template.isTemplate !== true || !creatorId || !canReadProject(template, uid)) {
        throw new HttpsError('permission-denied', 'Not a template you can join')
    }

    const guide = guideDoc.exists ? guideDoc.data() || {} : null
    const guideUserIds = guide && Array.isArray(guide.userIds) ? guide.userIds : []
    if (!guide || guide.parentTemplateId !== templateId || !guideUserIds.includes(uid)) {
        throw new HttpsError('permission-denied', 'Not a guide of this template you belong to')
    }

    const userData = userDoc.data() || {}
    const globalAssistantIds = Array.isArray(template.globalAssistantIds)
        ? template.globalAssistantIds.filter(id => typeof id === 'string' && id)
        : []

    // The client sends its local noon and clock so copied due dates land on the joiner's day. Only
    // accept values within a day of the server clock; they shift dates, nothing else.
    const dateNow = finiteNumber(data.dateNow, now)
    const dateMiddleOfDay = finiteNumber(data.dateMiddleOfDay, now)

    return {
        templateId,
        creatorId,
        guideId,
        userId: uid,
        userName:
            optionalString(userData.displayName, MAX_NAME_LENGTH) || optionalString(data.userName, MAX_NAME_LENGTH),
        userPhotoUrl:
            optionalString(userData.photoURL, MAX_URL_LENGTH) || optionalString(data.userPhotoUrl, MAX_URL_LENGTH),
        dateMiddleOfDay: Math.abs(dateMiddleOfDay - now) <= DAY_MS ? dateMiddleOfDay : now,
        dateNow: Math.abs(dateNow - now) <= DAY_MS ? dateNow : now,
        unlockedTemplate: data.unlockedTemplate === true,
        isNewGuide: data.isNewGuide === true,
        globalAssistantIds,
    }
}

module.exports = { resolveTemplateCopyRequest, canReadProject }
