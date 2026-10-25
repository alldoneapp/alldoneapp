const admin = require('firebase-admin')

const { assertProjectAccess } = require('../shared/privacyAccess')
const {
    BACKLOG_DATE_NUMERIC,
    BACKLOG_MILESTONE_ID,
    DYNAMIC_PERCENT,
    generateSortIndex,
} = require('../Utils/HelperFunctionsCloud')
const {
    GOAL_SCHEDULE_MODE_DYNAMIC,
    GOAL_SCHEDULE_MODE_FIXED,
    MILESTONE_TYPE_FIXED,
    MILESTONE_TYPE_LINEAR,
    getLinearMilestonePeriods,
    getLinearMilestoneTitle,
    normalizeGoalMilestonesConfig,
    normalizeGoalScheduleMode,
    normalizeMilestoneType,
} = require('../shared/goalMilestonesHelper')

const MAX_TRANSACTION_WRITES = 450

class MilestoneDoneError extends Error {
    constructor(code, message) {
        super(message)
        this.code = code
    }
}

const getString = value => (typeof value === 'string' ? value.trim() : '')

function normalizeRequest(data = {}) {
    const projectId = getString(data.projectId)
    const milestoneId = getString(data.milestoneId)
    if (!projectId || !milestoneId || projectId.includes('/') || milestoneId.includes('/')) {
        throw new MilestoneDoneError('invalid-argument', 'A valid projectId and milestoneId are required')
    }
    if (typeof data.targetDone !== 'boolean') {
        throw new MilestoneDoneError('invalid-argument', 'targetDone must be a boolean')
    }
    return { projectId, milestoneId, targetDone: data.targetDone }
}

const mapDocs = snapshot => snapshot.docs.map(doc => ({ id: doc.id, ref: doc.ref, ...doc.data() }))

const scheduleModeForMilestone = milestoneType =>
    milestoneType === MILESTONE_TYPE_LINEAR ? GOAL_SCHEDULE_MODE_DYNAMIC : GOAL_SCHEDULE_MODE_FIXED

const milestoneTypeForGoal = goal =>
    normalizeGoalScheduleMode(goal.scheduleMode) === GOAL_SCHEDULE_MODE_DYNAMIC
        ? MILESTONE_TYPE_LINEAR
        : MILESTONE_TYPE_FIXED

const isGoalCompleted = goal =>
    goal.progress === 100 || (goal.progress === DYNAMIC_PERCENT && goal.dynamicProgress === 100)

const updateAssigneesReminderDate = (assigneesIds = [], date) => {
    const result = {}
    assigneesIds.forEach(id => {
        result[id] = date
    })
    return result
}

const withoutKey = (source, key) => {
    const result = { ...(source || {}) }
    delete result[key]
    return result
}

function createGoalAccumulator(db, projectId, actorUserId, now, createSortIndex) {
    const goals = new Map()

    const getEntry = goal => {
        let entry = goals.get(goal.id)
        if (!entry) {
            entry = {
                data: { ...goal },
                ref: goal.ref || db.doc(`goals/${projectId}/items/${goal.id}`),
                update: {},
            }
            goals.set(goal.id, entry)
        }
        return entry
    }

    const setFields = (goal, fields) => {
        const entry = getEntry(goal)
        Object.assign(entry.data, fields)
        Object.assign(entry.update, fields)
    }

    const addDoneHistory = (goal, milestoneId, milestoneDate, doneDate) => {
        const entry = getEntry(goal)
        const parentDoneMilestoneIds = Array.isArray(entry.data.parentDoneMilestoneIds)
            ? [...entry.data.parentDoneMilestoneIds]
            : []
        if (!parentDoneMilestoneIds.includes(milestoneId)) parentDoneMilestoneIds.push(milestoneId)
        setFields(entry.data, {
            parentDoneMilestoneIds,
            progressByDoneMilestone: {
                ...(entry.data.progressByDoneMilestone || {}),
                [milestoneId]: {
                    progress:
                        entry.data.progress === DYNAMIC_PERCENT ? entry.data.dynamicProgress : entry.data.progress,
                    doneDate,
                },
            },
            dateByDoneMilestone: {
                ...(entry.data.dateByDoneMilestone || {}),
                [milestoneId]: milestoneDate,
            },
        })
    }

    const removeDoneHistory = (goal, milestoneId) => {
        const entry = getEntry(goal)
        setFields(entry.data, {
            parentDoneMilestoneIds: (entry.data.parentDoneMilestoneIds || []).filter(id => id !== milestoneId),
            progressByDoneMilestone: withoutKey(entry.data.progressByDoneMilestone, milestoneId),
            dateByDoneMilestone: withoutKey(entry.data.dateByDoneMilestone, milestoneId),
        })
    }

    const addSortIndex = (goal, milestoneId) => {
        const entry = getEntry(goal)
        const existing = entry.data.sortIndexByMilestone || {}
        setFields(entry.data, {
            sortIndexByMilestone: {
                ...existing,
                [milestoneId]: existing[milestoneId] || createSortIndex(),
            },
        })
    }

    const write = transaction => {
        goals.forEach(entry => {
            transaction.update(entry.ref, {
                ...entry.update,
                lastEditionDate: now,
                lastEditorId: actorUserId,
            })
        })
    }

    return {
        addDoneHistory,
        addSortIndex,
        get size() {
            return goals.size
        },
        removeDoneHistory,
        setFields,
        write,
    }
}

