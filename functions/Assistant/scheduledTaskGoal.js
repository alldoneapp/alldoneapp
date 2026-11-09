'use strict'

/**
 * The goal a scheduled assistant task files its runs under.
 *
 * A scheduled task (assistantTasks/{projectId}/{assistantId}/{taskId}) may carry `parentGoalId`.
 * Every run of it creates an ordinary task, and that task gets the goal exactly as create_task
 * would give it one (shared/taskParentGoal.js): the goal id, the goal's audience as
 * `parentGoalIsPublicFor`, its lock key, and no automatic goal routing on top.
 *
 * The goal has to be in the project the run lands in, and the user the run acts for has to be able
 * to see it. A goal that is gone or not visible to them is skipped, so the run still happens and the
 * goal router decides as before.
 */

const { canAccessObject } = require('../shared/privacyAccess')
const { buildTaskParentGoalFields, normalizeParentGoalId } = require('../shared/taskParentGoal')

const FEED_PUBLIC_FOR_ALL = 0

async function readScheduledTaskGoal(db, { projectId, goalId, userId }) {
    let id
    try {
        id = normalizeParentGoalId(goalId)
    } catch (error) {
        return null
    }
    if (!id || !projectId) return null
    const snapshot = await db.doc(`goals/${projectId}/items/${id}`).get()
    if (!snapshot.exists) return null
    const data = snapshot.data() || {}
    // A goal stored without an audience is visible to the project (mapGoalData's default).
    const goal = {
        ...data,
        id,
        projectId,
        isPublicFor:
            Array.isArray(data.isPublicFor) && data.isPublicFor.length > 0 ? data.isPublicFor : [FEED_PUBLIC_FOR_ALL],
    }
    return canAccessObject(goal, userId) ? goal : null
}

/**
 * The goal fields for the task one run creates, or {} when the scheduled task has no usable goal.
 * Never throws: a missing goal must not stop the run.
 */
async function buildScheduledRunGoalFields(db, { scheduledTask, projectId, userId }) {
    const goalId = scheduledTask && scheduledTask.parentGoalId
    if (!goalId) return {}
    try {
        const goal = await readScheduledTaskGoal(db, { projectId, goalId, userId })
        if (!goal) {
            console.warn('[scheduled task goal] goal not found or not visible; the run is not filed under it', {
                projectId,
                goalId,
                scheduledTaskId: scheduledTask.id,
            })
            return {}
        }
        return { ...buildTaskParentGoalFields(goal), skipAutomaticGoalRouting: true }
    } catch (error) {
        console.warn('[scheduled task goal] could not read the goal; the run is not filed under it', {
            projectId,
            goalId,
            error: error.message,
        })
        return {}
    }
}

module.exports = { buildScheduledRunGoalFields, readScheduledTaskGoal }
