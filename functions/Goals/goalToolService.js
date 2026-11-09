'use strict'

/**
 * Goal and milestone writes for assistants and MCP clients (create_goal, update_goal,
 * update_milestone).
 *
 * The goal model has one rule that every write here exists to keep: a fixed milestone is not an
 * object of its own, it is the DATE that goals point to. The app creates an open milestone when a
 * goal gets a completion date nobody uses yet (`uploadOpenNewMilestoneIfNotExistMilestoneInSameDate`)
 * and deletes it again once no goal points there (`deleteOpenMilestoneIfIsEmpty`). That is why there
 * is no create_milestone: a milestone appears when a goal is given its date, and update_milestone
 * renames it, moves it with all of its goals, or marks it done.
 *
 * Dates are matched by DAY, never by timestamp equality. The app stores a milestone at local noon of
 * the browser that created it, and `users/{uid}.timezone` is often a stale integer offset (2 for
 * Berlin in November), so the noon this server computes can be an hour or two away from the noon the
 * app wrote. An exact match would give the same day two milestones; a window of half a day either
 * side of the computed noon finds the existing one, and the goal then takes that milestone's exact
 * timestamp, because every reader compares `completionMilestoneDate == milestone.date`.
 */

const moment = require('moment-timezone')

const {
    ALL_USERS,
    BACKLOG_DATE_NUMERIC,
    BACKLOG_MILESTONE_ID,
    CAPACITY_NONE,
    DYNAMIC_PERCENT,
    FEED_PUBLIC_FOR_ALL,
    generateSortIndex,
    getTaskNameWithoutMeta,
} = require('../Utils/HelperFunctionsCloud')
const {
    GOAL_MILESTONES_MODE_LINEAR,
    GOAL_SCHEDULE_MODE_DYNAMIC,
    GOAL_SCHEDULE_MODE_FIXED,
    MILESTONE_TYPE_FIXED,
    MILESTONE_TYPE_LINEAR,
    getLinearMilestonePeriods,
    goalIsVisibleInOpenMilestone,
    normalizeGoalMilestonesConfig,
    normalizeGoalScheduleMode,
    normalizeMilestoneType,
} = require('../shared/goalMilestonesHelper')
const { resolveUserTimezone, resolveTimezoneOffsetMinutes } = require('../GoogleCalendar/calendarUserDay')

const HALF_DAY_MS = 12 * 60 * 60 * 1000
const MAX_GOAL_NAME_LENGTH = 300
const MAX_GOAL_DESCRIPTION_LENGTH = 5000
const MAX_MILESTONE_NAME_LENGTH = 200
const MAX_COMMENT_LENGTH = 5000
const SOMEDAY_VALUES = new Set(['someday', 'backlog', 'none'])
const AUTO_PROGRESS_VALUES = new Set(['auto', 'automatic', 'dynamic'])
const DATE_ONLY_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:$|T)/

class GoalToolError extends Error {
    constructor(message, details = {}) {
        super(message)
        this.details = details
    }
}

const fail = (message, details) => {
    throw new GoalToolError(message, details)
}

const hasValue = value => value !== undefined && value !== null

// ---------------------------------------------------------------------------------------------
// Input normalisation
// ---------------------------------------------------------------------------------------------

function cleanText(value, field, maxLength) {
    if (!hasValue(value)) return undefined
    if (typeof value !== 'string') fail(`${field} must be a string.`)
    const text = value.trim()
    if (text.length > maxLength) fail(`${field} is too long (at most ${maxLength} characters).`)
    return text
}

function normalizeProgressInput(value) {
    if (!hasValue(value)) return undefined
    if (typeof value === 'string' && AUTO_PROGRESS_VALUES.has(value.trim().toLowerCase())) return DYNAMIC_PERCENT
    const number = typeof value === 'string' ? Number(value.trim().replace(/%$/, '')) : Number(value)
    if (!Number.isFinite(number) || number < 0 || number > 100) {
        fail('progress must be a number from 0 to 100, or "auto" to follow the share of done tasks.')
    }
    return Math.round(number)
}

/**
 * "YYYY-MM-DD" (or an ISO string, whose date part counts) → local noon of that day for the user, or
 * BACKLOG_DATE_NUMERIC for "someday". Returns undefined when the caller did not pass a date.
 */
function resolveDayInput(value, userData, field) {
    if (!hasValue(value) || value === '') return undefined
    if (typeof value !== 'string') fail(`${field} must be a date "YYYY-MM-DD" or "someday".`)
    const text = value.trim()
    if (SOMEDAY_VALUES.has(text.toLowerCase())) return BACKLOG_DATE_NUMERIC
    const match = text.match(DATE_ONLY_PATTERN)
    if (!match || !moment.utc(match[1], 'YYYY-MM-DD', true).isValid()) {
        fail(`${field} must be a date "YYYY-MM-DD" or "someday", got "${value}".`)
    }
    return getLocalNoon(match[1], userData)
}

