const moment = require('moment')
const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { BACKLOG_DATE_NUMERIC } = require('../Utils/HelperFunctionsCloud')
const { updateGoalData } = require('../Goals/goalsFirestore')

const updateTaskDates = (projectId, taskDoc, admin, batch) => {
    const { dueDate, dueDateByObserversIds } = taskDoc.data()

    const updateData = { dueDate, dueDateByObserversIds: { ...dueDateByObserversIds } }
    if (dueDate !== BACKLOG_DATE_NUMERIC) {
        updateData.dueDate = moment(dueDate).add(1, 'days').startOf('day').hour(12).minute(0).valueOf()
    }

    Object.keys(dueDateByObserversIds).forEach(uid => {
        if (dueDateByObserversIds[uid] !== BACKLOG_DATE_NUMERIC) {
            updateData.dueDateByObserversIds[uid] = moment(dueDateByObserversIds[uid])
                .add(1, 'days')
                .startOf('day')
                .hour(12)
                .minute(0)
                .valueOf()
        }
    })

    batch.update(admin.firestore().doc(`items/${projectId}/tasks/${taskDoc.id}`), updateData)
}

const updateGoalDates = (projectId, goalDoc, admin, batch) => {
    const { completionMilestoneDate, startingMilestoneDate, assigneesReminderDate } = goalDoc.data()

    const updateData = {
        completionMilestoneDate,
        startingMilestoneDate,
        assigneesReminderDate: { ...assigneesReminderDate },
    }

    if (completionMilestoneDate !== BACKLOG_DATE_NUMERIC) {
        updateData.completionMilestoneDate = moment(completionMilestoneDate)
            .add(1, 'days')
            .startOf('day')
            .hour(12)
            .minute(0)
            .valueOf()
    }
    if (startingMilestoneDate !== BACKLOG_DATE_NUMERIC) {
        updateData.startingMilestoneDate = moment(startingMilestoneDate)
            .add(1, 'days')
            .startOf('day')
            .hour(12)
            .minute(0)
            .valueOf()
    }

    Object.keys(assigneesReminderDate).forEach(uid => {
        if (assigneesReminderDate[uid] !== BACKLOG_DATE_NUMERIC) {
            updateData.assigneesReminderDate[uid] = moment(assigneesReminderDate[uid])
                .add(1, 'days')
                .startOf('day')
                .hour(12)
                .minute(0)
                .valueOf()
        }
    })

    updateGoalData(projectId, goalDoc.id, updateData, batch)
}

const updateMilestoneDates = (projectId, milestoneDoc, admin, batch) => {
    const { date } = milestoneDoc.data()

    const updateData = {
        date,
    }

    if (date !== BACKLOG_DATE_NUMERIC) {
        updateData.date = moment(date).add(1, 'days').startOf('day').hour(12).minute(0).valueOf()
    }

    batch.update(admin.firestore().doc(`goalsMilestones/${projectId}/milestonesItems/${milestoneDoc.id}`), updateData)
}

const updateProjectDates = async (projectId, admin) => {
    const promises = []
    promises.push(
        admin
            .firestore()
            .collection(`items/${projectId}/tasks`)
            .where('isSubtask', '==', false)
            .where('done', '==', false)
            .get()
    )
    promises.push(
        admin
            .firestore()
            .collection(`items/${projectId}/tasks`)
            .where('isSubtask', '==', true)
            .where('parentDone', '==', false)
            .get()
    )
    promises.push(admin.firestore().collection(`goals/${projectId}/items`).get())
    promises.push(
        admin.firestore().collection(`goalsMilestones/${projectId}/milestonesItems`).where('done', '==', false).get()
    )
    const [taskDocs, subtaskDocs, goalDocs, milestoneDocs] = await Promise.all(promises)

    const batch = new BatchWrapper(admin.firestore())
    taskDocs.forEach(doc => {
        updateTaskDates(projectId, doc, admin, batch)
    })
    subtaskDocs.forEach(doc => {
        updateTaskDates(projectId, doc, admin, batch)
    })
    goalDocs.forEach(doc => {
        updateGoalDates(projectId, doc, admin, batch)
    })
    milestoneDocs.forEach(doc => {
        updateMilestoneDates(projectId, doc, admin, batch)
    })
    await batch.commit()
}

const updateTemplatesObjectsDates = async admin => {
    const templateDocs = await admin.firestore().collection('projects').where('isTemplate', '==', true).get()
    const promises = []
    templateDocs.forEach(doc => {
        promises.push(updateProjectDates(doc.id, admin))
    })
    await Promise.all(promises)
}

module.exports = { updateTemplatesObjectsDates }
