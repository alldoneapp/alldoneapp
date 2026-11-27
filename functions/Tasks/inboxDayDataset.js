'use strict'

const admin = require('firebase-admin')
const moment = require('moment-timezone')

const { BACKLOG_DATE_NUMERIC, OPEN_STEP } = require('../Utils/HelperFunctionsCloud')

/**
 * Daily inbox dataset (AT-3167): what was on a user's Today, what they moved off it during the day and what
 * became of every task, so that the morning clean-up (100+ tasks, most of them postponed) can later
 * be learned and automated. Nothing here changes a task; it only records.
 *
 *   users/{uid}/inboxDays/{YYYY-MM-DD}
 *       The Today list at the start of the user's local day (`tasks`), taken by the hourly
 *       auto-postpone schedule on its first run of that day, after the nightly auto-postpone.
 *       The next local day the same run closes it: every entry gets its `outcome`, and tasks that
 *       came onto Today later are listed in `addedTasks`.
 *   users/{uid}/inboxDays/{YYYY-MM-DD}/events/{eventId}
 *       One document per move off Today, from any path (swipe, date picker, auto-postpone, project
 *       or goal postpone, "Plan my day", assistants), written by the task update trigger.
 *
 * Both are server-owned and owner-readable (`isServerOwnedUserCollection` in firestore.rules).
 * Task keys are `${projectId}:${taskId}`, the same keys as `users/{uid}/dailyPlans/{YYYY-MM-DD}`,
 * so a day's plan (Anna's proposal and the user's choice) joins its inbox day directly.
 */

const INBOX_DAYS_COLLECTION = 'inboxDays'
const INBOX_DAY_SCHEMA_VERSION = 1
const MAX_INBOX_DAY_TASKS = 500
const MAX_TASK_NAME_LENGTH = 200

const OUTCOME_DONE = 'done'
const OUTCOME_POSTPONED = 'postponed'
const OUTCOME_LEFT = 'left'
const OUTCOME_GONE = 'gone'

const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value)
const isValidUserId = value => typeof value === 'string' && !!value && !value.includes('/') && value.length <= 128

const taskKey = (projectId, taskId) => `${projectId}:${taskId}`
const dayPath = (userId, localDateKey) => `users/${userId}/${INBOX_DAYS_COLLECTION}/${localDateKey}`

// Lazy: autoPostponeTasksCloud requires this module for the nightly run.
const autoPostpone = () => require('./autoPostponeTasksCloud')

function getLocalDayBounds(localDateKey, timezoneContext) {
    const start = timezoneContext?.zoneName
        ? moment.tz(localDateKey, 'YYYY-MM-DD', timezoneContext.zoneName)
        : moment.utc(localDateKey, 'YYYY-MM-DD').utcOffset(timezoneContext?.offsetMinutes || 0, true)
    return { start: start.valueOf(), end: start.clone().endOf('day').valueOf() }
}

const getRecurrenceType = task =>
    task?.recurrence && typeof task.recurrence === 'object' ? task.recurrence.type : task?.recurrence