function buildOpenMilestone(milestone, now) {
    const copy = { ...milestone, done: false, doneDate: now, created: milestone.created || now }
    delete copy.id
    delete copy.ref
    return copy
}

function buildLinearMilestone(period, ownerId, now) {
    return {
        extendedName: getLinearMilestoneTitle(period),
        created: now,
        date: period.date,
        done: false,
        assigneesCapacityDates: {},
        doneDate: now,
        hasStar: '#FFFFFF',
        ownerId,
        milestoneType: MILESTONE_TYPE_LINEAR,
        periodStartDate: period.periodStartDate,
        periodEndDate: period.periodEndDate,
        periodKey: period.periodKey,
        cadence: period.cadence,
    }
}

async function moveToDone({
    transaction,
    db,
    projectId,
    milestoneId,
    milestone,
    milestoneRef,
    actorUserId,
    project,
    now,
    createSortIndex,
}) {
    const milestoneType = normalizeMilestoneType(milestone.milestoneType)
    const scheduleMode = scheduleModeForMilestone(milestoneType)
    const milestones = db.collection(`goalsMilestones/${projectId}/milestonesItems`)
    const goals = db.collection(`goals/${projectId}/items`)

    const [sameDateSnapshot, baseGoalSnapshot, nextMilestoneSnapshot] = await Promise.all([
        transaction.get(milestones.where('date', '==', milestone.date).where('ownerId', '==', milestone.ownerId)),
        transaction.get(
            goals.where('completionMilestoneDate', '==', milestone.date).where('ownerId', '==', milestone.ownerId)
        ),
        transaction.get(
            milestones
                .where('done', '==', false)
                .where('ownerId', '==', milestone.ownerId)
                .where('date', '>', milestone.date)
                .orderBy('date', 'asc')
        ),
    ])

    const sameDateMilestones = mapDocs(sameDateSnapshot)
    const allBaseGoals = mapDocs(baseGoalSnapshot)
    const matchingGoals = allBaseGoals.filter(goal => normalizeGoalScheduleMode(goal.scheduleMode) === scheduleMode)
    let nextMilestone = mapDocs(nextMilestoneSnapshot).find(
        item => normalizeMilestoneType(item.milestoneType) === milestoneType
    )
    let createdNextMilestone = null
    if (!nextMilestone && milestoneType === MILESTONE_TYPE_LINEAR) {
        const config = normalizeGoalMilestonesConfig(project.goalMilestonesConfig)
        const nextPeriod = getLinearMilestonePeriods(config, (milestone.periodEndDate || milestone.date) + 1, 1)[0]
        const nextRef = milestones.doc()
        createdNextMilestone = {
            id: nextRef.id,
            ref: nextRef,
            ...buildLinearMilestone(nextPeriod, milestone.ownerId, now),
        }
        nextMilestone = createdNextMilestone
    }
    const existingDoneMilestone = sameDateMilestones.find(
        item =>
            item.id !== milestoneId &&
            item.done === true &&
            normalizeMilestoneType(item.milestoneType) === milestoneType
    )
    const existingDoneGoalSnapshot = existingDoneMilestone
        ? await transaction.get(goals.where('parentDoneMilestoneIds', 'array-contains', existingDoneMilestone.id))
        : { docs: [] }
    const existingDoneGoals = mapDocs(existingDoneGoalSnapshot)

    const accumulator = createGoalAccumulator(db, projectId, actorUserId, now, createSortIndex)
    existingDoneGoals.forEach(goal => {
        accumulator.removeDoneHistory(goal, existingDoneMilestone.id)
        accumulator.addDoneHistory(goal, milestoneId, milestone.date, now)
    })

    matchingGoals.forEach(goal => {
        accumulator.addDoneHistory(goal, milestoneId, milestone.date, now)
        if (isGoalCompleted(goal)) return

        const nextDate = nextMilestone?.date || BACKLOG_DATE_NUMERIC
        const moveFullGoal =
            goal.startingMilestoneDate === goal.completionMilestoneDate || nextDate < goal.startingMilestoneDate
        accumulator.setFields(goal, {
            ...(moveFullGoal ? { startingMilestoneDate: nextDate } : {}),
            completionMilestoneDate: nextDate,
            assigneesReminderDate: updateAssigneesReminderDate(goal.assigneesIds, nextDate),
        })
        accumulator.addSortIndex(goal, nextMilestone?.id || `${BACKLOG_MILESTONE_ID}${projectId}`)
    })

    let createdFixedMilestone = null
    if (milestoneType === MILESTONE_TYPE_LINEAR) {
        const fixedGoals = allBaseGoals.filter(
            goal => normalizeGoalScheduleMode(goal.scheduleMode) === GOAL_SCHEDULE_MODE_FIXED
        )
        const fixedMilestone = sameDateMilestones.find(
            item => item.done === false && normalizeMilestoneType(item.milestoneType) === MILESTONE_TYPE_FIXED
        )
        if (fixedGoals.length > 0) {
            createdFixedMilestone = fixedMilestone || {
                id: milestones.doc().id,
                ...buildOpenMilestone({ ...milestone, milestoneType: MILESTONE_TYPE_FIXED }, now),
            }
            fixedGoals.forEach(goal => accumulator.addSortIndex(goal, createdFixedMilestone.id))
        }
    }

    const writeCount =
        accumulator.size +
        1 +
        (existingDoneMilestone ? 1 : 0) +
        (createdFixedMilestone?.ref ? 0 : createdFixedMilestone ? 1 : 0) +
        (createdNextMilestone ? 1 : 0)
    if (writeCount > MAX_TRANSACTION_WRITES) {
        throw new MilestoneDoneError('failed-precondition', 'This milestone contains too many goals to update at once')
    }

    accumulator.write(transaction)
    transaction.update(milestoneRef, { done: true, doneDate: now })
    if (existingDoneMilestone) transaction.delete(existingDoneMilestone.ref)
    if (createdFixedMilestone && !createdFixedMilestone.ref) {
        const { id, ...data } = createdFixedMilestone
        transaction.set(milestones.doc(id), data)
    }
    if (createdNextMilestone) {
        const { id, ref, ...data } = createdNextMilestone
        transaction.set(ref, data)
    }

    return {
        success: true,
        duplicate: false,
        done: true,
        updatedGoalCount: accumulator.size,
    }
}

