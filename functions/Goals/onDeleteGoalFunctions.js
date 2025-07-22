const admin = require('firebase-admin')

const { deleteRecord, GOALS_OBJECTS_TYPE } = require('../AlgoliaGlobalSearchHelper')
const { removeObjectFromBacklinks } = require('../Backlinks/backlinksHelper')
const { deleteChat } = require('../Chats/chatsFirestoreCloud')
const { deleteNote } = require('../Notes/notesFirestoreCloud')
const { checkIfOpenMilestoneIsEmpty, checkIfDoneMilestoneIsEmpty } = require('./goalsFirestore')

const BACKLOG_DATE_NUMERIC = Number.MAX_SAFE_INTEGER

const removeGoalFromTasks = async (projectId, goalId) => {
    const taskDocs = await admin
        .firestore()
        .collection(`/items/${projectId}/tasks`)
        .where('parentGoalId', '==', goalId)
        .get()
    const promises = []
    taskDocs.forEach(doc => {
        promises.push(
            admin
                .firestore()
                .doc(`items/${projectId}/tasks/${doc.id}`)
                .update({ parentGoalId: null, parentGoalIsPublicFor: null, lockKey: '' })
        )
    })
    await Promise.all(promises)
}

const deleteMilestone = async (projectId, milestoneId) => {
    await admin.firestore().doc(`goalsMilestones/${projectId}/milestonesItems/${milestoneId}`).delete()
}

const getOpenMilestoneIdUsingDate = async (projectId, date, ownerId) => {
    const milestoneDoc = (
        await admin
            .firestore()
            .collection(`goalsMilestones/${projectId}/milestonesItems`)
            .where('date', '==', date)
            .where('done', '==', false)
            .where('ownerId', '==', ownerId)
            .limit(1)
            .get()
    ).docs[0]
    return milestoneDoc ? milestoneDoc.id : null
}

const deleteOpenMilestoneIfIsEmpty = async (projectId, milestoneDate, ownerId) => {
    if (milestoneDate === BACKLOG_DATE_NUMERIC) return
    const isEmpty = await checkIfOpenMilestoneIsEmpty(projectId, milestoneDate, ownerId)
    if (isEmpty) {
        const milestoneId = await getOpenMilestoneIdUsingDate(projectId, milestoneDate, ownerId)
        if (milestoneId) await deleteMilestone(projectId, milestoneId)
    }
}

const deleteDoneMilestoneIfIsEmpty = async (projectId, milestoneId) => {
    const isEmpty = await checkIfDoneMilestoneIsEmpty(projectId, milestoneId)
    if (isEmpty) await deleteMilestone(projectId, milestoneId)
}

const deleteDoneMilestonesIfAreEmpty = async (projectId, milestoneIds) => {
    const promises = []
    milestoneIds.forEach(milestoneId => {
        promises.push(deleteDoneMilestoneIfIsEmpty(projectId, milestoneId))
    })
    await Promise.all(promises)
}

const onDeleteGoal = async (projectId, goal) => {
    const {
        id: goalId,
        noteId,
        ownerId,
        completionMilestoneDate,
        parentDoneMilestoneIds,
        movingToOtherProjectId,
    } = goal

    const promises = []
    promises.push(deleteChat(admin, projectId, goalId))
    if (noteId) promises.push(deleteNote(projectId, noteId, movingToOtherProjectId, admin))
    promises.push(removeGoalFromTasks(projectId, goalId))
    promises.push(deleteOpenMilestoneIfIsEmpty(projectId, completionMilestoneDate, ownerId))
    promises.push(deleteDoneMilestonesIfAreEmpty(projectId, parentDoneMilestoneIds))
    if (!movingToOtherProjectId)
        promises.push(removeObjectFromBacklinks(projectId, 'linkedParentGoalsIds', goalId, admin))
    promises.push(deleteRecord(goalId, projectId, GOALS_OBJECTS_TYPE))
    await Promise.all(promises)
}

module.exports = {
    onDeleteGoal,
}