function getLocalNoon(dateKey, userData = {}) {
    const timezone = resolveUserTimezone(userData)
    if (typeof timezone === 'string' && moment.tz.zone(timezone)) {
        return moment.tz(`${dateKey} 12:00`, 'YYYY-MM-DD HH:mm', timezone).valueOf()
    }
    const offsetMinutes = resolveTimezoneOffsetMinutes(timezone)
    return moment.utc(`${dateKey}T12:00:00`).subtract(offsetMinutes, 'minutes').valueOf()
}

function formatDay(timestamp, userData = {}) {
    if (!Number.isFinite(Number(timestamp)) || Number(timestamp) === BACKLOG_DATE_NUMERIC) return 'someday'
    const timezone = resolveUserTimezone(userData)
    if (typeof timezone === 'string' && moment.tz.zone(timezone)) {
        return moment.tz(Number(timestamp), timezone).format('YYYY-MM-DD')
    }
    return moment.utc(Number(timestamp)).add(resolveTimezoneOffsetMinutes(timezone), 'minutes').format('YYYY-MM-DD')
}

const isSameDay = (milestoneDate, localNoon) =>
    Number.isFinite(Number(milestoneDate)) && Math.abs(Number(milestoneDate) - localNoon) < HALF_DAY_MS

const goalOwnerIdForProject = (project, assigneeIds, userId) =>
    project?.parentTemplateId ? assigneeIds?.[0] || userId : ALL_USERS

const milestoneOwnerIdForProject = (project, userId) => (project?.parentTemplateId ? userId : ALL_USERS)

const assigneeMapForDate = (assigneeIds, date) =>
    assigneeIds.reduce((map, assigneeId) => ({ ...map, [assigneeId]: date }), {})

// ---------------------------------------------------------------------------------------------
// Firestore access
// ---------------------------------------------------------------------------------------------

const goalsPath = projectId => `goals/${projectId}/items`
const milestonesPath = projectId => `goalsMilestones/${projectId}/milestonesItems`
const mapSnapshotDocs = snapshot => (snapshot?.docs || []).map(doc => ({ id: doc.id, ...doc.data() }))

async function loadProjectForUser(db, projectId, userId) {
    if (!projectId) fail('projectId is required.')
    const snapshot = await db.doc(`projects/${projectId}`).get()
    const project = snapshot.exists ? { id: projectId, ...snapshot.data() } : null
    if (!project || !Array.isArray(project.userIds) || !project.userIds.includes(userId)) {
        fail('The project does not exist or you are not a member of it.')
    }
    return project
}

async function loadUserData(db, userId) {
    try {
        const snapshot = await db.doc(`users/${userId}`).get()
        return snapshot.exists ? snapshot.data() || {} : {}
    } catch (_) {
        return {}
    }
}

async function getOpenMilestones(db, projectId, ownerId) {
    const snapshot = await db
        .collection(milestonesPath(projectId))
        .where('done', '==', false)
        .where('ownerId', '==', ownerId)
        .get()
    return mapSnapshotDocs(snapshot).sort((a, b) => Number(a.date) - Number(b.date))
}

async function getGoalsWithCompletionDate(db, projectId, ownerId, date) {
    const snapshot = await db
        .collection(goalsPath(projectId))
        .where('completionMilestoneDate', '==', date)
        .where('ownerId', '==', ownerId)
        .get()
    return mapSnapshotDocs(snapshot)
}

function findFixedMilestoneOnDay(openMilestones, localNoon, excludeId = null) {
    return (
        openMilestones.find(
            milestone =>
                milestone.id !== excludeId &&
                normalizeMilestoneType(milestone.milestoneType) === MILESTONE_TYPE_FIXED &&
                isSameDay(milestone.date, localNoon)
        ) || null
    )
}

function buildFixedMilestone(date, ownerId, now) {
    return {
        extendedName: '',
        created: now,
        date,
        done: false,
        assigneesCapacityDates: {},
        doneDate: now,
        hasStar: '#FFFFFF',
        ownerId,
        milestoneType: MILESTONE_TYPE_FIXED,
        periodStartDate: null,
        periodEndDate: null,
        periodKey: '',
        cadence: '',
    }
}

/** The open fixed milestone for that day, created when no goal uses the day yet. */
async function ensureFixedMilestone(db, projectId, ownerId, localNoon, now) {
    const openMilestones = await getOpenMilestones(db, projectId, ownerId)
    const existing = findFixedMilestoneOnDay(openMilestones, localNoon)
    if (existing) return { milestone: existing, created: false }
    const ref = db.collection(milestonesPath(projectId)).doc()
    const milestone = buildFixedMilestone(localNoon, ownerId, now)
    await ref.set(milestone)
    return { milestone: { id: ref.id, ...milestone }, created: true }
}