async function moveToOpen({
    transaction,
    db,
    projectId,
    milestoneId,
    milestone,
    milestoneRef,
    actorUserId,
    now,
    createSortIndex,
}) {
    const milestoneType = normalizeMilestoneType(milestone.milestoneType)
    const scheduleMode = scheduleModeForMilestone(milestoneType)
    const milestones = db.collection(`goalsMilestones/${projectId}/milestonesItems`)
    const goals = db.collection(`goals/${projectId}/items`)

    const [doneGoalSnapshot, sameDateSnapshot, openMilestoneSnapshot, baseGoalSnapshot] = await Promise.all([
        transaction.get(goals.where('parentDoneMilestoneIds', 'array-contains', milestoneId)),
        transaction.get(milestones.where('date', '==', milestone.date).where('ownerId', '==', milestone.ownerId)),
        transaction.get(milestones.where('done', '==', false).where('ownerId', '==', milestone.ownerId)),
        transaction.get(
            goals.where('completionMilestoneDate', '==', milestone.date).where('ownerId', '==', milestone.ownerId)
        ),
    ])

    const doneGoals = mapDocs(doneGoalSnapshot)
    const goalsToMove = doneGoals.filter(
        goal =>
            goal.completionMilestoneDate !== BACKLOG_DATE_NUMERIC ||
            goal.progress !== DYNAMIC_PERCENT ||
            goal.dynamicProgress !== 100
    )
    const sameDateMilestones = mapDocs(sameDateSnapshot)
    const openMilestones = mapDocs(openMilestoneSnapshot)
    const baseGoals = mapDocs(baseGoalSnapshot).filter(
        goal => normalizeGoalScheduleMode(goal.scheduleMode) === scheduleMode
    )
    const sameDateOpenMilestone = sameDateMilestones.find(
        item =>
            item.id !== milestoneId &&
            item.done === false &&
            normalizeMilestoneType(item.milestoneType) === milestoneType
    )
    const goalsWithoutOpenMilestone = goalsToMove.filter(goal => {
        const goalType = milestoneTypeForGoal(goal)
        return !openMilestones.some(
            openMilestone =>
                normalizeMilestoneType(openMilestone.milestoneType) === goalType &&
                openMilestone.date >= goal.startingMilestoneDate &&
                openMilestone.date <= goal.completionMilestoneDate
        )
    })
    const allDoneGoalsMove = doneGoals.length === goalsToMove.length

    let targetOpenMilestone = sameDateOpenMilestone
    let deleteDoneMilestone = !!sameDateOpenMilestone && allDoneGoalsMove
    let reopenDoneMilestone = false
    let createdOpenMilestone = null

    if (!targetOpenMilestone) {
        if (baseGoals.length === 0 && goalsWithoutOpenMilestone.length === 0) {
            deleteDoneMilestone = allDoneGoalsMove
        } else if (allDoneGoalsMove) {
            targetOpenMilestone = milestone
            reopenDoneMilestone = true
        } else {
            createdOpenMilestone = { id: milestones.doc().id, ...buildOpenMilestone(milestone, now) }
            targetOpenMilestone = createdOpenMilestone
        }
    }

    const accumulator = createGoalAccumulator(db, projectId, actorUserId, now, createSortIndex)
    goalsToMove.forEach(goal => {
        accumulator.removeDoneHistory(goal, milestoneId)
        if (goal.progress === 100) accumulator.setFields(goal, { progress: 80 })
    })
    if (targetOpenMilestone) {
        goalsWithoutOpenMilestone.forEach(goal => {
            accumulator.setFields(goal, {
                startingMilestoneDate: targetOpenMilestone.date,
                completionMilestoneDate: targetOpenMilestone.date,
                assigneesReminderDate: updateAssigneesReminderDate(goal.assigneesIds, targetOpenMilestone.date),
            })
            accumulator.addSortIndex(goal, targetOpenMilestone.id)
        })
        if (reopenDoneMilestone || createdOpenMilestone) {
            baseGoals.forEach(goal => accumulator.addSortIndex(goal, targetOpenMilestone.id))
        }
    }

    const writeCount = accumulator.size + 1 + (createdOpenMilestone ? 1 : 0)
    if (writeCount > MAX_TRANSACTION_WRITES) {
        throw new MilestoneDoneError('failed-precondition', 'This milestone contains too many goals to update at once')
    }

    accumulator.write(transaction)
    if (deleteDoneMilestone) transaction.delete(milestoneRef)
    else if (reopenDoneMilestone) transaction.update(milestoneRef, { done: false })
    if (createdOpenMilestone) {
        const { id, ...data } = createdOpenMilestone
        transaction.set(milestones.doc(id), data)
    }

    return {
        success: true,
        duplicate: false,
        done: false,
        updatedGoalCount: accumulator.size,
    }
}

