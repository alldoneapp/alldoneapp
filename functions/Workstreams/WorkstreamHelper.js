const { isEqual } = require('lodash')
const moment = require('moment')

const DEFAULT_WORKSTREAM_ID = 'ws@default'
const FEED_PUBLIC_FOR_ALL = 0

const onRemoveWorkstream = async (admin, projectId, streamId) => {
    const db = admin.firestore()
    const promises = []

    const updateFields = (tasksDocs, checkSubtasks = false) => {
        tasksDocs.forEach(async taskDoc => {
            if (taskDoc.exists) {
                const updatedTask = {
                    userIds: taskDoc.data().userIds,
                    isPublicFor: taskDoc.data().isPublicFor,
                    userId: DEFAULT_WORKSTREAM_ID,
                    currentReviewerId: DEFAULT_WORKSTREAM_ID,
                }

                let tmpIndex
                // update "userIds" field
                tmpIndex = updatedTask.userIds.indexOf(streamId)
                if (tmpIndex >= 0) updatedTask.userIds[tmpIndex] = DEFAULT_WORKSTREAM_ID

                // update "isPublicFor" field
                tmpIndex = updatedTask.isPublicFor.indexOf(streamId)
                if (tmpIndex >= 0) updatedTask.isPublicFor[tmpIndex] = DEFAULT_WORKSTREAM_ID

                promises.push(taskDoc.ref.update(updatedTask))

                if (checkSubtasks) {
                    // Pass all its subtasks to the default Workstream
                    const subtasksDocs = (
                        await db.collection(`/items/${projectId}/tasks`).where('parentId', '==', taskDoc.id).get()
                    ).docs
                    updateFields(subtasksDocs)
                }
            }
        })
    }

    // Pass all its tasks to the default Workstream
    const tasksDocs = (await db.collection(`/items/${projectId}/tasks`).where('userId', '==', streamId).get()).docs
    updateFields(tasksDocs, true)

    const promisesData = []
    promisesData.push(
        db.collection(`/goals/${projectId}/items`).where('assigneesIds', 'array-contains-any', [streamId]).get()
    )
    promisesData.push(db.doc(`/projectsWorkstreams/${projectId}/workstreams/${DEFAULT_WORKSTREAM_ID}`).get())
    const results = await Promise.all(promisesData)

    const goalsDocs = results[0].docs
    const defaultWorkstream = results[1].data()

    goalsDocs.forEach(goalDoc => {
        const goal = goalDoc.data()
        const { assigneesIds, assigneesCapacity, assigneesReminderDate, isPublicFor } = goal

        let newAssigneesIds = [...assigneesIds]
        let newAssigneesCapacity = { ...assigneesCapacity }
        let newAssigneesReminderDate = { ...assigneesReminderDate }
        let newIsPublicFor = isPublicFor.filter(id => id !== streamId)

        if (newAssigneesIds.length === 1) {
            newAssigneesIds = [DEFAULT_WORKSTREAM_ID]
            newAssigneesCapacity = { [DEFAULT_WORKSTREAM_ID]: 'CAPACITY_NONE' }
            newAssigneesReminderDate = { [DEFAULT_WORKSTREAM_ID]: Date.now() }
            if (!newIsPublicFor.includes(FEED_PUBLIC_FOR_ALL) && !newIsPublicFor.includes(DEFAULT_WORKSTREAM_ID)) {
                newIsPublicFor.push(DEFAULT_WORKSTREAM_ID)
                defaultWorkstream.userIds.forEach(userId => {
                    if (!newIsPublicFor.includes(userId)) newIsPublicFor.push(userId)
                })
            }
        } else {
            newAssigneesIds = newAssigneesIds.filter(id => id !== streamId)
            delete newAssigneesCapacity[streamId]
            delete newAssigneesReminderDate[streamId]
        }

        if (!isEqual(isPublicFor, newIsPublicFor)) {
            db.collection(`/items/${projectId}/tasks`)
                .where('parentGoalId', '==', goalDoc.id)
                .get()
                .then(docs => {
                    docs.forEach(doc => {
                        db.doc(`items/${projectId}/tasks/${doc.id}`).update({ parentGoalIsPublicFor: newIsPublicFor })
                    })
                })
        }

        promises.push(
            goalDoc.ref.update({
                assigneesIds: newAssigneesIds,
                assigneesCapacity: newAssigneesCapacity,
                assigneesReminderDate: newAssigneesReminderDate,
                isPublicFor: newIsPublicFor,
            })
        )
    })

    return await Promise.all(promises)
}

module.exports = {
    DEFAULT_WORKSTREAM_ID,
    onRemoveWorkstream,
}
