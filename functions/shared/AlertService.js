const admin = require('firebase-admin')
const moment = require('moment')

/**
 * Minimal server-side alert updater for tasks (Cloud Functions context).
 * - Updates task.alertEnabled
 * - When enabling and alertMoment provided, aligns task.dueDate to alert time in the user's timezone
 * - Records which delivery channels the reminder explicitly asked for (AT-2211)
 *
 * This is the single funnel every server-side alert write goes through (create_task and
 * update_task both land here), which is why the origin channel is stamped here rather
 * than at each call site.
 *
 * @param {string} projectId
 * @param {string} taskId
 * @param {boolean} alertEnabled
 * @param {import('moment').Moment} alertMoment
 * @param {Object} task Optional current task snapshot to avoid refetch
 * @param {Object} [options]
 * @param {string[]} [options.alertChannels] Channels the reminder explicitly requested
 *   (e.g. ['whatsapp'] when set from WhatsApp). Omit to leave any existing value alone.
 */
async function setTaskAlertCloud(projectId, taskId, alertEnabled, alertMoment, task, options = {}) {
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

        if (!alertEnabled) {
            // An explicit disable clears any origin-channel routing, so a later re-enable
            // from the app cannot silently inherit a channel the user never asked for again.
            updateData.alertChannels = []
        } else if (Array.isArray(options.alertChannels)) {
            updateData.alertChannels = [
                ...new Set(
                    options.alertChannels
                        .filter(channel => typeof channel === 'string' && channel.trim().length > 0)
                        .map(channel => channel.trim().toLowerCase())
                ),
            ]
        }

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
            // Reset alert trigger so a new notification can be generated at the new time
            updateData.alertTriggered = false
        }

        await taskRef.update(updateData)

        console.log('🔔 setTaskAlertCloud: updated alert', {
            projectId,
            taskId,
            alertEnabled: updateData.alertEnabled,
            alertTime: alertMoment && alertMoment.format ? alertMoment.format('YYYY-MM-DD HH:mm:ss Z') : null,
            dueDate: updateData.dueDate || currentTask.dueDate || null,
            alertChannels: updateData.alertChannels,
        })
    } catch (error) {
        console.error('setTaskAlertCloud failed:', error.message)
        throw error
    }
}

module.exports = { setTaskAlertCloud }
