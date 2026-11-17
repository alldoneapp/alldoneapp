'use strict'

// POST /api/roadmap/source (hosting rewrite → roadmapSource, europe-west1)
//
// The Roadmap Creator on alldone.team shows an Alldone project's goals, milestones and OKRs
// read-only. Inside alldone.app the embed window pushes that snapshot over postMessage
// (utils/roadmapSourceBridge.js). On alldone.team itself there is no alldone.app page, so
// alldone.team's Functions ask this endpoint for the alldone.app account that is linked to the
// alldone.team account (its billingAccount). No user token: the call is signed like the Gold
// webhook (alldoneTeamSignature.js), so only alldone.team's servers can make it.
//
// Body: { action: 'projects' | 'snapshot', account: { appAccountId?, email? }, projectId? }
//   projects → { success: true, projects: [{ id, name, color }] }
//   snapshot → { success: true, snapshot: { project: { id, name, color, focusAreas }, goals, milestones, okrs } }
// Errors: { success: false, error: CODE } — see ERRORS.
//
// The snapshot is the bridge's, built from the same normalizers (roadmapSourceModel.js) and read
// once with the Admin SDK instead of listeners: the same project, goals, milestones and OKRs the
// account would see, including the revenue it logged for time-based OKRs.

const admin = require('firebase-admin')
const moment = require('moment-timezone')

const { getEnvFunctions } = require('../envFunctionsHelper')
const { getAlldoneTeamSigningSecrets, verifyWebhookSignature } = require('../MenubarApp/alldoneTeamSignature')
const { findUserIdByVerifiedEmail } = require('../shared/verifiedAccountEmail')
const { isProjectMemberData } = require('../shared/privacyAccess')
const { mapGoalData, mapMilestoneData, mapProjectData } = require('../Utils/MapDataFuncions')
const {
    FEED_PUBLIC_FOR_ALL,
    calculateOkrPace,
    calculateRevenueOkrCurrentValue,
    getOkrIsPublicFor,
    isRevenueOkr,
    mapOKRData,
    normalizeOkrNumber,
} = require('../shared/OKRHelper')
const {
    ALL_USERS,
    getActiveRoadmapProjects,
    normalizeRoadmapGoal,
    normalizeRoadmapMilestone,
    normalizeRoadmapOkr,
    normalizeRoadmapProject,
} = require('./roadmapSourceModel')

const ACTIONS = ['projects', 'snapshot']
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const MAX_EMAIL_LENGTH = 320

const ERRORS = {
    METHOD_NOT_ALLOWED: 405,
    SIGNING_NOT_CONFIGURED: 503,
    INVALID_SIGNATURE: 401,
    INVALID_ACTION: 400,
    INVALID_ACCOUNT: 400,
    INVALID_PROJECT_ID: 400,
    ACCOUNT_NOT_FOUND: 404,
    PROJECT_NOT_FOUND: 404,
    NOT_A_MEMBER: 403,
    INTERNAL_ERROR: 500,
}

function sendError(res, code) {
    res.status(ERRORS[code]).json({ success: false, error: code })
}

function isValidId(value) {
    return typeof value === 'string' && ID_PATTERN.test(value)
}

function readAccountRef(account) {
    if (!account || typeof account !== 'object' || Array.isArray(account)) return null
    const appAccountId = isValidId(account.appAccountId) ? account.appAccountId : ''
    const email =
        typeof account.email === 'string' && account.email.trim() && account.email.length <= MAX_EMAIL_LENGTH
            ? account.email.trim()
            : ''
    return appAccountId || email ? { appAccountId, email } : null
}

// The alldone.app account: by its user id (what /api/menubar/session returns as accountId), else
// by the verified login email in Firebase Auth. Never by the email field of a users document,
// which an account writes itself.
async function findAccount(db, { appAccountId, email }, findUserIdByEmail) {
    if (appAccountId) {
        const userDoc = await db.doc(`users/${appAccountId}`).get()
        if (userDoc.exists) return { userId: userDoc.id, userData: userDoc.data() || {} }
    }
    if (email) {
        const userId = await findUserIdByEmail(email)
        if (userId) {
            const userDoc = await db.doc(`users/${userId}`).get()
            if (userDoc.exists) return { userId: userDoc.id, userData: userDoc.data() || {} }
        }
    }
    return null
}

