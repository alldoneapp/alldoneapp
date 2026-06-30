const crypto = require('crypto')
const moment = require('moment-timezone')
const admin = require('firebase-admin')

const {
    DEFAULT_AWAKE_START,
    DEFAULT_AWAKE_END,
    DEFAULT_PROMPT,
    normalizeHeartbeatIntervalMs,
    normalizeHeartbeatTimeMs,
    getEffectiveHeartbeatChancePercent,
    getEffectiveHeartbeatChanceNoReplyPercent,
} = require('./heartbeatSettingsHelper')
const { resolveUserTimezoneOffset, resolveUserTimezoneName } = require('./contextTimestampHelper')

const HEARTBEAT_SCHEDULES_COLLECTION = 'assistantHeartbeatSchedules'
const ACTIVE_USER_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const END_MINUTE_GRACE_MS = 60 * 1000 - 1
const WRITE_BATCH_SIZE = 400

function sha256(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function getHeartbeatScheduleId(projectId, assistantId, userId) {
    return sha256(`${projectId}|${assistantId}|${userId}`)
}

function getHeartbeatDispatchTaskId(scheduleId, scheduleHash, dueAt) {
    return `hb-${sha256(`${scheduleId}|${scheduleHash}|${dueAt}`)}`
}

function getStableOffset(seed, rangeMs) {
    const normalizedRange = Math.max(1, Math.floor(Number(rangeMs) || 1))
    const stableInteger = Number.parseInt(sha256(seed).slice(0, 12), 16)
    return stableInteger % normalizedRange
}

function getTimestampMillis(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (value instanceof Date) return value.getTime()
    if (value && typeof value.toMillis === 'function') return value.toMillis()
    if (value && typeof value.seconds === 'number') return value.seconds * 1000
    return 0
}

function getHeartbeatScheduleTiming(assistant = {}, userData = {}) {
    const timezoneName = resolveUserTimezoneName(userData)
    const resolvedOffset = resolveUserTimezoneOffset(userData)
    const timezoneOffsetMinutes = typeof resolvedOffset === 'number' ? resolvedOffset : 0

    const timing = {
        intervalMs: normalizeHeartbeatIntervalMs(assistant.heartbeatIntervalMs),
        awakeStartMs: normalizeHeartbeatTimeMs(assistant.heartbeatAwakeStart, DEFAULT_AWAKE_START),
        awakeEndMs: normalizeHeartbeatTimeMs(assistant.heartbeatAwakeEnd, DEFAULT_AWAKE_END),
        timezoneName: timezoneName || null,
        timezoneOffsetMinutes,
    }

    timing.scheduleHash = sha256(JSON.stringify(timing))
    return timing
}

function getLocalMoment(timestamp, timing) {
    if (timing.timezoneName && moment.tz.zone(timing.timezoneName)) {
        return moment(timestamp).tz(timing.timezoneName)
    }
    return moment.utc(timestamp).utcOffset(Number(timing.timezoneOffsetMinutes) || 0)
}

function getWallClockMoment(dayMoment, timeMs, timing) {
    const totalMinutes = Math.floor(timeMs / (60 * 1000))
    const hour = Math.floor(totalMinutes / 60)
    const minute = totalMinutes % 60
    const values = [dayMoment.year(), dayMoment.month(), dayMoment.date(), hour, minute, 0, 0]

    if (timing.timezoneName && moment.tz.zone(timing.timezoneName)) {
        return moment.tz(values, timing.timezoneName)
    }

    return moment.utc(values).utcOffset(Number(timing.timezoneOffsetMinutes) || 0, true)
}

function getAwakeWindowForLocalDay(dayMoment, timing) {
    const dayStart = dayMoment.clone().startOf('day')
    const start = getWallClockMoment(dayStart, timing.awakeStartMs, timing)
    let endDay = dayStart

    if (timing.awakeEndMs < timing.awakeStartMs) {
        endDay = dayStart.clone().add(1, 'day')
    }

    const end = getWallClockMoment(endDay, timing.awakeEndMs, timing).add(END_MINUTE_GRACE_MS, 'ms')
    return { start: start.valueOf(), end: end.valueOf() }
}

function isTimestampInHeartbeatAwakeWindow(timestamp, timing) {
    const local = getLocalMoment(timestamp, timing)
    const currentMs = (local.hours() * 60 + local.minutes()) * 60 * 1000
    if (timing.awakeStartMs <= timing.awakeEndMs) {
        return currentMs >= timing.awakeStartMs && currentMs <= timing.awakeEndMs
    }
    return currentMs >= timing.awakeStartMs || currentMs <= timing.awakeEndMs
}

/**
 * Return the first personalized heartbeat time strictly after afterMs.
 * The phase is relative to each local awake window, which prevents all users
 * becoming overdue together when an awake window opens.
 */
function calculateNextHeartbeatAt({ afterMs, scheduleId, ...timing }) {
    const normalizedAfter = Number(afterMs) || Date.now()
    const localAfter = getLocalMoment(normalizedAfter, timing)

    // Include yesterday so an overnight window that began yesterday remains eligible.
    for (let dayOffset = -1; dayOffset <= 4; dayOffset++) {
        const localDay = localAfter.clone().startOf('day').add(dayOffset, 'day')
        const window = getAwakeWindowForLocalDay(localDay, timing)
        if (window.end <= normalizedAfter) continue

        const windowDuration = Math.max(1, window.end - window.start + 1)
        const phaseRange = Math.min(timing.intervalMs, windowDuration)
        const phaseMs = getStableOffset(scheduleId, phaseRange)
        let candidate = window.start + phaseMs

        if (candidate <= normalizedAfter) {
            const intervalsElapsed = Math.floor((normalizedAfter - candidate) / timing.intervalMs) + 1
            candidate += intervalsElapsed * timing.intervalMs
        }

        if (candidate <= window.end) return candidate
    }

    // Supported intervals are at most one hour, so the loop above should always
    // find a candidate. Retain a defensive fallback rather than disabling a user.
    return normalizedAfter + Math.min(timing.intervalMs || DAY_MS, DAY_MS)
}

function isProjectHeartbeatEligible(project = {}) {
    return project.active !== false && project.isTemplate !== true && !project.parentTemplateId
}

function isUserHeartbeatEligible(userData = {}, now = Date.now()) {
    return getTimestampMillis(userData.lastLogin) >= now - ACTIVE_USER_WINDOW_MS
}

function isAssistantHeartbeatEligible(assistant = {}, projectId, userData) {
    const prompt = assistant.heartbeatPrompt ?? DEFAULT_PROMPT
    if (typeof prompt !== 'string' || !prompt.trim()) return false

    const repliedChance = getEffectiveHeartbeatChancePercent(assistant, projectId, userData)
    const noReplyChance = getEffectiveHeartbeatChanceNoReplyPercent(assistant, projectId, userData)
    return repliedChance > 0 || noReplyChance > 0
}

function buildHeartbeatScheduleData({ projectId, assistant, userId, userData, existingData = null, now = Date.now() }) {
    if (!assistant?.uid || !userId) return null
    if (!isUserHeartbeatEligible(userData, now)) return null
    if (!isAssistantHeartbeatEligible(assistant, projectId, userData)) return null

    const scheduleId = getHeartbeatScheduleId(projectId, assistant.uid, userId)
    const timing = getHeartbeatScheduleTiming(assistant, userData)
    const existingNextAt = getTimestampMillis(existingData?.nextHeartbeatAt)
    // Preserve one overdue occurrence so the dispatcher can enqueue it. It will
    // advance from "now" afterward, so missed intervals never form a backlog.
    const preserveExistingTime = existingData?.scheduleHash === timing.scheduleHash && existingNextAt > 0
    const lastExecuted = getTimestampMillis(assistant.heartbeatLastExecutedByUser?.[userId])
    const earliestAfter = Math.max(now, lastExecuted ? lastExecuted + timing.intervalMs - 1 : now)
    const nextHeartbeatAt = preserveExistingTime
        ? existingNextAt
        : calculateNextHeartbeatAt({ afterMs: earliestAfter, scheduleId, ...timing })

    return {
        projectId,
        assistantId: assistant.uid,
        userId,
        nextHeartbeatAt,
        intervalMs: timing.intervalMs,
        awakeStartMs: timing.awakeStartMs,
        awakeEndMs: timing.awakeEndMs,
        timezoneName: timing.timezoneName,
        timezoneOffsetMinutes: timing.timezoneOffsetMinutes,
        scheduleHash: timing.scheduleHash,
        createdAt: existingData?.createdAt || now,
        updatedAt: now,
    }
}

async function getDocuments(db, refs) {
    const documents = []
    for (let index = 0; index < refs.length; index += 100) {
        const chunk = refs.slice(index, index + 100)
        if (typeof db.getAll === 'function') {
            documents.push(...(await db.getAll(...chunk)))
        } else {
            documents.push(...(await Promise.all(chunk.map(ref => ref.get()))))
        }
    }
    return documents
}

async function commitOperations(db, operations) {
    for (let index = 0; index < operations.length; index += WRITE_BATCH_SIZE) {
        const batch = db.batch()
        operations.slice(index, index + WRITE_BATCH_SIZE).forEach(operation => {
            if (operation.type === 'delete') batch.delete(operation.ref)
            else batch.set(operation.ref, operation.data, { merge: true })
        })
        await batch.commit()
    }
}

async function safelySyncHeartbeatSchedules(operation, context = {}) {
    try {
        return await operation()
    } catch (error) {
        console.error('Heartbeat schedule synchronization failed; daily reconciliation will retry', {
            ...context,
            error: error.message,
        })
        return { error: error.message }
    }
}

async function syncHeartbeatSchedulesForProject(
    projectId,
    { db = admin.firestore(), projectData = null, now = Date.now(), dryRun = false } = {}
) {
    const projectDoc = projectData ? null : await db.doc(`projects/${projectId}`).get()
    const project = projectData || (projectDoc?.exists ? { ...projectDoc.data(), id: projectId } : null)
    const existingSnapshot = await db
        .collection(HEARTBEAT_SCHEDULES_COLLECTION)
        .where('projectId', '==', projectId)
        .get()
    const existingById = new Map(existingSnapshot.docs.map(doc => [doc.id, doc]))

    if (!project || !isProjectHeartbeatEligible(project)) {
        if (!dryRun) {
            await commitOperations(
                db,
                existingSnapshot.docs.map(doc => ({ type: 'delete', ref: doc.ref }))
            )
        }
        return { upserted: 0, deleted: existingSnapshot.size || existingSnapshot.docs.length, validScheduleIds: [] }
    }

    const memberIds = Array.isArray(project.userIds) ? [...new Set(project.userIds.filter(Boolean))] : []
    const [assistantsSnapshot, userDocs] = await Promise.all([
        db.collection(`assistants/${projectId}/items`).get(),
        getDocuments(
            db,
            memberIds.map(userId => db.doc(`users/${userId}`))
        ),
    ])
    const usersById = new Map(userDocs.filter(doc => doc.exists).map(doc => [doc.id, { ...doc.data(), id: doc.id }]))
    const operations = []
    const validScheduleIds = new Set()

    for (const assistantDoc of assistantsSnapshot.docs) {
        const assistant = { ...assistantDoc.data(), uid: assistantDoc.id }
        for (const userId of memberIds) {
            const userData = usersById.get(userId)
            if (!userData) continue
            const scheduleId = getHeartbeatScheduleId(projectId, assistant.uid, userId)
            const existingData = existingById.get(scheduleId)?.data() || null
            const data = buildHeartbeatScheduleData({
                projectId,
                assistant,
                userId,
                userData,
                existingData,
                now,
            })
            if (!data) continue
            validScheduleIds.add(scheduleId)
            operations.push({
                type: 'set',
                ref: db.doc(`${HEARTBEAT_SCHEDULES_COLLECTION}/${scheduleId}`),
                data,
            })
        }
    }

    existingSnapshot.docs.forEach(doc => {
        if (!validScheduleIds.has(doc.id)) operations.push({ type: 'delete', ref: doc.ref })
    })
    if (!dryRun) await commitOperations(db, operations)

    return {
        upserted: validScheduleIds.size,
        deleted: existingSnapshot.docs.filter(doc => !validScheduleIds.has(doc.id)).length,
        validScheduleIds: Array.from(validScheduleIds),
    }
}

async function syncHeartbeatSchedulesForAssistant(
    projectId,
    assistantId,
    { db = admin.firestore(), now = Date.now() } = {}
) {
    const [projectDoc, assistantDoc, existingSnapshot] = await Promise.all([
        db.doc(`projects/${projectId}`).get(),
        db.doc(`assistants/${projectId}/items/${assistantId}`).get(),
        db
            .collection(HEARTBEAT_SCHEDULES_COLLECTION)
            .where('projectId', '==', projectId)
            .where('assistantId', '==', assistantId)
            .get(),
    ])
    const project = projectDoc.exists ? { ...projectDoc.data(), id: projectId } : null
    const assistant = assistantDoc.exists ? { ...assistantDoc.data(), uid: assistantId } : null
    const existingById = new Map(existingSnapshot.docs.map(doc => [doc.id, doc]))

    if (!project || !assistant || !isProjectHeartbeatEligible(project)) {
        await commitOperations(
            db,
            existingSnapshot.docs.map(doc => ({ type: 'delete', ref: doc.ref }))
        )
        return { upserted: 0, deleted: existingSnapshot.docs.length }
    }

    const memberIds = Array.isArray(project.userIds) ? [...new Set(project.userIds.filter(Boolean))] : []
    const userDocs = await getDocuments(
        db,
        memberIds.map(userId => db.doc(`users/${userId}`))
    )
    const operations = []
    const validScheduleIds = new Set()

    userDocs
        .filter(doc => doc.exists)
        .forEach(userDoc => {
            const userId = userDoc.id
            const scheduleId = getHeartbeatScheduleId(projectId, assistantId, userId)
            const data = buildHeartbeatScheduleData({
                projectId,
                assistant,
                userId,
                userData: { ...userDoc.data(), id: userId },
                existingData: existingById.get(scheduleId)?.data() || null,
                now,
            })
            if (!data) return
            validScheduleIds.add(scheduleId)
            operations.push({
                type: 'set',
                ref: db.doc(`${HEARTBEAT_SCHEDULES_COLLECTION}/${scheduleId}`),
                data,
            })
        })
    existingSnapshot.docs.forEach(doc => {
        if (!validScheduleIds.has(doc.id)) operations.push({ type: 'delete', ref: doc.ref })
    })
    await commitOperations(db, operations)
    return {
        upserted: validScheduleIds.size,
        deleted: existingSnapshot.docs.filter(doc => !validScheduleIds.has(doc.id)).length,
    }
}

async function syncHeartbeatSchedulesForUser(userId, { db = admin.firestore(), now = Date.now() } = {}) {
    const [userDoc, projectsSnapshot, existingSnapshot] = await Promise.all([
        db.doc(`users/${userId}`).get(),
        db.collection('projects').where('userIds', 'array-contains', userId).get(),
        db.collection(HEARTBEAT_SCHEDULES_COLLECTION).where('userId', '==', userId).get(),
    ])
    const userData = userDoc.exists ? { ...userDoc.data(), id: userId } : null
    const existingById = new Map(existingSnapshot.docs.map(doc => [doc.id, doc]))
    const operations = []
    const validScheduleIds = new Set()

    if (userData && isUserHeartbeatEligible(userData, now)) {
        for (const projectDoc of projectsSnapshot.docs) {
            const projectId = projectDoc.id
            const project = { ...projectDoc.data(), id: projectId }
            if (!isProjectHeartbeatEligible(project)) continue
            const assistantsSnapshot = await db.collection(`assistants/${projectId}/items`).get()
            assistantsSnapshot.docs.forEach(assistantDoc => {
                const assistant = { ...assistantDoc.data(), uid: assistantDoc.id }
                const scheduleId = getHeartbeatScheduleId(projectId, assistant.uid, userId)
                const data = buildHeartbeatScheduleData({
                    projectId,
                    assistant,
                    userId,
                    userData,
                    existingData: existingById.get(scheduleId)?.data() || null,
                    now,
                })
                if (!data) return
                validScheduleIds.add(scheduleId)
                operations.push({
                    type: 'set',
                    ref: db.doc(`${HEARTBEAT_SCHEDULES_COLLECTION}/${scheduleId}`),
                    data,
                })
            })
        }
    }

    existingSnapshot.docs.forEach(doc => {
        if (!validScheduleIds.has(doc.id)) operations.push({ type: 'delete', ref: doc.ref })
    })
    await commitOperations(db, operations)
    return {
        upserted: validScheduleIds.size,
        deleted: existingSnapshot.docs.filter(doc => !validScheduleIds.has(doc.id)).length,
    }
}

async function deleteHeartbeatSchedulesForProject(projectId, { db = admin.firestore() } = {}) {
    const snapshot = await db.collection(HEARTBEAT_SCHEDULES_COLLECTION).where('projectId', '==', projectId).get()
    await commitOperations(
        db,
        snapshot.docs.map(doc => ({ type: 'delete', ref: doc.ref }))
    )
    return snapshot.docs.length
}

async function deleteHeartbeatSchedulesForAssistant(projectId, assistantId, { db = admin.firestore() } = {}) {
    const snapshot = await db
        .collection(HEARTBEAT_SCHEDULES_COLLECTION)
        .where('projectId', '==', projectId)
        .where('assistantId', '==', assistantId)
        .get()
    await commitOperations(
        db,
        snapshot.docs.map(doc => ({ type: 'delete', ref: doc.ref }))
    )
    return snapshot.docs.length
}

async function deleteHeartbeatSchedulesForUser(userId, { db = admin.firestore() } = {}) {
    const snapshot = await db.collection(HEARTBEAT_SCHEDULES_COLLECTION).where('userId', '==', userId).get()
    await commitOperations(
        db,
        snapshot.docs.map(doc => ({ type: 'delete', ref: doc.ref }))
    )
    return snapshot.docs.length
}

async function reconcileAllHeartbeatSchedules({ db = admin.firestore(), now = Date.now(), dryRun = false } = {}) {
    const projectsSnapshot = await db.collection('projects').get()
    const knownProjectIds = new Set(projectsSnapshot.docs.map(doc => doc.id))
    let upserted = 0
    let deleted = 0

    for (const projectDoc of projectsSnapshot.docs) {
        const result = await syncHeartbeatSchedulesForProject(projectDoc.id, {
            db,
            projectData: { ...projectDoc.data(), id: projectDoc.id },
            now,
            dryRun,
        })
        upserted += result.upserted
        deleted += result.deleted
    }

    const schedulesSnapshot = await db.collection(HEARTBEAT_SCHEDULES_COLLECTION).get()
    const orphaned = schedulesSnapshot.docs.filter(doc => !knownProjectIds.has(doc.data()?.projectId))
    if (!dryRun) {
        await commitOperations(
            db,
            orphaned.map(doc => ({ type: 'delete', ref: doc.ref }))
        )
    }
    deleted += orphaned.length

    return { projects: projectsSnapshot.docs.length, upserted, deleted }
}

module.exports = {
    HEARTBEAT_SCHEDULES_COLLECTION,
    ACTIVE_USER_WINDOW_MS,
    getTimestampMillis,
    getHeartbeatScheduleId,
    getHeartbeatDispatchTaskId,
    getHeartbeatScheduleTiming,
    isTimestampInHeartbeatAwakeWindow,
    calculateNextHeartbeatAt,
    isProjectHeartbeatEligible,
    isUserHeartbeatEligible,
    isAssistantHeartbeatEligible,
    buildHeartbeatScheduleData,
    safelySyncHeartbeatSchedules,
    syncHeartbeatSchedulesForProject,
    syncHeartbeatSchedulesForAssistant,
    syncHeartbeatSchedulesForUser,
    deleteHeartbeatSchedulesForProject,
    deleteHeartbeatSchedulesForAssistant,
    deleteHeartbeatSchedulesForUser,
    reconcileAllHeartbeatSchedules,
}