/** The current period's milestone of a project on automatic (linear) milestones. */
async function ensureActiveLinearMilestone(db, project, ownerId, now) {
    const config = normalizeGoalMilestonesConfig(project.goalMilestonesConfig)
    const [period] = getLinearMilestonePeriods(config, now, 1)
    if (!period) return null
    const openMilestones = await getOpenMilestones(db, project.id, ownerId)
    const existing = openMilestones.find(
        milestone =>
            normalizeMilestoneType(milestone.milestoneType) === MILESTONE_TYPE_LINEAR &&
            milestone.periodKey === period.periodKey
    )
    if (existing) return { milestone: existing, created: false }
    const { buildLinearMilestoneData } = require('./linearGoalMilestones')
    const ref = db.collection(milestonesPath(project.id)).doc()
    const milestone = buildLinearMilestoneData(period, ownerId, false, now)
    await ref.set(milestone)
    return { milestone: { id: ref.id, ...milestone }, created: true }
}

/** Deletes an open fixed milestone that no goal points to any more (the app does the same). */
async function deleteFixedMilestoneIfEmpty(db, projectId, ownerId, date, excludeGoalId) {
    if (!Number.isFinite(Number(date)) || date === BACKLOG_DATE_NUMERIC) return false
    const remaining = (await getGoalsWithCompletionDate(db, projectId, ownerId, date)).filter(
        goal => goal.id !== excludeGoalId && normalizeGoalScheduleMode(goal.scheduleMode) === GOAL_SCHEDULE_MODE_FIXED
    )
    if (remaining.length > 0) return false
    const openMilestones = await getOpenMilestones(db, projectId, ownerId)
    const milestone = openMilestones.find(
        item => normalizeMilestoneType(item.milestoneType) === MILESTONE_TYPE_FIXED && Number(item.date) === date
    )
    if (!milestone) return false
    await db.doc(`${milestonesPath(projectId)}/${milestone.id}`).delete()
    return true
}

/** Sort indexes for every open milestone the goal shows up in, keeping the ones it already has. */
async function buildSortIndexes(db, projectId, goal, createSortIndex) {
    const existing = goal.sortIndexByMilestone || {}
    if (goal.completionMilestoneDate === BACKLOG_DATE_NUMERIC) {
        const backlogId = `${BACKLOG_MILESTONE_ID}${projectId}`
        return existing[backlogId] ? {} : { [backlogId]: createSortIndex() }
    }
    const scheduleMode = normalizeGoalScheduleMode(goal.scheduleMode)
    const openMilestones = await getOpenMilestones(db, projectId, goal.ownerId)
    const additions = {}
    openMilestones
        .filter(milestone => {
            const type = normalizeMilestoneType(milestone.milestoneType)
            const matchesMode =
                scheduleMode === GOAL_SCHEDULE_MODE_DYNAMIC
                    ? type === MILESTONE_TYPE_LINEAR
                    : type === MILESTONE_TYPE_FIXED
            return matchesMode && goalIsVisibleInOpenMilestone(goal, milestone)
        })
        .forEach(milestone => {
            if (!existing[milestone.id]) additions[milestone.id] = createSortIndex()
        })
    return additions
}

function summarizeMilestone(milestone, userData) {
    if (!milestone) return null
    return {
        id: milestone.id,
        name: milestone.extendedName || '',
        date: formatDay(milestone.date, userData),
        done: !!milestone.done,
        type: normalizeMilestoneType(milestone.milestoneType),
    }
}

function summarizeGoal(goal, projectId, userData) {
    return {
        id: goal.id,
        projectId,
        name: goal.extendedName || goal.name || '',
        description: goal.description || '',
        progress: goal.progress === DYNAMIC_PERCENT ? 'auto' : goal.progress,
        ...(goal.progress === DYNAMIC_PERCENT ? { tasksDonePercent: Number(goal.dynamicProgress) || 0 } : {}),
        startDate: formatDay(goal.startingMilestoneDate, userData),
        milestoneDate: formatDay(goal.completionMilestoneDate, userData),
        assigneeIds: Array.isArray(goal.assigneesIds) ? goal.assigneesIds : [],
        isPrivate: Array.isArray(goal.isPublicFor) && !goal.isPublicFor.includes(FEED_PUBLIC_FOR_ALL),
        scheduleMode: normalizeGoalScheduleMode(goal.scheduleMode),
    }
}

function validateAssignees(assigneeIds, project) {
    if (!hasValue(assigneeIds)) return undefined
    if (!Array.isArray(assigneeIds) || assigneeIds.length === 0) {
        fail('assigneeIds must be a non-empty list of project member user ids.')
    }
    const ids = [...new Set(assigneeIds.map(id => String(id || '').trim()).filter(Boolean))]
    const unknown = ids.filter(id => !project.userIds.includes(id))
    if (unknown.length > 0) {
        fail(`These assignees are not members of the project: ${unknown.join(', ')}.`, {
            projectMemberIds: project.userIds,
        })
    }
    return ids
}

