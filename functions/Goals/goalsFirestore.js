const admin = require('firebase-admin')

const {
    BACKLOG_DATE_NUMERIC,
    DYNAMIC_PERCENT,
    BACKLOG_MILESTONE_ID,
    generateSortIndex,
} = require('../Utils/HelperFunctionsCloud')
const { mapMilestoneData, mapGoalData } = require('../Utils/MapDataFuncions')
const { createGoalUpdatesChain } = require('../Feeds/goalsFeedsChains')
const { logEvent } = require('../GAnalytics/GAnalytics')

//ACCESS FUNCTIONS

async function getGoalData(projectId, goalId) {
    const goalData = (await admin.firestore().doc(`goals/${projectId}/items/${goalId}`).get()).data()
    if (goalData) goalData.id = goalId
    return goalData
}

async function getAllGoalsAssignedToUser(projectId, userId) {
    const goalsDocs = (
        await admin
            .firestore()
            .collection(`goals/${projectId}/items`)
            .where('assigneesIds', 'array-contains-any', [userId])
            .get()
    ).docs
    const goals = []
    goalsDocs.forEach(doc => {
        goals.push(mapGoalData(doc.id, doc.data()))
    })
    return goals
}

const getGoalTasks = async (projectId, goalId) => {
    const tasksDocs = (
        await admin
            .firestore()
            .collection(`/items/${projectId}/tasks`)
            .where('parentGoalId', '==', goalId)
            .where('parentId', '==', null)
            .get()
    ).docs

    const tasks = []
    tasksDocs.forEach(doc => {
        tasks.push(doc.data())
    })
    return tasks
}

async function getGoalTasksAndSubtasks(projectId, goalId) {
    const taskDocs = (
        await admin.firestore().collection(`items/${projectId}/tasks`).where('parentGoalId', '==', goalId).get()
    ).docs
    const tasks = []
    taskDocs.forEach(doc => {
        const task = doc.data()
        task.id = doc.id
        tasks.push(task)
    })
    return tasks
}

async function getMilestoneUsingDate(projectId, date, searchInDoneMilestones, ownerId) {
    const milestoneDoc = (
        await admin
            .firestore()
            .collection(`goalsMilestones/${projectId}/milestonesItems`)
            .where('date', '==', date)
            .where('done', '==', searchInDoneMilestones)
            .where('ownerId', '==', ownerId)
            .limit(1)
            .get()
    ).docs[0]
    return milestoneDoc ? mapMilestoneData(milestoneDoc.id, milestoneDoc.data()) : null
}

//EDTION AND ADITION FUNCTIONS

const updateGoalEditionData = async (projectId, goalId, editorId) => {
    try {
        await admin.firestore().runTransaction(async transaction => {
            const ref = admin.firestore().doc(`goals/${projectId}/items/${goalId}`)
            const goalDoc = await transaction.get(ref)
            if (goalDoc.exists) transaction.update(ref, { lastEditionDate: Date.now(), lastEditorId: editorId })
        })
    } catch (e) {
        console.log('Transaction failure:', e)
    }
}

async function updateGoalData(projectId, goalId, data, batch) {
    const ref = admin.firestore().doc(`goals/${projectId}/items/${goalId}`)
    batch ? batch.update(ref, data) : await ref.update(data)
}

async function uploadNewGoal(projectId, goal) {
    const goalCopy = { ...goal }
    delete goalCopy.id

    const promises = []
    promises.push(admin.firestore().doc(`goals/${projectId}/items/${goal.id}`).set(goalCopy))
    promises.push(createGoalUpdatesChain(projectId, goal, false, false))
    promises.push(logEvent('', 'new_goal', { id: goal.id, name: goal.name }))
    await Promise.all(promises)
}

async function updateGoalSortIndexes(projectId, goalId, milestoneId) {
    const sortIndexData = { [milestoneId]: generateSortIndex() }
    await admin
        .firestore()
        .doc(`goals/${projectId}/items/${goalId}`)
        .set({ sortIndexByMilestone: sortIndexData }, { merge: true })
}

const updateGoalDynamicProgressProperty = async (projectId, goalId, dynamicProgress) => {
    await admin.firestore().doc(`goals/${projectId}/items/${goalId}`).set({ dynamicProgress }, { merge: true })
}

