'use strict'

/**
 * OKR writes for assistants and MCP clients (create_okr, update_okr).
 *
 * Project OKRs are personal: each one belongs to one member (`ownerId`) and get_project_okrs only
 * ever returns the caller's own, so these tools create OKRs for the requesting user and refuse to
 * change anybody else's. The document is the one the app writes (utils/backends/OKRs/okrsFirestore.js
 * createOKR / updateOKR); `readerIds` is not written here because the access-projection trigger
 * derives it, exactly as for an OKR created in the app.
 *
 * A revenue OKR (`timeLoggedRevenue`) has no stored current value: it is computed from the hours
 * logged in the period times the owner's hourly rate, so setting a value on it is refused rather
 * than silently overwritten on the next read.
 */

const {
    OKRS_COLLECTION,
    OKR_STATUS_ACTIVE,
    OKR_TYPE_MANUAL,
    OKR_TYPE_TIME_LOGGED_REVENUE,
    FEED_PUBLIC_FOR_ALL,
    calculateOkrProgress,
    getOkrPeriodForCadence,
    mapOKRData,
    normalizeOkrNumber,
    normalizeOkrType,
} = require('../shared/OKRHelper')

const VALID_CADENCES = ['daily', 'weekly', 'monthly', 'quarterly']
const MAX_LABEL_LENGTH = 200
const MAX_UNIT_LENGTH = 30

class OkrToolError extends Error {
    constructor(message, details = {}) {
        super(message)
        this.details = details
    }
}

const fail = (message, details) => {
    throw new OkrToolError(message, details)
}

const hasValue = value => value !== undefined && value !== null

const okrsPath = projectId => `okrs/${projectId}/${OKRS_COLLECTION}`

function cleanText(value, field, maxLength) {
    if (!hasValue(value)) return undefined
    if (typeof value !== 'string') fail(`${field} must be a string.`)
    const text = value.trim()
    if (text.length > maxLength) fail(`${field} is too long (at most ${maxLength} characters).`)
    return text
}

function readNumber(value, field, { min = -Infinity, allowZero = true } = {}) {
    if (!hasValue(value) || value === '') return undefined
    const number = typeof value === 'string' ? Number(value.trim()) : Number(value)
    if (!Number.isFinite(number)) fail(`${field} must be a number.`)
    if (number < min || (!allowZero && number === 0)) {
        fail(`${field} must be ${allowZero ? `at least ${min}` : 'greater than 0'}.`)
    }
    return number
}

function readCadence(value) {
    if (!hasValue(value) || value === '') return undefined
    const cadence = String(value).trim().toLowerCase()
    if (!VALID_CADENCES.includes(cadence)) fail(`cadence must be one of ${VALID_CADENCES.join(', ')}.`)
    return cadence
}

function readType(value) {
    if (!hasValue(value) || value === '') return undefined
    const type = String(value).trim()
    if (![OKR_TYPE_MANUAL, OKR_TYPE_TIME_LOGGED_REVENUE].includes(type)) {
        fail(`type must be "${OKR_TYPE_MANUAL}" or "${OKR_TYPE_TIME_LOGGED_REVENUE}".`)
    }
    return type
}

const normalizeLabel = label =>
    String(label || '')
        .trim()
        .toLowerCase()

async function loadProjectAndUser(db, projectId, userId) {
    if (!projectId) fail('projectId is required.')
    const [projectSnapshot, userSnapshot] = await Promise.all([
        db.doc(`projects/${projectId}`).get(),
        db.doc(`users/${userId}`).get(),
    ])
    const project = projectSnapshot.exists ? { id: projectId, ...projectSnapshot.data() } : null
    if (!project || !Array.isArray(project.userIds) || !project.userIds.includes(userId)) {
        fail('The project does not exist or you are not a member of it.')
    }
    return { project, userData: userSnapshot.exists ? userSnapshot.data() || {} : {} }
}

function summarizeOkr(okr) {
    const mapped = mapOKRData(okr.id, okr)
    return {
        id: mapped.id,
        projectId: mapped.projectId,
        label: mapped.label,
        type: mapped.type,
        currentValue: mapped.type === OKR_TYPE_TIME_LOGGED_REVENUE ? null : mapped.currentValue,
        targetValue: mapped.targetValue,
        unit: mapped.unit,
        progress: mapped.type === OKR_TYPE_TIME_LOGGED_REVENUE ? null : mapped.progress,
        cadence: mapped.cadence,
        periodStart: new Date(mapped.periodStart).toISOString(),
        periodEnd: new Date(mapped.periodEnd).toISOString(),
        status: mapped.status,
        isPrivate: mapped.isPrivate,
    }
}