const normalizeNameForMatch = name =>
    getTaskNameWithoutMeta(String(name || ''), true)
        .trim()
        .toLowerCase()

// ---------------------------------------------------------------------------------------------
// Feeds (best effort: the goal is written either way)
// ---------------------------------------------------------------------------------------------

async function runFeedsSafely(label, fn) {
    if (typeof fn !== 'function') return null
    try {
        await fn()
        return null
    } catch (error) {
        console.warn(`[goalToolService] ${label} feed failed`, { error: error.message })
        return `The change is saved, but its entry in Updates could not be written (${error.message}).`
    }
}

// ---------------------------------------------------------------------------------------------
// create_goal
// ---------------------------------------------------------------------------------------------

async function createGoal({
    db,
    projectId,
    userId,
    args = {},
    now = Date.now(),
    createSortIndex = generateSortIndex,
    feeds = {},
}) {
    const project = await loadProjectForUser(db, projectId, userId)
    const userData = await loadUserData(db, userId)

    const extendedName = cleanText(args.name, 'name', MAX_GOAL_NAME_LENGTH)
    if (!extendedName) fail('name is required.')
    const description = cleanText(args.description, 'description', MAX_GOAL_DESCRIPTION_LENGTH) || ''
    const progress = normalizeProgressInput(args.progress)
    const assigneeIds = validateAssignees(args.assigneeIds, project) || [userId]
    const ownerId = goalOwnerIdForProject(project, assigneeIds, userId)
    const isPrivate = args.isPrivate === true

    // An agent that retries a create must not end up with two goals of the same name.
    const sameNameGoals = mapSnapshotDocs(
        await db.collection(goalsPath(projectId)).where('ownerId', '==', ownerId).get()
    ).filter(
        goal =>
            normalizeNameForMatch(goal.extendedName || goal.name) === normalizeNameForMatch(extendedName) &&
            !(Array.isArray(goal.parentDoneMilestoneIds) && goal.parentDoneMilestoneIds.length > 0)
    )
    if (sameNameGoals.length > 0) {
        return {
            success: true,
            alreadyExists: true,
            message: `An open goal named "${extendedName}" already exists in this project; nothing was created. Use update_goal to change it.`,
            goal: summarizeGoal(sameNameGoals[0], projectId, userData),
        }
    }

    const requestedCompletion = resolveDayInput(args.milestoneDate, userData, 'milestoneDate')
    const requestedStart = resolveDayInput(args.startDate, userData, 'startDate')
    const linearProject =
        normalizeGoalMilestonesConfig(project.goalMilestonesConfig).mode === GOAL_MILESTONES_MODE_LINEAR

    let scheduleMode = GOAL_SCHEDULE_MODE_FIXED
    let completionMilestoneDate = BACKLOG_DATE_NUMERIC
    let milestoneResult = null
    if (requestedCompletion !== undefined && requestedCompletion !== BACKLOG_DATE_NUMERIC) {
        milestoneResult = await ensureFixedMilestone(db, projectId, ownerId, requestedCompletion, now)
        completionMilestoneDate = Number(milestoneResult.milestone.date)
    } else if (requestedCompletion === undefined && linearProject) {
        // The app does the same for a project on automatic milestones: a new goal joins the current
        // period, because a dynamic goal in the backlog would show up in no milestone at all.
        milestoneResult = await ensureActiveLinearMilestone(db, project, ownerId, now)
        if (milestoneResult) {
            scheduleMode = GOAL_SCHEDULE_MODE_DYNAMIC
            completionMilestoneDate = Number(milestoneResult.milestone.date)
        }
    }

    let startingMilestoneDate = completionMilestoneDate
    if (requestedStart !== undefined && requestedStart !== BACKLOG_DATE_NUMERIC) {
        if (completionMilestoneDate === BACKLOG_DATE_NUMERIC) {
            fail('startDate needs a milestoneDate: a goal without a milestone date has no range to start in.')
        }
        const openMilestones = await getOpenMilestones(db, projectId, ownerId)
        const startMilestone = findFixedMilestoneOnDay(openMilestones, requestedStart)
        startingMilestoneDate = startMilestone ? Number(startMilestone.date) : requestedStart
        if (startingMilestoneDate > completionMilestoneDate) fail('startDate must not be after milestoneDate.')
    }

    const ref = db.collection(goalsPath(projectId)).doc()
    const goal = {
        name: normalizeNameForMatch(extendedName),
        extendedName,
        created: now,
        creatorId: userId,
        progress: progress === undefined ? DYNAMIC_PERCENT : progress,
        assigneesIds: assigneeIds,
        assigneesCapacity: assigneeIds.reduce((map, id) => ({ ...map, [id]: CAPACITY_NONE }), {}),
        assigneesReminderDate: assigneeMapForDate(assigneeIds, completionMilestoneDate),
        lastEditionDate: now,
        lastEditorId: userId,
        hasStar: '#FFFFFF',
        description,
        startingMilestoneDate,
        completionMilestoneDate,
        parentDoneMilestoneIds: [],
        progressByDoneMilestone: {},
        isPublicFor: isPrivate ? [...new Set([userId, ...assigneeIds])] : [FEED_PUBLIC_FOR_ALL],
        dateByDoneMilestone: {},
        sortIndexByMilestone: {},
        noteId: null,
        dynamicProgress: 0,
        ownerId,
        isPremium: false,
        lockKey: '',
        assistantId: '',
        commentsData: null,
        scheduleMode,
        focusAreaId: null,
    }
    goal.sortIndexByMilestone = await buildSortIndexes(db, projectId, goal, createSortIndex)

    await ref.set(goal)
    const storedGoal = { id: ref.id, ...goal }

    const warning = await runFeedsSafely('create_goal', feeds.onGoalCreated && (() => feeds.onGoalCreated(storedGoal)))

    const milestone = milestoneResult?.milestone || null
    return {
        success: true,
        message:
            `Goal "${extendedName}" created` +
            (milestone
                ? ` in the milestone of ${formatDay(milestone.date, userData)}`
                : ' without a milestone date (someday)') +
            (milestoneResult?.created ? ' (new milestone)' : '') +
            '.',
        goal: summarizeGoal(storedGoal, projectId, userData),
        milestone: milestone
            ? { ...summarizeMilestone(milestone, userData), created: !!milestoneResult.created }
            : null,
        ...(warning ? { warnings: [warning] } : {}),
    }
}

