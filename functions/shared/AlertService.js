const admin = require('firebase-admin')
const moment = require('moment')

/**
 * Minimal server-side alert updater for tasks (Cloud Functions context).
 * - Updates task.alertEnabled
 * - When enabling and alertMoment provided, aligns task.dueDate to alert time in the user's timezone
 *
 * @param {string} projectId
 * @param {string} taskId
 * @param {boolean} alertEnabled
 * @param {import('moment').Moment} alertMoment
 * @param {Object} task Optional current task snapshot to avoid refetch
 */
async function setTaskAlertCloud(projectId, taskId, alertEnabled, alertMoment, task) {
    try {
        const db = admin.firestore()
        const taskRef = db.doc(`items/${projectId}/tasks/${taskId}`)

        let currentTask = task
        if (!currentTask) {
            const snap = await taskRef.get()
            if (!snap.exists) throw new Error('Task not found')
            currentTask = { id: taskId, ...snap.data() }
        }

        const updateData = { alertEnabled: !!alertEnabled }

        if (alertEnabled && alertMoment) {
            let baseDate = currentTask.dueDate ? moment(currentTask.dueDate) : moment()
            if (typeof alertMoment.utcOffset === 'function') {
                baseDate = baseDate.utcOffset(alertMoment.utcOffset())
            }

            const newDueDate = baseDate
                .clone()
                .hour(alertMoment.hour())
                .minute(alertMoment.minute())
                .second(0)
                .millisecond(0)
                .valueOf()

            updateData.dueDate = newDueDate
        }

        await taskRef.update(updateData)

        console.log('🔔 setTaskAlertCloud: updated alert', {
            projectId,
            taskId,
            alertEnabled: updateData.alertEnabled,
            alertTime: alertMoment && alertMoment.format ? alertMoment.format('YYYY-MM-DD HH:mm:ss Z') : null,
            dueDate: updateData.dueDate || currentTask.dueDate || null,
        })
    } catch (error) {
        console.error('setTaskAlertCloud failed:', error.message)
        throw error
    }
}

module.exports = { setTaskAlertCloud }