async function readRoadmapProjects(db, userId, userData) {
    const projectIds = [...new Set((Array.isArray(userData.projectIds) ? userData.projectIds : []).filter(isValidId))]
    if (projectIds.length === 0) return []

    const projectDocs = await db.getAll(...projectIds.map(projectId => db.doc(`projects/${projectId}`)))
    const projects = projectDocs
        .filter(doc => doc.exists && isProjectMemberData(doc.data(), userId))
        .map(doc => mapProjectData(doc.id, doc.data()))
    return getActiveRoadmapProjects(projects, userData)
}

function canUserSeeOkr(okr, userId) {
    const isPublicFor = getOkrIsPublicFor(okr)
    return (
        isPublicFor.includes(FEED_PUBLIC_FOR_ALL) ||
        okr.ownerId === userId ||
        okr.creatorId === userId ||
        isPublicFor.includes(userId)
    )
}

// Same rule as the web app's calculateOkrPace, which reads a revenue OKR's resolved value.
function paceStatusOf(okr) {
    const currentValue = isRevenueOkr(okr) ? okr.resolvedCurrentValue : okr.currentValue
    return calculateOkrPace({ ...okr, currentValue }).status
}

// Minutes from an hour offset (|value| <= 16) or a minute offset, like the web app's
// normalizeOkrTimezoneOffset.
function timezoneOffsetMinutes(value) {
    if (value === undefined || value === null || value === '') return null
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return null
        return Math.abs(value) <= 16 ? value * 60 : value
    }
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    const numeric = Number(trimmed)
    if (trimmed && Number.isFinite(numeric)) return timezoneOffsetMinutes(numeric)
    const match = trimmed.match(/^(?:UTC|GMT)?([+-])(\d{1,2})(?::?(\d{2}))?$/i)
    if (!match) return null
    return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] || 0))
}

// The day keys of the user's statistics. In the app the browser's zone decides; here the zone the
// account stored (named zone first, then offset, as getOkrUserTimezone), else UTC.
function statisticsDayKey(timestamp, userData = {}) {
    const zoneName = [userData.timezoneName, userData.preferredTimezone, userData.timeZone, userData.timezone].find(
        value => typeof value === 'string' && moment.tz.zone(value)
    )
    if (zoneName) return Number(moment(timestamp).tz(zoneName).format('YYYYMMDD'))

    const offset = timezoneOffsetMinutes(userData.timezone ?? userData.timezoneOffset ?? userData.timezoneMinutes)
    const date = offset === null ? moment.utc(timestamp) : moment.utc(timestamp).utcOffset(offset)
    return Number(date.format('YYYYMMDD'))
}

async function readRevenueValue(db, { projectId, userId, userData, project, okr }) {
    try {
        const snapshot = await db
            .collection(`statistics/${projectId}/${userId}`)
            .where('day', '>=', statisticsDayKey(okr.periodStart, userData))
            .where('day', '<=', statisticsDayKey(okr.periodEnd, userData))
            .get()
        let doneTimeMinutes = 0
        snapshot.forEach(doc => {
            doneTimeMinutes += normalizeOkrNumber(doc.data()?.doneTime)
        })
        const hourlyRate = normalizeOkrNumber(project.hourlyRatesData?.hourlyRates?.[userId])
        return calculateRevenueOkrCurrentValue(doneTimeMinutes, hourlyRate)
    } catch (error) {
        // The bridge shows 0 when the statistics cannot be read; so does this.
        console.error('roadmapSource: revenue OKR statistics failed', { projectId, okrId: okr.id, error })
        return 0
    }
}