async function getActiveOwnedOkrs(db, projectId, userId) {
    const snapshot = await db
        .collection(okrsPath(projectId))
        .where('ownerId', '==', userId)
        .where('status', '==', OKR_STATUS_ACTIVE)
        .get()
    return (snapshot?.docs || []).map(doc => ({ id: doc.id, ...doc.data() }))
}

// ---------------------------------------------------------------------------------------------
// create_okr
// ---------------------------------------------------------------------------------------------

async function createOkr({ db, projectId, userId, args = {}, now = Date.now() }) {
    const { userData } = await loadProjectAndUser(db, projectId, userId)

    const label = cleanText(args.label, 'label', MAX_LABEL_LENGTH)
    if (!label) fail('label is required.')
    const targetValue = readNumber(args.targetValue, 'targetValue', { min: 0, allowZero: false })
    if (targetValue === undefined) fail('targetValue is required.')
    const type = readType(args.type) || OKR_TYPE_MANUAL
    const currentValue = readNumber(args.currentValue, 'currentValue', { min: 0 })
    if (type === OKR_TYPE_TIME_LOGGED_REVENUE && currentValue !== undefined) {
        fail('A revenue OKR computes its current value from logged time; leave currentValue out.')
    }
    const unit = cleanText(args.unit, 'unit', MAX_UNIT_LENGTH) || ''
    const cadence = readCadence(args.cadence) || 'monthly'
    const isPrivate = args.isPrivate === true
    const { periodStart, periodEnd } = getOkrPeriodForCadence(cadence, now, userData)

    // An agent retrying a create must not end up with the same OKR twice in one period.
    const duplicate = (await getActiveOwnedOkrs(db, projectId, userId)).find(
        okr => normalizeLabel(okr.label) === normalizeLabel(label) && Number(okr.periodEnd) === periodEnd
    )
    if (duplicate) {
        return {
            success: true,
            alreadyExists: true,
            message: `You already have the OKR "${label}" for this period; nothing was created. Use update_okr to change it.`,
            okr: summarizeOkr(duplicate),
        }
    }

    const ref = db.collection(okrsPath(projectId)).doc()
    const okr = {
        id: ref.id,
        objectType: 'okr',
        type,
        projectId,
        ownerId: userId,
        label,
        currentValue: type === OKR_TYPE_TIME_LOGGED_REVENUE ? 0 : currentValue || 0,
        targetValue,
        unit,
        cadence,
        periodStart,
        periodEnd,
        status: OKR_STATUS_ACTIVE,
        previousOkrId: null,
        created: now,
        creatorId: userId,
        lastEditionDate: now,
        lastEditorId: userId,
        renewalProcessedAt: null,
        isPrivate,
        isPublicFor: isPrivate ? [userId] : [FEED_PUBLIC_FOR_ALL],
    }
    await ref.set(okr)

    return {
        success: true,
        message: `OKR "${label}" created for the current ${cadence} period.`,
        okr: summarizeOkr(okr),
    }
}

// ---------------------------------------------------------------------------------------------
// update_okr
// ---------------------------------------------------------------------------------------------

async function findOwnedOkr(db, projectId, userId, args) {
    const okrId = typeof args.okrId === 'string' ? args.okrId.trim() : ''
    if (okrId) {
        if (okrId.includes('/')) fail('okrId is not valid.')
        const snapshot = await db.doc(`${okrsPath(projectId)}/${okrId}`).get()
        if (!snapshot.exists) fail(`No OKR with id "${okrId}" in this project.`)
        const okr = { id: okrId, ...snapshot.data() }
        if (okr.ownerId !== userId) fail('OKRs are personal; you can only change your own.')
        return okr
    }

    const label = normalizeLabel(args.okrLabel)
    if (!label) fail('okrId or okrLabel is required.')
    const okrs = await getActiveOwnedOkrs(db, projectId, userId)
    const exact = okrs.filter(okr => normalizeLabel(okr.label) === label)
    const matches = exact.length > 0 ? exact : okrs.filter(okr => normalizeLabel(okr.label).includes(label))
    if (matches.length === 1) return matches[0]
    if (matches.length === 0) {
        fail(`No active OKR of yours matches "${args.okrLabel}" in this project. Use get_project_okrs to find it.`)
    }
    fail(`Several of your OKRs match "${args.okrLabel}"; pass okrId instead.`, {
        matches: matches.slice(0, 10).map(okr => ({ id: okr.id, label: okr.label })),
    })
}