function getEstimateMinutes(task, userId, isObservedTask) {
    const observerValue = isObservedTask ? Number(task?.estimationsByObserverIds?.[userId]) : NaN
    const value =
        Number.isFinite(observerValue) && observerValue > 0 ? observerValue : Number(task?.estimations?.[OPEN_STEP])
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

function getTaskOrigin(task, userId) {
    if (task?.calendarData) return 'calendar'
    if (task?.gmailData) return 'email'
    if (task?.creatorId && task.creatorId !== userId) return 'other'
    return 'self'
}

const getEffectiveDueDate = (task, userId, isObservedTask) =>
    isObservedTask ? task?.dueDateByObserversIds?.[userId] : task?.dueDate

/**
 * The features of one task as it stands on the user's Today. `task` must carry `id`. The name is
 * kept (trimmed) because what a task is about is the strongest signal of whether it gets done today;
 * the entry is only ever readable by the user whose Today it was.
 */
function buildTaskEntry(task, { projectId, userId, isObservedTask = false, focusKey = null, timezoneContext, now }) {
    const key = taskKey(projectId, task.id)
    const dueDate = getEffectiveDueDate(task, userId, isObservedTask)
    const { getOverdueDays } = autoPostpone()
    return {
        key,
        projectId,
        taskId: task.id,
        name: String(task.name || task.extendedName || '').slice(0, MAX_TASK_NAME_LENGTH),
        isObservedTask,
        dueDate: isFiniteNumber(dueDate) ? dueDate : null,
        overdueDays: isFiniteNumber(dueDate) ? getOverdueDays(dueDate, timezoneContext, now) : null,
        created: isFiniteNumber(task.created) ? task.created : null,
        timesPostponed: task.timesPostponed || 0,
        priority: task.priority || 'none',
        estimateMinutes: getEstimateMinutes(task, userId, isObservedTask),
        parentGoalId: task.parentGoalId || null,
        recurrence: getRecurrenceType(task) || 'never',
        isFocus: !!focusKey && key === focusKey,
        subtaskCount: Array.isArray(task.subtaskIds) ? task.subtaskIds.length : 0,
        origin: getTaskOrigin(task, userId),
        creatorId: task.creatorId || null,
        waitingForOther: !isObservedTask && !!task.currentReviewerId && task.currentReviewerId !== userId,
    }
}

const getFocusKey = userData =>
    userData?.inFocusTaskId && userData?.inFocusTaskProjectId
        ? taskKey(userData.inFocusTaskProjectId, userData.inFocusTaskId)
        : null

// ------------------------------------------------------------------ postpone events (task trigger)

/**
 * Pure: the due dates this write moved later, one per user whose Today it affects. The primary due
 * date belongs to whoever has the task on their Today (`currentReviewerId`, else the assignee);
 * observers each have their own. Done tasks and subtasks are not on Today, so they never count.
 * Whether the move actually left Today is decided per user in their own time zone.
 */
function detectDueDateMovesLater(before, after) {
    if (!before || !after) return []
    if (before.inDone === true || after.inDone === true || before.done === true || after.done === true) return []
    if (before.parentId || after.parentId) return []

    const moves = []
    if (isFiniteNumber(before.dueDate) && isFiniteNumber(after.dueDate) && after.dueDate > before.dueDate) {
        const userId = after.currentReviewerId || after.userId
        if (isValidUserId(userId))
            moves.push({ userId, isObservedTask: false, from: before.dueDate, to: after.dueDate })
    }

    const beforeObserverDates = before.dueDateByObserversIds || {}
    const afterObserverDates = after.dueDateByObserversIds || {}
    const observerIds = Array.isArray(after.observersIds) ? after.observersIds : []
    Object.keys(afterObserverDates).forEach(userId => {
        const from = beforeObserverDates[userId]
        const to = afterObserverDates[userId]
        if (!observerIds.includes(userId) || !isValidUserId(userId)) return
        if (isFiniteNumber(from) && isFiniteNumber(to) && to > from) {
            moves.push({ userId, isObservedTask: true, from, to })
        }
    })
    return moves
}

/** Pure: true when the move took the task off that user's Today (it was due today or earlier). */
function isMoveOffToday({ from, to, timezoneContext, now }) {
    const { getMomentInTimezone } = autoPostpone()
    const endOfToday = getMomentInTimezone(now, timezoneContext).endOf('day').valueOf()
    return from <= endOfToday && to > endOfToday
}

/** Firestore doc ids may not contain '/'. */
const toEventDocId = (eventId, move) =>
    `${String(eventId || Date.now()).replace(/\//g, '_')}${move.isObservedTask ? `_${move.userId}` : ''}`

/**
 * Called from `onUpdateTaskSecondGen`. One extra read (the user's time zone) per due date moved
 * later, nothing at all for any other write. Never throws: a failed record must not fail the
 * trigger's other work.
 */
async function recordInboxPostponesIfChanged(event, { db = admin.firestore() } = {}) {
    try {
        const before = event?.data?.before?.data?.()
        const after = event?.data?.after?.data?.()
        const moves = detectDueDateMovesLater(before, after)
        if (moves.length === 0) return 0

        const { projectId, taskId } = event.params || {}
        const now = Date.parse(event.time) || Date.now()
        const { resolveTimezoneContext, getMomentInTimezone } = autoPostpone()
        let recorded = 0

        for (const move of moves) {
            const userDoc = await db.doc(`users/${move.userId}`).get()
            if (!userDoc.exists) continue // an assistant or a workstream, not a person's Today
            const userData = userDoc.data() || {}
            const timezoneContext = resolveTimezoneContext(userData)
            if (!isMoveOffToday({ ...move, timezoneContext, now })) continue

            const localDateKey = getMomentInTimezone(now, timezoneContext).format('YYYY-MM-DD')
            await db.doc(`${dayPath(move.userId, localDateKey)}/events/${toEventDocId(event.id, move)}`).set({
                at: now,
                key: taskKey(projectId, taskId),
                projectId,
                taskId,
                isObservedTask: move.isObservedTask,
                from: move.from,
                to: move.to,
                toSomeday: move.to >= BACKLOG_DATE_NUMERIC,
                editorId: after.lastEditorId || null,
                // Bulk paths stamp every task of one action with the same time: equal values mark one action.
                editionDate: isFiniteNumber(after.lastEditionDate) ? after.lastEditionDate : null,
                task: buildTaskEntry(
                    { ...before, id: taskId },
                    {
                        projectId,
                        userId: move.userId,
                        isObservedTask: move.isObservedTask,
                        focusKey: getFocusKey(userData),
                        timezoneContext,
                        now,
                    }
                ),
            })
            recorded++
        }
        return recorded
    } catch (error) {
        console.warn('[inboxDayDataset] Could not record a postpone', {
            projectId: event?.params?.projectId,
            taskId: event?.params?.taskId,
            error: error.message,
        })
        return 0
    }
}

// ------------------------------------------------------------------ the day record (hourly schedule)

/** The user's Today as the nightly auto-postpone sees it: open, top-level, due today or earlier. */
async function collectTodayList({ db, userId, userData, timezoneContext, now }) {
    const { getEligibleActiveProjectsForUser, collectEligibleTasksForProject } = autoPostpone()
    const projects = await getEligibleActiveProjectsForUser(userData, db)
    const focusKey = getFocusKey(userData)
    const entries = []
    for (const project of projects) {
        const candidates = await collectEligibleTasksForProject({
            projectId: project.id,
            userId,
            userData,
            timezoneContext,
            thresholdDays: 0,
            db,
            now,
        })
        candidates.forEach(candidate => {
            entries.push(
                buildTaskEntry(candidate.task, {
                    projectId: project.id,
                    userId,
                    isObservedTask: candidate.isObservedTask,
                    focusKey,
                    timezoneContext,
                    now,
                })
            )
        })
    }
    return entries
}

/**
 * Pure: what became of one task by the end of its day. `current` is today's Today-list entry when
 * the task is on it, else `taskData` is the stored task (null when it no longer exists). `events`
 * are that day's moves off Today. A later due date counts as postponed only with a move recorded
 * during the day: without one the user left the task, and something after the day ended (the
 * nightly auto-postpone, which runs before this) moved it.
 */
function resolveOutcome({ entry, current, taskData, userId, dayEnd, events = [] }) {
    const moves = events.filter(event => event.key === entry.key)
    const lastMove = moves.length ? moves.reduce((latest, event) => (event.at > latest.at ? event : latest)) : null
    const base = {
        postponeCount: moves.length,
        lastPostponedAt: lastMove ? lastMove.at : null,
    }
    const laterDated = dueDate => {
        if (moves.length > 0) return { ...base, result: OUTCOME_POSTPONED, dueDate }
        return { ...base, result: OUTCOME_LEFT, dueDate, movedAfterDay: true }
    }

    if (current) {
        return current.dueDate !== null && current.dueDate <= dayEnd
            ? { ...base, result: OUTCOME_LEFT, dueDate: current.dueDate }
            : laterDated(current.dueDate)
    }
    if (!taskData || taskData.parentId) return { ...base, result: OUTCOME_GONE, dueDate: null }
    if (taskData.inDone === true || taskData.done === true) {
        return {
            ...base,
            result: OUTCOME_DONE,
            dueDate: null,
            completedAt: isFiniteNumber(taskData.completed) ? taskData.completed : null,
        }
    }
    const dueDate = getEffectiveDueDate(taskData, userId, entry.isObservedTask)
    if (isFiniteNumber(dueDate) && dueDate > dayEnd) return laterDated(dueDate)
    // Still open and due, but no longer on this user's Today (reassigned, visibility changed).
    return { ...base, result: OUTCOME_GONE, dueDate: isFiniteNumber(dueDate) ? dueDate : null }
}

function countOutcomes(entries) {
    const counts = { listed: entries.length, done: 0, postponed: 0, left: 0, gone: 0 }
    entries.forEach(entry => {
        const result = entry.outcome?.result
        if (result in counts) counts[result]++
    })
    return counts
}

/**
 * Closes the day `localDateKey`: an outcome for every listed task, plus the tasks that came onto
 * Today after the snapshot (postponed later that day, or still left open). Done tasks that were
 * added and finished within the day are not listed (they never reach a query of open tasks).
 */
async function closeInboxDay({ db, userId, localDateKey, timezoneContext, todayEntries, now }) {
    const ref = db.doc(dayPath(userId, localDateKey))
    const snapshot = await ref.get()
    if (!snapshot.exists) return { closed: false, reason: 'missing' }
    const day = snapshot.data() || {}
    if (!Array.isArray(day.tasks)) return { closed: false, reason: 'no-snapshot' }
    if (day.closedAt) return { closed: false, reason: 'already-closed' }

    const { end: dayEnd } = getLocalDayBounds(localDateKey, timezoneContext)
    const snapshotAt = isFiniteNumber(day.snapshotAt) ? day.snapshotAt : 0
    const eventsSnapshot = await db.collection(`${dayPath(userId, localDateKey)}/events`).get()
    const allEvents = eventsSnapshot.docs.map(doc => doc.data() || {}).filter(event => event.key)
    // Moves before the snapshot took tasks off the list before it was taken (the nightly
    // auto-postpone, late-night clean-up): they are not decisions about this day's list.
    const events = allEvents.filter(event => isFiniteNumber(event.at) && event.at >= snapshotAt)
    const todayByKey = new Map(todayEntries.map(entry => [entry.key, entry]))

    const listed = day.tasks
    const listedKeys = new Set(listed.map(entry => entry.key))
    const added = []
    const addedKeys = new Set()
    events.forEach(event => {
        if (listedKeys.has(event.key) || addedKeys.has(event.key) || !event.task) return
        addedKeys.add(event.key)
        added.push(event.task)
    })
    todayEntries.forEach(entry => {
        if (listedKeys.has(entry.key) || addedKeys.has(entry.key)) return
        if (entry.dueDate === null || entry.dueDate > dayEnd) return
        if (isFiniteNumber(entry.created) && entry.created > dayEnd) return
        addedKeys.add(entry.key)
        added.push(entry)
    })

    const all = [...listed, ...added]
    const needsRead = all.filter(entry => !todayByKey.has(entry.key))
    const docs = await Promise.all(
        needsRead.map(entry => db.doc(`items/${entry.projectId}/tasks/${entry.taskId}`).get())
    )
    const taskDataByKey = new Map(
        needsRead.map((entry, index) => [entry.key, docs[index].exists ? docs[index].data() || {} : null])
    )

    const withOutcome = entry => ({
        ...entry,
        outcome: resolveOutcome({
            entry,
            current: todayByKey.get(entry.key) || null,
            taskData: taskDataByKey.get(entry.key) || null,
            userId,
            dayEnd,
            events,
        }),
    })
    const tasks = listed.map(withOutcome)
    const addedTasks = added.slice(0, MAX_INBOX_DAY_TASKS).map(withOutcome)

    await ref.set(
        {
            closedAt: now,
            tasks,
            addedTasks,
            counts: countOutcomes(tasks),
            addedCounts: countOutcomes(addedTasks),
            postponeEventCount: events.length,
            postponeEventsBeforeSnapshot: allEvents.length - events.length,
        },
        { merge: true }
    )
    return { closed: true, listed: tasks.length, added: addedTasks.length }
}

/**
 * Once per user and local day (the first hourly run of the day; the record itself is the marker):
 * snapshot today's Today list and close yesterday. Runs for every active user, whether or not
 * nightly auto-postpone is on for them. Never throws.
 */
async function recordInboxDay({ db = admin.firestore(), userId, userData = {}, now = Date.now(), clock = Date.now }) {
    try {
        const { resolveTimezoneContext, getMomentInTimezone } = autoPostpone()
        const timezoneContext = resolveTimezoneContext(userData)
        const localNow = getMomentInTimezone(now, timezoneContext)
        const localDateKey = localNow.format('YYYY-MM-DD')
        const ref = db.doc(dayPath(userId, localDateKey))
        const existing = await ref.get()
        if (existing.exists && Array.isArray(existing.data()?.tasks)) {
            return { recorded: false, reason: 'already-recorded', localDateKey }
        }

        const todayEntries = await collectTodayList({ db, userId, userData, timezoneContext, now })
        const snapshotAt = Math.max(now, clock())

        let closeResult = { closed: false, reason: 'not-run' }
        try {
            closeResult = await closeInboxDay({
                db,
                userId,
                localDateKey: localNow.clone().subtract(1, 'day').format('YYYY-MM-DD'),
                timezoneContext,
                todayEntries,
                now,
            })
        } catch (error) {
            console.warn('[inboxDayDataset] Could not close the previous day', { userId, error: error.message })
        }

        await ref.set(
            {
                schemaVersion: INBOX_DAY_SCHEMA_VERSION,
                localDateKey,
                timezoneOffset: localNow.utcOffset(),
                // The moment the list was read, not the start of the hourly run: the nightly
                // auto-postpone writes (and their move events) land in between.
                snapshotAt,
                snapshotLocalTime: localNow.format('HH:mm'),
                taskCount: todayEntries.length,
                truncated: todayEntries.length > MAX_INBOX_DAY_TASKS,
                tasks: todayEntries.slice(0, MAX_INBOX_DAY_TASKS),
            },
            { merge: true }
        )
        return { recorded: true, localDateKey, taskCount: todayEntries.length, closeResult }
    } catch (error) {
        console.warn('[inboxDayDataset] Could not record the inbox day', { userId, error: error.message })
        return { recorded: false, reason: 'failed' }
    }
}

module.exports = {
    INBOX_DAYS_COLLECTION,
    INBOX_DAY_SCHEMA_VERSION,
    MAX_INBOX_DAY_TASKS,
    OUTCOME_DONE,
    OUTCOME_POSTPONED,
    OUTCOME_LEFT,
    OUTCOME_GONE,
    taskKey,
    getLocalDayBounds,
    buildTaskEntry,
    detectDueDateMovesLater,
    isMoveOffToday,
    recordInboxPostponesIfChanged,
    resolveOutcome,
    closeInboxDay,
    recordInboxDay,
}