// One read of what subscribeToRoadmapProject listens to. Returns { error } or { snapshot }.
async function readRoadmapSnapshot(db, { projectId, userId, userData }) {
    const projectDoc = await db.doc(`projects/${projectId}`).get()
    if (!projectDoc.exists) return { error: 'PROJECT_NOT_FOUND' }
    if (!isProjectMemberData(projectDoc.data(), userId)) return { error: 'NOT_A_MEMBER' }

    const project = mapProjectData(projectDoc.id, projectDoc.data())
    const [goalsSnapshot, milestonesSnapshot, okrsSnapshot] = await Promise.all([
        db
            .collection(`goals/${projectId}/items`)
            .where('readerIds', 'array-contains', userId)
            .where('ownerId', '==', ALL_USERS)
            .get(),
        db
            .collection(`goalsMilestones/${projectId}/milestonesItems`)
            .where('ownerId', '==', ALL_USERS)
            .orderBy('date', 'asc')
            .get(),
        db
            .collection(`okrs/${projectId}/projectOkrs`)
            .where('readerIds', 'array-contains', userId)
            .where('ownerId', '==', userId)
            .get(),
    ])

    const goals = goalsSnapshot.docs.map(doc => normalizeRoadmapGoal(mapGoalData(doc.id, doc.data())))
    const milestones = milestonesSnapshot.docs.map(doc =>
        normalizeRoadmapMilestone(mapMilestoneData(doc.id, doc.data()))
    )
    const rawOkrs = okrsSnapshot.docs
        .map(doc => mapOKRData(doc.id, doc.data()))
        .filter(okr => canUserSeeOkr(okr, userId))
    const okrs = await Promise.all(
        rawOkrs.map(async okr => {
            const resolvedCurrentValue = isRevenueOkr(okr)
                ? await readRevenueValue(db, { projectId, userId, userData, project, okr })
                : okr.currentValue
            return normalizeRoadmapOkr(okr, resolvedCurrentValue, paceStatusOf)
        })
    )

    return { snapshot: { project: normalizeRoadmapProject(project), goals, milestones, okrs } }
}

function defaultDeps() {
    return {
        db: admin.firestore(),
        env: getEnvFunctions(),
        findUserIdByEmail: email => findUserIdByVerifiedEmail(email),
    }
}

async function handleRoadmapSource(req, res, deps = null) {
    res.set('Cache-Control', 'no-store')

    if (req.method !== 'POST') {
        sendError(res, 'METHOD_NOT_ALLOWED')
        return
    }

    const { db, env, findUserIdByEmail } = deps || defaultDeps()

    const candidateSecrets = getAlldoneTeamSigningSecrets(env)
    if (candidateSecrets.length === 0) {
        console.error('roadmapSource: no signing secret configured')
        sendError(res, 'SIGNING_NOT_CONFIGURED')
        return
    }

    const signatureCheck = verifyWebhookSignature(req, candidateSecrets, 'roadmapSource')
    if (!signatureCheck.valid) {
        console.warn('roadmapSource: signature rejected', { reason: signatureCheck.error })
        sendError(res, 'INVALID_SIGNATURE')
        return
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {}
    if (!ACTIONS.includes(body.action)) {
        sendError(res, 'INVALID_ACTION')
        return
    }
    const accountRef = readAccountRef(body.account)
    if (!accountRef) {
        sendError(res, 'INVALID_ACCOUNT')
        return
    }
    if (body.action === 'snapshot' && !isValidId(body.projectId)) {
        sendError(res, 'INVALID_PROJECT_ID')
        return
    }

    try {
        const account = await findAccount(db, accountRef, findUserIdByEmail)
        if (!account) {
            sendError(res, 'ACCOUNT_NOT_FOUND')
            return
        }

        if (body.action === 'projects') {
            const projects = await readRoadmapProjects(db, account.userId, account.userData)
            res.status(200).json({ success: true, projects })
            return
        }

        const result = await readRoadmapSnapshot(db, { projectId: body.projectId, ...account })
        if (result.error) {
            sendError(res, result.error)
            return
        }
        res.status(200).json({ success: true, snapshot: result.snapshot })
    } catch (error) {
        console.error('roadmapSource: request failed', { action: body.action, error })
        sendError(res, 'INTERNAL_ERROR')
    }
}

module.exports = {
    handleRoadmapSource,
    __private__: {
        findAccount,
        readRoadmapProjects,
        readRoadmapSnapshot,
        statisticsDayKey,
    },
}
