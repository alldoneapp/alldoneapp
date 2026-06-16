const admin = require('firebase-admin')

const { ALL_USERS, BACKLOG_DATE_NUMERIC, DYNAMIC_PERCENT, generateSortIndex } = require('../Utils/HelperFunctionsCloud')
const {
    GOAL_MILESTONES_MODE_LINEAR,
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

function getDb() {
    return admin.firestore()
}

function getMilestonesCollection(projectId) {
    return getDb().collection(`goalsMilestones/${projectId}/milestonesItems`)
}

function getGoalsCollection(projectId) {
    return getDb().collection(`goals/${projectId}/items`)
}

function mapDoc(doc) {
    return { id: doc.id, ...doc.data() }
}

function buildLinearMilestoneData(period, ownerId, done = false, now = Date.now()) {
    return {
        extendedName: getLinearMilestoneTitle(period),
        created: now,
        date: period.date,
        done,
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

function buildFixedMilestoneData(date, ownerId, now = Date.now()) {
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

function updateAssigneesReminderDate(assigneesIds = [], date) {
    const assigneesReminderDate = {}
    assigneesIds.forEach(assigneeId => {
        assigneesReminderDate[assigneeId] = date
    })
    return assigneesReminderDate
}

function isGoalCompleted(goal) {
    return goal.progress === 100 || (goal.progress === DYNAMIC_PERCENT && goal.dynamicProgress === 100)
}

async function getLinearMilestoneByPeriodKey(projectId, ownerId, periodKey, done) {
    const docs = (
        await getMilestonesCollection(projectId)
            .where('ownerId', '==', ownerId)
            .where('done', '==', done)
            .where('periodKey', '==', periodKey)
            .limit(1)
            .get()
    ).docs

    const doc = docs.find(doc => normalizeMilestoneType(doc.data().milestoneType) === MILESTONE_TYPE_LINEAR)
    return doc ? mapDoc(doc) : null
}

async function ensureLinearMilestoneForPeriod(projectId, ownerId, period, done = false, now = Date.now()) {
    const existingMilestone = await getLinearMilestoneByPeriodKey(projectId, ownerId, period.periodKey, done)
    if (existingMilestone) return existingMilestone

    const ref = getMilestonesCollection(projectId).doc()
    const milestone = buildLinearMilestoneData(period, ownerId, done, now)
    await ref.set(milestone)
    return { id: ref.id, ...milestone }
}

async function ensureCurrentLinearMilestonesForOwner(projectId, ownerId, config, now = Date.now()) {
    const periods = getLinearMilestonePeriods(config, now, config.futureMilestonesToCreate + 1)
    const milestones = []
    for (const period of periods) {
        milestones.push(await ensureLinearMilestoneForPeriod(projectId, ownerId, period, false, now))
    }
    return milestones
}

async function getOpenLinearMilestonesForOwner(projectId, ownerId) {
    const docs = (
        await getMilestonesCollection(projectId)
            .where('ownerId', '==', ownerId)
            .where('done', '==', false)
            .where('milestoneType', '==', MILESTONE_TYPE_LINEAR)
            .get()
    ).docs

    return docs.map(mapDoc)
}

async function getGoalsByCompletionDate(projectId, ownerId, milestoneDate) {
    const docs = (
        await getGoalsCollection(projectId)
            .where('completionMilestoneDate', '==', milestoneDate)
            .where('ownerId', '==', ownerId)
            .get()
    ).docs

    return docs.map(mapDoc)
}

async function getLinearOwnerIds(projectId, project) {
    const ownerIds = new Set()
    if (project.parentTemplateId) {
        ;(project.userIds || []).forEach(userId => ownerIds.add(userId))
    } else {
        ownerIds.add(ALL_USERS)
    }

    const [milestoneDocs, dynamicGoalDocs] = await Promise.all([
        getMilestonesCollection(projectId).where('milestoneType', '==', MILESTONE_TYPE_LINEAR).get(),
        getGoalsCollection(projectId).where('scheduleMode', '==', GOAL_SCHEDULE_MODE_DYNAMIC).get(),
    ])

    milestoneDocs.docs.forEach(doc => {
        const ownerId = doc.data().ownerId
        if (ownerId) ownerIds.add(ownerId)
    })
    dynamicGoalDocs.docs.forEach(doc => {
        const ownerId = doc.data().ownerId
        if (ownerId) ownerIds.add(ownerId)
    })

    if (ownerIds.size === 0) ownerIds.add(ALL_USERS)
    return Array.from(ownerIds)
}

async function ensureFixedMilestoneForGoals(projectId, ownerId, milestoneDate, fixedGoals, now = Date.now()) {
    if (fixedGoals.length === 0 || milestoneDate === BACKLOG_DATE_NUMERIC) return null

    const docs = (
        await getMilestonesCollection(projectId)
            .where('date', '==', milestoneDate)
            .where('done', '==', false)
            .where('ownerId', '==', ownerId)
            .get()
    ).docs

    const existingFixedDoc = docs.find(doc => normalizeMilestoneType(doc.data().milestoneType) === MILESTONE_TYPE_FIXED)
    let milestoneId = existingFixedDoc?.id

    if (!milestoneId) {
        const ref = getMilestonesCollection(projectId).doc()
        milestoneId = ref.id
        await ref.set(buildFixedMilestoneData(milestoneDate, ownerId, now))
    }

    for (const goal of fixedGoals) {
        await getGoalsCollection(projectId)
            .doc(goal.id)
            .set(
                {
                    sortIndexByMilestone: {
                        [milestoneId]: goal.sortIndexByMilestone?.[milestoneId] || generateSortIndex(),
                    },
                },
                { merge: true }
            )
    }

    return milestoneId
}

async function addGoalsToDoneMilestone(projectId, milestoneId, milestoneDate, doneDate, goals) {
    for (const goal of goals) {
        await getGoalsCollection(projectId)
            .doc(goal.id)
            .update({
                parentDoneMilestoneIds: admin.firestore.FieldValue.arrayUnion(milestoneId),
                [`progressByDoneMilestone.${milestoneId}`]: {
                    progress: goal.progress === DYNAMIC_PERCENT ? goal.dynamicProgress : goal.progress,
                    doneDate,
                },
                [`dateByDoneMilestone.${milestoneId}`]: milestoneDate,
            })
    }
}

async function rollUnfinishedGoalsToNextMilestone(projectId, goals, nextMilestone) {
    for (const goal of goals) {
        if (isGoalCompleted(goal)) continue

        const nextDate = nextMilestone.date
        const moveFullGoal =
            goal.startingMilestoneDate === goal.completionMilestoneDate || nextDate < goal.startingMilestoneDate
        const dateUpdate = moveFullGoal
            ? {
                  startingMilestoneDate: nextDate,
                  completionMilestoneDate: nextDate,
              }
            : { completionMilestoneDate: nextDate }

        await getGoalsCollection(projectId)
            .doc(goal.id)
            .update({
                ...dateUpdate,
                scheduleMode: GOAL_SCHEDULE_MODE_DYNAMIC,
                assigneesReminderDate: updateAssigneesReminderDate(goal.assigneesIds, nextDate),
                [`sortIndexByMilestone.${nextMilestone.id}`]:
                    goal.sortIndexByMilestone?.[nextMilestone.id] || generateSortIndex(),
            })
    }
}

async function closeExpiredLinearMilestone(projectId, ownerId, config, milestone, now = Date.now()) {
    const allGoals = await getGoalsByCompletionDate(projectId, ownerId, milestone.date)
    const dynamicGoals = allGoals.filter(
        goal => normalizeGoalScheduleMode(goal.scheduleMode) === GOAL_SCHEDULE_MODE_DYNAMIC
    )
    const fixedGoals = allGoals.filter(
        goal => normalizeGoalScheduleMode(goal.scheduleMode) === GOAL_SCHEDULE_MODE_FIXED
    )
    const nextPeriod = getLinearMilestonePeriods(config, milestone.periodEndDate + 1, 1)[0]
    const nextMilestone = await ensureLinearMilestoneForPeriod(projectId, ownerId, nextPeriod, false, now)
    const doneDate = now

    await ensureFixedMilestoneForGoals(projectId, ownerId, milestone.date, fixedGoals, now)

    const existingDoneMilestone = await getLinearMilestoneByPeriodKey(projectId, ownerId, milestone.periodKey, true)
    const doneMilestoneId = existingDoneMilestone?.id || milestone.id

    if (dynamicGoals.length > 0) {
        await addGoalsToDoneMilestone(projectId, doneMilestoneId, milestone.date, doneDate, dynamicGoals)
        await rollUnfinishedGoalsToNextMilestone(projectId, dynamicGoals, nextMilestone)
    }

    if (existingDoneMilestone) {
        await getMilestonesCollection(projectId).doc(milestone.id).delete()
    } else {
        await getMilestonesCollection(projectId)
            .doc(milestone.id)
            .update({
                done: true,
                doneDate,
                milestoneType: MILESTONE_TYPE_LINEAR,
                periodStartDate: milestone.periodStartDate,
                periodEndDate: milestone.periodEndDate,
                periodKey: milestone.periodKey,
                cadence: milestone.cadence || config.cadence,
            })
    }

    return {
        closed: true,
        dynamicGoals: dynamicGoals.length,
        fixedGoals: fixedGoals.length,
        rolledGoals: dynamicGoals.filter(goal => !isGoalCompleted(goal)).length,
    }
}

async function processLinearProject(projectId, project, now = Date.now()) {
    if (project.active === false) return { projectId, skipped: true }

    const config = normalizeGoalMilestonesConfig(
        project.goalMilestonesConfig,
        project.goalMilestonesConfig?.timezone || 'UTC'
    )
    if (config.mode !== GOAL_MILESTONES_MODE_LINEAR) return { projectId, skipped: true }

    const ownerIds = await getLinearOwnerIds(projectId, project)
    const result = { projectId, owners: ownerIds.length, ensuredMilestones: 0, closedMilestones: 0, rolledGoals: 0 }

    for (const ownerId of ownerIds) {
        const ensuredMilestones = await ensureCurrentLinearMilestonesForOwner(projectId, ownerId, config, now)
        result.ensuredMilestones += ensuredMilestones.length

        const openMilestones = await getOpenLinearMilestonesForOwner(projectId, ownerId)
        const expiredMilestones = openMilestones.filter(
            milestone => milestone.periodEndDate && milestone.periodEndDate < now
        )

        for (const milestone of expiredMilestones) {
            const closeResult = await closeExpiredLinearMilestone(projectId, ownerId, config, milestone, now)
            if (closeResult.closed) result.closedMilestones += 1
            result.rolledGoals += closeResult.rolledGoals
        }
    }

    return result
}

async function processLinearGoalMilestones(now = Date.now()) {
    const projectDocs = (
        await getDb().collection('projects').where('goalMilestonesConfig.mode', '==', GOAL_MILESTONES_MODE_LINEAR).get()
    ).docs

    const results = []
    for (const doc of projectDocs) {
        results.push(await processLinearProject(doc.id, doc.data(), now))
    }
    return results
}

module.exports = {
    buildFixedMilestoneData,
    buildLinearMilestoneData,
    closeExpiredLinearMilestone,
    ensureCurrentLinearMilestonesForOwner,
    ensureFixedMilestoneForGoals,
    getLinearOwnerIds,
    isGoalCompleted,
    processLinearGoalMilestones,
    processLinearProject,
    rollUnfinishedGoalsToNextMilestone,
}