// ---------------------------------------------------------------------------------------------
// update_goal
// ---------------------------------------------------------------------------------------------

async function findGoal(db, project, userId, args) {
    const goalId = typeof args.goalId === 'string' ? args.goalId.trim() : ''
    const isVisible = goal =>
        Array.isArray(goal.isPublicFor)
            ? goal.isPublicFor.includes(FEED_PUBLIC_FOR_ALL) || goal.isPublicFor.includes(userId)
            : true

    if (goalId) {
        if (goalId.includes('/')) fail('goalId is not valid.')
        const snapshot = await db.doc(`${goalsPath(project.id)}/${goalId}`).get()
        const goal = snapshot.exists ? { id: goalId, ...snapshot.data() } : null
        if (!goal || !isVisible(goal)) fail(`No goal with id "${goalId}" in this project.`)
        return goal
    }

    const goalName = typeof args.goalName === 'string' ? normalizeNameForMatch(args.goalName) : ''
    if (!goalName) fail('goalId or goalName is required.')
    const goals = mapSnapshotDocs(await db.collection(goalsPath(project.id)).get()).filter(isVisible)
    const exact = goals.filter(goal => normalizeNameForMatch(goal.extendedName || goal.name) === goalName)
    const matches =
        exact.length > 0
            ? exact
            : goals.filter(goal => normalizeNameForMatch(goal.extendedName || goal.name).includes(goalName))
    if (matches.length === 1) return matches[0]
    if (matches.length === 0) fail(`No goal named "${args.goalName}" in this project. Use get_goals to find it.`)
    fail(`Several goals match "${args.goalName}"; pass goalId instead.`, {
        matches: matches.slice(0, 10).map(goal => ({ id: goal.id, name: goal.extendedName || goal.name })),
    })
}