async function updateOkr({ db, projectId, userId, args = {}, now = Date.now() }) {
    const { userData } = await loadProjectAndUser(db, projectId, userId)
    const okr = await findOwnedOkr(db, projectId, userId, args)
    const isRevenue = normalizeOkrType(okr.type) === OKR_TYPE_TIME_LOGGED_REVENUE

    const updates = {}
    const changes = []

    const newLabel = cleanText(args.label, 'label', MAX_LABEL_LENGTH)
    if (newLabel !== undefined) {
        if (!newLabel) fail('label must not be empty.')
        if (newLabel !== okr.label) {
            updates.label = newLabel
            changes.push('label')
        }
    }

    const currentValue = readNumber(args.currentValue, 'currentValue', { min: 0 })
    const increment = readNumber(args.addToCurrentValue, 'addToCurrentValue')
    if (currentValue !== undefined && increment !== undefined) {
        fail('Pass either currentValue or addToCurrentValue, not both.')
    }
    if ((currentValue !== undefined || increment !== undefined) && isRevenue) {
        fail('A revenue OKR computes its current value from logged time; it cannot be set.')
    }
    if (currentValue !== undefined || increment !== undefined) {
        const nextValue =
            currentValue !== undefined
                ? currentValue
                : Math.max(0, Number((normalizeOkrNumber(okr.currentValue) + increment).toFixed(4)))
        if (nextValue !== normalizeOkrNumber(okr.currentValue)) {
            updates.currentValue = nextValue
            changes.push('current value')
        }
    }

    const targetValue = readNumber(args.targetValue, 'targetValue', { min: 0, allowZero: false })
    if (targetValue !== undefined && targetValue !== normalizeOkrNumber(okr.targetValue)) {
        updates.targetValue = targetValue
        changes.push('target')
    }

    const unit = cleanText(args.unit, 'unit', MAX_UNIT_LENGTH)
    if (unit !== undefined && unit !== (okr.unit || '')) {
        updates.unit = unit
        changes.push('unit')
    }

    const cadence = readCadence(args.cadence)
    if (cadence !== undefined && cadence !== (okr.cadence || 'monthly')) {
        // Same as the app: a new cadence starts the OKR's current period of that cadence.
        Object.assign(updates, { cadence, ...getOkrPeriodForCadence(cadence, now, userData) })
        changes.push('cadence')
    }

    if (typeof args.isPrivate === 'boolean') {
        const currentlyPrivate = Array.isArray(okr.isPublicFor) && !okr.isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
        if (args.isPrivate !== currentlyPrivate) {
            updates.isPrivate = args.isPrivate
            updates.isPublicFor = args.isPrivate ? [okr.ownerId] : [FEED_PUBLIC_FOR_ALL]
            changes.push(args.isPrivate ? 'made private' : 'made visible to the project')
        }
    } else if (hasValue(args.isPrivate)) {
        fail('isPrivate must be true or false.')
    }

    if (changes.length === 0) {
        return {
            success: true,
            unchanged: true,
            message: `OKR "${okr.label}" already had these values; nothing was written.`,
            okr: summarizeOkr(okr),
        }
    }

    updates.lastEditionDate = now
    updates.lastEditorId = userId
    await db.doc(`${okrsPath(projectId)}/${okr.id}`).update(updates)

    const stored = { ...okr, ...updates }
    const progress = isRevenue ? null : calculateOkrProgress(stored.currentValue, stored.targetValue)
    return {
        success: true,
        message:
            `OKR "${stored.label}" updated (${changes.join(', ')})` +
            (progress === null ? '.' : `; now at ${progress}%.`),
        changes,
        okr: summarizeOkr(stored),
    }
}

module.exports = { OkrToolError, createOkr, updateOkr }
