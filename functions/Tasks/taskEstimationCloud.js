const admin = require('firebase-admin')
const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { updateStatistics } = require('../Utils/statisticsHelper')
const {
    createTaskAssigneeEstimationChangedFeed,
    createTaskReviewerEstimationChangedFeed,
} = require('../Feeds/tasksFeeds')
const { tryAddFollower } = require('../Followers/followerHelper')
const { OPEN_STEP } = require('../Utils/HelperFunctionsCloud')
const { FOLLOWER_TASKS_TYPE } = require('../Followers/FollowerConstants')
const { loadFeedsGlobalState } = require('../GlobalState/globalState')

/**
 * Set task estimation (Cloud Functions version)
 * Mirrors utils/backends/Tasks/tasksFirestore.js setTaskEstimations
 *
 * This function preserves all original logic:
 * - Updates task estimation fields (with cross-environment compatibility)
 * - Updates user statistics if task is done
 * - Creates appropriate feeds (assignee or reviewer)
 * - Adds user as follower of the task
 *
 * @param {string} projectId - Project ID
 * @param {string} taskId - Task ID
 * @param {Object} task - Current task object
 * @param {string|number} stepId - Workflow step ID (-1 or 'Open' for default, or custom step ID)
 * @param {number} estimation - Estimation in minutes
 * @param {Object} feedCreator - User object for feed generation (with uid, name, email)
 */
async function setTaskEstimationsCloud(projectId, taskId, task, stepId, estimation, feedCreator) {
    const db = admin.firestore()

    // Initialize global state for follower functions that depend on it
    // In cloud functions, admin and appAdmin are the same
    loadFeedsGlobalState(admin, admin, feedCreator, null, null, null)

    const oldEstimation = task.estimations?.[stepId] || 0

    console.log('🔧 setTaskEstimationsCloud', {
        projectId,
        taskId,
        stepId,
        oldEstimation,
        newEstimation: estimation,
        taskDone: task.done,
    })

    // Create batch for task update and statistics
    const batch = new BatchWrapper(db)

    // Update statistics if task is done and we're updating OPEN_STEP
    // This is critical for accurate points/time tracking
    if (oldEstimation !== estimation && (stepId === OPEN_STEP || stepId === -1) && task.done) {
        console.log('🔧 Updating statistics for done task (two operations for accuracy)')
        // Two operations to keep points/time accurate
        // Doing only one operation with "newEstimation - oldEstimation" as parameter
        // will cause the Points estimation may not be accurate,
        // and resultant Point in BD may not MATCH with defined Points/Time constants
        await updateStatistics(projectId, task.userId, oldEstimation, true, true, task.completed, batch)
        await updateStatistics(projectId, task.userId, estimation, false, true, task.completed, batch)
    }

    // Update task estimation field
    // Normalize for both numeric and string keys (cross-environment compatibility)
    const taskRef = db.collection(`items/${projectId}/tasks`).doc(taskId)
    const updateData = {
        [`estimations.${stepId}`]: estimation,
        lastEditionDate: Date.now(),
        lastEditorId: feedCreator.uid,
    }

    // If stepId is OPEN_STEP, also update both -1 and 'Open' keys for cross-environment compatibility
    if (stepId === OPEN_STEP || stepId === -1 || stepId === 'Open') {
        updateData['estimations.-1'] = estimation
        updateData['estimations.Open'] = estimation
    }

    batch.update(taskRef, updateData)

    // Commit task update and statistics
    await batch.commit()

    console.log('🔧 Task estimation and statistics updated, now creating feeds')

    // Create feeds and add follower (separate batch for better error isolation)
    const feedBatch = new BatchWrapper(db)

    // Create appropriate feed based on step type
    if (stepId === OPEN_STEP || stepId === -1 || stepId === 'Open') {
        await createTaskAssigneeEstimationChangedFeed(
            projectId,
            taskId,
            oldEstimation,
            estimation,
            feedBatch,
            feedCreator,
            false // needGenerateNotification
        )
    } else {
        await createTaskReviewerEstimationChangedFeed(
            projectId,
            task,
            taskId,
            oldEstimation,
            estimation,
            stepId,
            feedBatch,
            feedCreator,
            false // needGenerateNotification
        )
    }

    // Add user as follower of the task
    // This mirrors the original tryAddFollower behavior
    const followTaskData = {
        followObjectsType: FOLLOWER_TASKS_TYPE,
        followObjectId: taskId,
        followObject: task,
        feedUser: feedCreator, // tryAddFollower expects feedUser, not feedCreator
    }
    await tryAddFollower(projectId, followTaskData, feedBatch, false)

    await feedBatch.commit()

    console.log('🔧 setTaskEstimationsCloud completed successfully')
    return { success: true }
}

module.exports = { setTaskEstimationsCloud }