async function updateGoal({
    db,
    projectId,
    userId,
    args = {},
    now = Date.now(),
    createSortIndex = generateSortIndex,
    feeds = {},
    postComment,
}) {
    const project = await loadProjectForUser(db, projectId, userId)
    const userData = await loadUserData(db, userId)
    const goal = await findGoal(db, project, userId, args)
    const goalRef = db.doc(`${goalsPath(projectId)}/${goal.id}`)

    // A comment goes into the goal's thread, by itself or next to other changes (as in update_task).
    const comment = cleanText(args.comment, 'comment', MAX_COMMENT_LENGTH)
    if (comment !== undefined && !comment) fail('comment must not be empty.')
    if (comment && typeof postComment !== 'function') fail('Comments on goals are not available here.')

    const updates = {}
    const changes = []
    const feedChanges = {}

    const extendedName = cleanText(args.name, 'name', MAX_GOAL_NAME_LENGTH)
    if (extendedName !== undefined) {
        if (!extendedName) fail('name must not be empty.')
        if (extendedName !== (goal.extendedName || goal.name)) {
            updates.extendedName = extendedName
            updates.name = normalizeNameForMatch(extendedName)
            changes.push('name')
            feedChanges.name = { from: goal.extendedName || goal.name || '', to: extendedName }
        }
    }

    const description = cleanText(args.description, 'description', MAX_GOAL_DESCRIPTION_LENGTH)
    if (description !== undefined && description !== (goal.description || '')) {
        updates.description = description
        changes.push('description')
        feedChanges.description = { from: goal.description || '', to: description }
    }

    const progress = normalizeProgressInput(args.progress)
    if (progress !== undefined && progress !== goal.progress) {
        updates.progress = progress
        changes.push('progress')
        feedChanges.progress = progress
    }

    const assigneeIds = validateAssignees(args.assigneeIds, project)
    const currentAssignees = Array.isArray(goal.assigneesIds) ? goal.assigneesIds : []
    const assigneesChanged =
        assigneeIds !== undefined &&
        (assigneeIds.length !== currentAssignees.length || assigneeIds.some(id => !currentAssignees.includes(id)))
    if (assigneesChanged) {
        if (project.parentTemplateId) fail('Assignees of a goal in a guide project can only be changed in the app.')
        const isPrivate = Array.isArray(goal.isPublicFor) && !goal.isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
        if (isPrivate && assigneeIds.some(id => !goal.isPublicFor.includes(id))) {
            fail(
                'This goal is private, and a new assignee would also need access to it and to its tasks. Change it in the app.'
            )
        }
        updates.assigneesIds = assigneeIds
        updates.assigneesCapacity = assigneeIds.reduce(
            (map, id) => ({ ...map, [id]: goal.assigneesCapacity?.[id] || CAPACITY_NONE }),
            {}
        )
        changes.push('assignees')
        feedChanges.assignees = { from: currentAssignees, to: assigneeIds }
    }

    // Dates. A goal spans the open milestones from its start date to its milestone (completion)
    // date. Moving the milestone date moves the whole goal when it sat in one milestone, came from
    // someday or would otherwise start after it ends - the same rule the app applies.
    const requestedCompletion = resolveDayInput(args.milestoneDate, userData, 'milestoneDate')
    const requestedStart = resolveDayInput(args.startDate, userData, 'startDate')
    const oldCompletion = Number(goal.completionMilestoneDate)
    const oldStart = Number(goal.startingMilestoneDate)
    let completion = oldCompletion
    let start = oldStart
    let scheduleMode = normalizeGoalScheduleMode(goal.scheduleMode)
    let milestoneResult = null

    if (requestedCompletion !== undefined) {
        if (requestedCompletion === BACKLOG_DATE_NUMERIC) {
            completion = BACKLOG_DATE_NUMERIC
        } else {
            const openMilestones = await getOpenMilestones(db, projectId, goal.ownerId)
            const sameDay = findFixedMilestoneOnDay(openMilestones, requestedCompletion)
            const alreadyThere =
                scheduleMode === GOAL_SCHEDULE_MODE_FIXED && sameDay && Number(sameDay.date) === oldCompletion
            if (!alreadyThere) {
                milestoneResult = await ensureFixedMilestone(db, projectId, goal.ownerId, requestedCompletion, now)
                completion = Number(milestoneResult.milestone.date)
                scheduleMode = GOAL_SCHEDULE_MODE_FIXED
            }
        }
        if (completion !== oldCompletion) {
            const moveWholeGoal =
                completion === BACKLOG_DATE_NUMERIC ||
                oldCompletion === BACKLOG_DATE_NUMERIC ||
                oldStart === oldCompletion ||
                completion < oldStart
            if (moveWholeGoal) start = completion
        }
    }

    if (requestedStart !== undefined) {
        if (requestedStart === BACKLOG_DATE_NUMERIC) {
            start = completion
        } else {
            if (completion === BACKLOG_DATE_NUMERIC) {
                fail('startDate needs a milestone date: give the goal a milestoneDate first.')
            }
            const openMilestones = await getOpenMilestones(db, projectId, goal.ownerId)
            const startMilestone = findFixedMilestoneOnDay(openMilestones, requestedStart)
            start = startMilestone ? Number(startMilestone.date) : requestedStart
        }
        if (start > completion) fail('startDate must not be after the milestone date.')
    }

    const completionChanged = completion !== oldCompletion
    if (completionChanged) {
        updates.completionMilestoneDate = completion
        updates.assigneesReminderDate = assigneeMapForDate(updates.assigneesIds || currentAssignees, completion)
        changes.push('milestone date')
    } else if (updates.assigneesIds) {
        updates.assigneesReminderDate = assigneeMapForDate(updates.assigneesIds, completion)
    }
    if (start !== oldStart) {
        updates.startingMilestoneDate = start
        if (!changes.includes('milestone date')) changes.push('start date')
    }
    if (scheduleMode !== normalizeGoalScheduleMode(goal.scheduleMode)) updates.scheduleMode = scheduleMode

    if (changes.length === 0) {
        if (comment) {
            // Nothing else changed: the comment is the whole request, so its failure is the call's.
            const commentResult = await postComment({ goal, comment })
            return {
                success: true,
                message: `Comment added to the goal "${goal.extendedName || goal.name}".`,
                changes: ['comment'],
                goal: summarizeGoal(goal, projectId, userData),
                comment: summarizeComment(commentResult),
            }
        }
        return {
            success: true,
            unchanged: true,
            message: `Goal "${goal.extendedName || goal.name}" already had these values; nothing was written.`,
            goal: summarizeGoal(goal, projectId, userData),
        }
    }

    if (completionChanged || start !== oldStart) {
        const nextGoal = { ...goal, ...updates }
        const additions = await buildSortIndexes(db, projectId, nextGoal, createSortIndex)
        Object.entries(additions).forEach(([milestoneId, sortIndex]) => {
            updates[`sortIndexByMilestone.${milestoneId}`] = sortIndex
        })
    }

    updates.lastEditionDate = now
    updates.lastEditorId = userId
    await goalRef.update(updates)

    let removedMilestone = false
    if (completionChanged && normalizeGoalScheduleMode(goal.scheduleMode) === GOAL_SCHEDULE_MODE_FIXED) {
        removedMilestone = await deleteFixedMilestoneIfEmpty(db, projectId, goal.ownerId, oldCompletion, goal.id)
    }

    const storedGoal = { ...goal }
    Object.entries(updates).forEach(([key, value]) => {
        if (!key.includes('.')) storedGoal[key] = value
    })

    const warnings = []
    const warning = await runFeedsSafely(
        'update_goal',
        feeds.onGoalUpdated && (() => feeds.onGoalUpdated(storedGoal, feedChanges))
    )
    if (warning) warnings.push(warning)

    let commentResult = null
    if (comment) {
        try {
            commentResult = await postComment({ goal: storedGoal, comment })
            changes.push('comment')
        } catch (error) {
            console.warn('[goalToolService] update_goal comment failed', { goalId: goal.id, error: error.message })
            warnings.push(`The goal was updated, but the comment could not be added (${error.message}).`)
        }
    }

    const milestone = milestoneResult?.milestone || null
    return {
        success: true,
        message: `Goal "${storedGoal.extendedName || storedGoal.name}" updated (${changes.join(', ')}).`,
        changes,
        goal: summarizeGoal(storedGoal, projectId, userData),
        ...(milestone
            ? { milestone: { ...summarizeMilestone(milestone, userData), created: !!milestoneResult.created } }
            : {}),
        ...(removedMilestone ? { removedEmptyMilestone: formatDay(oldCompletion, userData) } : {}),
        ...(commentResult ? { comment: summarizeComment(commentResult) } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
    }
}

function summarizeComment(result) {
    return {
        commentId: result?.commentId || null,
        notifiedFollowers: result?.notifiedFollowers || 0,
        ...(result?.notificationError ? { notificationError: result.notificationError } : {}),
    }
}

// ---------------------------------------------------------------------------------------------
// update_milestone
// ---------------------------------------------------------------------------------------------

async function findMilestone(db, projectId, ownerId, userData, args) {
    const milestoneId = typeof args.milestoneId === 'string' ? args.milestoneId.trim() : ''
    if (milestoneId) {
        if (milestoneId.includes('/')) fail('milestoneId is not valid.')
        const snapshot = await db.doc(`${milestonesPath(projectId)}/${milestoneId}`).get()
        if (!snapshot.exists) fail(`No milestone with id "${milestoneId}" in this project.`)
        return { id: milestoneId, ...snapshot.data() }
    }

    const day = resolveDayInput(args.date, userData, 'date')
    if (day === undefined || day === BACKLOG_DATE_NUMERIC) fail('milestoneId or date ("YYYY-MM-DD") is required.')
    const openMilestones = await getOpenMilestones(db, projectId, ownerId)
    const matches = openMilestones.filter(milestone => isSameDay(milestone.date, day))
    if (matches.length === 1) return matches[0]
    const listed = openMilestones.slice(0, 20).map(milestone => summarizeMilestone(milestone, userData))
    if (matches.length === 0) {
        fail(
            `No open milestone on ${args.date}. A milestone exists only while goals use its date: give a goal that milestoneDate with create_goal or update_goal.`,
            { openMilestones: listed }
        )
    }
    fail(`Several open milestones fall on ${args.date}; pass milestoneId instead.`, {
        openMilestones: matches.map(milestone => summarizeMilestone(milestone, userData)),
    })
}

async function moveOpenMilestone({ db, projectId, milestone, targetNoon, now, createSortIndex }) {
    const ownerId = milestone.ownerId
    const oldDate = Number(milestone.date)
    const openMilestones = await getOpenMilestones(db, projectId, ownerId)
    const merged = findFixedMilestoneOnDay(openMilestones, targetNoon, milestone.id)
    const newDate = merged ? Number(merged.date) : targetNoon
    const targetMilestoneId = merged ? merged.id : milestone.id

    const goals = (await getGoalsWithCompletionDate(db, projectId, ownerId, oldDate)).filter(
        goal => normalizeGoalScheduleMode(goal.scheduleMode) === GOAL_SCHEDULE_MODE_FIXED
    )
    const batch = db.batch()
    goals.forEach(goal => {
        const start = Number(goal.startingMilestoneDate)
        const moveWholeGoal = start === Number(goal.completionMilestoneDate) || newDate < start
        const assigneeIds = Array.isArray(goal.assigneesIds) ? goal.assigneesIds : []
        const update = {
            completionMilestoneDate: newDate,
            assigneesReminderDate: assigneeMapForDate(assigneeIds, newDate),
            lastEditionDate: now,
        }
        if (moveWholeGoal) update.startingMilestoneDate = newDate
        if (!goal.sortIndexByMilestone?.[targetMilestoneId]) {
            update[`sortIndexByMilestone.${targetMilestoneId}`] = createSortIndex()
        }
        batch.update(db.doc(`${goalsPath(projectId)}/${goal.id}`), update)
    })
    const milestoneRef = db.doc(`${milestonesPath(projectId)}/${milestone.id}`)
    if (merged) batch.delete(milestoneRef)
    else batch.update(milestoneRef, { date: newDate })
    await batch.commit()

    return { newDate, mergedInto: merged ? merged.id : null, movedGoals: goals.length }
}

async function updateMilestone({
    db,
    projectId,
    userId,
    args = {},
    now = Date.now(),
    createSortIndex = generateSortIndex,
    setMilestoneDone,
}) {
    const project = await loadProjectForUser(db, projectId, userId)
    const userData = await loadUserData(db, userId)
    const ownerId = milestoneOwnerIdForProject(project, userId)
    let milestone = await findMilestone(db, projectId, ownerId, userData, args)

    const name = cleanText(args.name, 'name', MAX_MILESTONE_NAME_LENGTH)
    const targetNoon = resolveDayInput(args.newDate, userData, 'newDate')
    const hasDone = typeof args.done === 'boolean'
    if (hasValue(args.done) && !hasDone) fail('done must be true or false.')
    if (name === undefined && targetNoon === undefined && !hasDone) {
        fail('update_milestone needs at least one of name, newDate or done.')
    }

    const changes = []
    const result = {}

    if (name !== undefined && name !== (milestone.extendedName || '')) {
        await db.doc(`${milestonesPath(projectId)}/${milestone.id}`).update({ extendedName: name })
        milestone = { ...milestone, extendedName: name }
        changes.push('name')
    }

    if (targetNoon !== undefined) {
        if (targetNoon === BACKLOG_DATE_NUMERIC) {
            fail('newDate must be a date; to move goals to someday, use update_goal with milestoneDate "someday".')
        }
        if (milestone.done) fail('A done milestone cannot be moved. Reopen it first with done: false.')
        if (normalizeMilestoneType(milestone.milestoneType) === MILESTONE_TYPE_LINEAR) {
            fail('This milestone belongs to the automatic milestones of the project, whose dates follow the cadence.')
        }
        if (!isSameDay(milestone.date, targetNoon)) {
            const move = await moveOpenMilestone({ db, projectId, milestone, targetNoon, now, createSortIndex })
            milestone = { ...milestone, date: move.newDate, ...(move.mergedInto ? { id: move.mergedInto } : {}) }
            result.movedGoals = move.movedGoals
            if (move.mergedInto) result.mergedIntoMilestoneId = move.mergedInto
            changes.push('date')
        }
    }

    if (hasDone && args.done !== !!milestone.done) {
        if (typeof setMilestoneDone !== 'function') fail('Marking milestones done is not available here.')
        const transition = await setMilestoneDone({ projectId, milestoneId: milestone.id, targetDone: args.done })
        milestone = { ...milestone, done: args.done }
        result.updatedGoalCount = transition?.updatedGoalCount
        changes.push(args.done ? 'marked done' : 'reopened')
    }

    if (changes.length === 0) {
        return {
            success: true,
            unchanged: true,
            message: 'The milestone already had these values; nothing was written.',
            milestone: summarizeMilestone(milestone, userData),
        }
    }

    return {
        success: true,
        message: `Milestone of ${formatDay(milestone.date, userData)} updated (${changes.join(', ')}).`,
        changes,
        milestone: summarizeMilestone(milestone, userData),
        ...result,
    }
}

module.exports = {
    GoalToolError,
    createGoal,
    updateGoal,
    updateMilestone,
    // exported for tests
    getLocalNoon,
    formatDay,
    normalizeProgressInput,
    resolveDayInput,
}