const updateGoalDynamicProgress = async (projectId, goalId) => {
    let promises = []
    promises.push(admin.firestore().doc(`/goals/${projectId}/items/${goalId}`).get())
    promises.push(getGoalTasks(projectId, goalId))
    let results = await Promise.all(promises)

    if (!results[0].data()) return

    const goal = mapGoalData(goalId, results[0].data())
    const tasks = results[1]

    const dynamicProgress = getDynamicPorgress(tasks)

    promises = []
    promises.push(getMilestoneUsingDate(projectId, goal.completionMilestoneDate, false, goal.ownerId))
    promises.push(updateGoalDynamicProgressProperty(projectId, goalId, dynamicProgress))
    results = await Promise.all(promises)

    const openMilestone = results[0]

    if (
        dynamicProgress !== 100 &&
        !openMilestone &&
        goal.progress === DYNAMIC_PERCENT &&
        goal.dynamicProgress === 100
    ) {
        const updateData = {
            completionMilestoneDate: BACKLOG_DATE_NUMERIC,
            startingMilestoneDate: BACKLOG_DATE_NUMERIC,
        }
        const backlogId = `${BACKLOG_MILESTONE_ID}${projectId}`

        if (goal.completionMilestoneDate !== BACKLOG_DATE_NUMERIC) {
            updateData.assigneesReminderDate = updateAssigneesReminderDate(goal.assigneesIds, BACKLOG_DATE_NUMERIC)
        }

        promises = []
        promises.push(updateGoalData(projectId, goalId, updateData, null))
        promises.push(updateGoalSortIndexes(projectId, goalId, backlogId))
        await Promise.all(promises)
    }
}

//OTHERS FUNCTIONS

const updateAssigneesReminderDate = (assigneesIds, date) => {
    const assigneesReminderDate = {}
    assigneesIds.forEach(assigneeId => {
        assigneesReminderDate[assigneeId] = date
    })
    return assigneesReminderDate
}

const getDynamicPorgress = tasks => {
    const tasksAmount = tasks.length
    let doneTasksAmount = 0
    tasks.forEach(task => {
        if (task.done) doneTasksAmount++
    })

    const dynamicProgress = tasksAmount > 0 ? Math.round((doneTasksAmount / tasksAmount) * 100) : 0
    return dynamicProgress
}

const checkIfOpenMilestoneIsEmpty = async (projectId, milestoneDate, ownerId) => {
    const goalsDocs = (
        await admin
            .firestore()
            .collection(`goals/${projectId}/items`)
            .where('completionMilestoneDate', '==', milestoneDate)
            .where('ownerId', '==', ownerId)
            .limit(1)
            .get()
    ).docs
    return goalsDocs.length === 0
}

async function checkIfDoneMilestoneIsEmpty(projectId, milestoneId) {
    const goalsDocs = (
        await admin
            .firestore()
            .collection(`goals/${projectId}/items`)
            .where('parentDoneMilestoneIds', 'array-contains-any', [milestoneId])
            .limit(1)
            .get()
    ).docs
    return goalsDocs.length === 0
}

const updateGoalLastCommentData = async (projectId, goalId, lastComment, lastCommentType) => {
    try {
        await admin.firestore().runTransaction(async transaction => {
            const ref = admin.firestore().doc(`goals/${projectId}/items/${goalId}`)
            const goalDoc = await transaction.get(ref)
            if (goalDoc.exists)
                transaction.update(ref, {
                    [`commentsData.lastComment`]: lastComment,
                    [`commentsData.lastCommentType`]: lastCommentType,
                    [`commentsData.amount`]: admin.firestore.FieldValue.increment(1),
                })
        })
    } catch (e) {
        console.log('Transaction failure:', e)
    }
}

const resetGoalLastCommentData = async (projectId, goalId) => {
    try {
        await admin.firestore().runTransaction(async transaction => {
            const ref = admin.firestore().doc(`goals/${projectId}/items/${goalId}`)
            const goalDoc = await transaction.get(ref)
            if (goalDoc.exists)
                transaction.update(ref, {
                    [`commentsData.lastComment`]: null,
                    [`commentsData.lastCommentType`]: null,
                    [`commentsData.amount`]: 0,
                })
        })
    } catch (e) {
        console.log('Transaction failure:', e)
    }
}

module.exports = {
    getGoalData,
    getAllGoalsAssignedToUser,
    getGoalTasksAndSubtasks,
    uploadNewGoal,
    updateGoalData,
    updateGoalDynamicProgress,
    checkIfOpenMilestoneIsEmpty,
    checkIfDoneMilestoneIsEmpty,
    updateGoalEditionData,
    updateGoalLastCommentData,
    resetGoalLastCommentData,
}
