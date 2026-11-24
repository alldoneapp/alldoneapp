'use strict'

const { getAccessibleProjectIdsFromUserData, filterMemberProjectIds } = require('../shared/privacyAccess')
const { getCalendarEventBounds } = require('../shared/meetingReview/calendarEventCounting')

/**
 * AT-3137 — the calendar tasks behind the meeting time statistics, for the CALLER only.
 *
 * Security (docs/claude/security.md): acts as `request.auth.uid`; the user document only nominates
 * candidate projects, membership is checked on projects/{pid}.userIds; only tasks whose `userId` is
 * the caller (the calendar's owner) are returned, so a shared project never exposes another
 * member's meetings. Ratings and categories are not read here: they are private owner documents
 * the app reads itself (users/{uid}/meetingReviews).
 *
 * Two queries per project:
 *   - the range query on `calendarData.startMs`, written by the sync since AT-3137. It uses the
 *     automatic single-field index (no composite index); the owner filter runs in code
 *   - a bounded legacy one for tasks synced before that, which only carry ISO strings. It reuses
 *     the existing (isPublicFor, inDone, userId, dueDate) index: a calendar task's dueDate is set
 *     on the day it is synced and moved forward by postponing, so open tasks are read from
 *     `from - 7 days` up to today and done ones within ±7 days of the period.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_RANGE_MS = 45 * DAY_MS
const LEGACY_DUE_DATE_MARGIN_MS = 7 * DAY_MS
const MAX_TASKS_PER_QUERY = 1000
const MAX_DESCRIPTION_LENGTH = 500

class MeetingStatsDataError extends Error {
    constructor(code, message) {
        super(message)
        this.code = code
    }
}

const validateRange = ({ fromMs, toMs } = {}) => {
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || !(toMs > fromMs)) {
        throw new MeetingStatsDataError('invalid-argument', 'fromMs and toMs must be numbers with toMs > fromMs')
    }
    if (toMs - fromMs > MAX_RANGE_MS) {
        throw new MeetingStatsDataError('invalid-argument', 'The period may be at most 45 days long')
    }
    return { fromMs, toMs }
}

const pickCalendarData = calendarData => {
    const picked = {}
    ;[
        'start',
        'end',
        'startMs',
        'endMs',
        'isAllDay',
        'recurringEventId',
        'attendeeCount',
        'externalAttendeeCount',
        'selfResponseStatus',
        'status',
        'provider',
        // AT-3145: "meeting-free work time" treats reliably solo work blocks as work time, like
        // "Time to work" (utils/meetingTimeToday.js). Booleans only, nothing personal.
        'soloEvent',
        'workBlock',
    ].forEach(key => {
        if (calendarData[key] !== undefined) picked[key] = calendarData[key]
    })
    return picked
}

const toStatsTask = (doc, projectId) => {
    const data = doc.data() || {}
    return {
        id: doc.id,
        projectId,
        name: typeof data.name === 'string' ? data.name : '',
        description: typeof data.description === 'string' ? data.description.slice(0, MAX_DESCRIPTION_LENGTH) : '',
        done: data.done === true,
        completed: Number.isFinite(data.completed) ? data.completed : null,
        calendarData: pickCalendarData(data.calendarData || {}),
    }
}

const overlapsRange = (calendarData, fromMs, toMs) => {
    const bounds = getCalendarEventBounds(calendarData)
    return !!bounds && bounds.startMs < toMs && bounds.endMs > fromMs
}

async function loadProjectMeetingTasks(db, projectId, userId, fromMs, toMs, nowMs = Date.now()) {
    const tasks = db.collection(`items/${projectId}/tasks`)
    // A range on ONE field only, so Firestore's automatic single-field index serves it and no
    // composite index has to be deployed by hand (ci-cd.md: CI never creates indexes). Other members'
    // calendar tasks of the period may be read here; they are dropped below and never returned.
    const indexed = tasks
        .where('calendarData.startMs', '>=', fromMs - DAY_MS)
        .where('calendarData.startMs', '<', toMs)
        .limit(MAX_TASKS_PER_QUERY)
        .get()
    const legacyBase = () => tasks.where('isPublicFor', 'array-contains', userId).where('userId', '==', userId)
    // Upper bound: an open calendar task postponed (or auto-postponed) sits at most at "today"; the
    // bound keeps backlog tasks (dueDate = MAX_SAFE_INTEGER) and far-future tasks out of the read.
    const legacyOpen = legacyBase()
        .where('inDone', '==', false)
        .where('dueDate', '>=', fromMs - LEGACY_DUE_DATE_MARGIN_MS)
        .where('dueDate', '<', Math.max(toMs, nowMs) + DAY_MS)
        .limit(MAX_TASKS_PER_QUERY)
        .get()
    const legacyDone = legacyBase()
        .where('inDone', '==', true)
        .where('dueDate', '>=', fromMs - LEGACY_DUE_DATE_MARGIN_MS)
        .where('dueDate', '<', toMs + LEGACY_DUE_DATE_MARGIN_MS)
        .limit(MAX_TASKS_PER_QUERY)
        .get()

    const [indexedSnap, ...legacySnaps] = await Promise.all([
        indexed,
        legacyOpen.catch(error => {
            console.warn('[meetingStatsData] legacy open query failed', { projectId, error: error.message })
            return { docs: [] }
        }),
        legacyDone.catch(error => {
            console.warn('[meetingStatsData] legacy done query failed', { projectId, error: error.message })
            return { docs: [] }
        }),
    ])

    const byId = new Map()
    let truncated = indexedSnap.docs.length >= MAX_TASKS_PER_QUERY
    indexedSnap.docs.forEach(doc => {
        const task = toStatsTask(doc, projectId)
        if (doc.data()?.userId !== userId) return
        if (overlapsRange(task.calendarData, fromMs, toMs)) byId.set(task.id, task)
    })
    legacySnaps.forEach(snap => {
        if (snap.docs.length >= MAX_TASKS_PER_QUERY) truncated = true
        snap.docs.forEach(doc => {
            const data = doc.data() || {}
            if (data.userId !== userId || !data.calendarData || typeof data.calendarData !== 'object') return
            // Tasks with numeric bounds were already covered (or excluded) by the indexed query.
            if (Number.isFinite(data.calendarData.startMs)) return
            const task = toStatsTask(doc, projectId)
            if (overlapsRange(task.calendarData, fromMs, toMs)) byId.set(task.id, task)
        })
    })
    return { tasks: [...byId.values()], truncated }
}

async function getMeetingStatsData(db, userId, params) {
    if (!userId) throw new MeetingStatsDataError('unauthenticated', 'User must be authenticated')
    const { fromMs, toMs } = validateRange(params)
    const userSnapshot = await db.collection('users').doc(userId).get()
    if (!userSnapshot.exists) throw new MeetingStatsDataError('not-found', 'User not found')
    const candidateIds = getAccessibleProjectIdsFromUserData(userSnapshot.data() || {})
    const projectIds = await filterMemberProjectIds(db, userId, candidateIds)

    const results = await Promise.all(
        projectIds.map(projectId =>
            loadProjectMeetingTasks(db, projectId, userId, fromMs, toMs).catch(error => {
                console.error('[meetingStatsData] Could not load calendar tasks', { projectId, error: error.message })
                return { tasks: [], truncated: false, failed: true }
            })
        )
    )
    const failedProjectIds = projectIds.filter((projectId, index) => results[index].failed)
    return {
        fromMs,
        toMs,
        tasks: results.flatMap(result => result.tasks),
        truncated: results.some(result => result.truncated),
        // The app says so instead of showing a smaller total as if it were complete.
        failedProjectIds,
    }
}

module.exports = {
    MAX_RANGE_MS,
    MeetingStatsDataError,
    getMeetingStatsData,
    validateRange,
}