async function executeMilestoneDoneTransition({
    actorUserId,
    data,
    db = admin.firestore(),
    now = Date.now(),
    createSortIndex = generateSortIndex,
}) {
    if (!actorUserId) throw new MilestoneDoneError('permission-denied', 'Authentication required')
    const request = normalizeRequest(data)
    const { projectId, milestoneId, targetDone } = request

    let project
    try {
        await assertProjectAccess(db, actorUserId, projectId)
        const projectSnapshot = await db.collection('projects').doc(projectId).get()
        project = projectSnapshot.data() || {}
    } catch (_error) {
        throw new MilestoneDoneError('permission-denied', 'No access to project')
    }

    const milestoneRef = db.doc(`goalsMilestones/${projectId}/milestonesItems/${milestoneId}`)
    return db.runTransaction(async transaction => {
        const milestoneSnapshot = await transaction.get(milestoneRef)
        if (!milestoneSnapshot.exists) throw new MilestoneDoneError('not-found', 'Milestone not found')

        const milestone = { id: milestoneId, ref: milestoneRef, ...milestoneSnapshot.data() }
        if (milestone.done === targetDone) {
            return { success: true, duplicate: true, done: targetDone, updatedGoalCount: 0 }
        }

        const params = {
            transaction,
            db,
            projectId,
            milestoneId,
            milestone,
            milestoneRef,
            actorUserId,
            project,
            now,
            createSortIndex,
        }
        return targetDone ? moveToDone(params) : moveToOpen(params)
    })
}

module.exports = {
    MilestoneDoneError,
    executeMilestoneDoneTransition,
    normalizeRequest,
}
