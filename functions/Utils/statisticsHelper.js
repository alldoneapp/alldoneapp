const admin = require('firebase-admin')
const moment = require('moment')

const { ESTIMATION_16_HOURS, ESTIMATION_TYPE_POINTS, ESTIMATION_POINTS_VALUES } = require('./HelperFunctionsCloud')

/**
 * Get estimation value in points
 * Converts time-based estimation to points based on predefined mapping
 * @param {number} estimation - Estimation in minutes
 * @returns {number} Points value
 */
function getEstimationPointsValue(estimation) {
    // If estimation is custom (not in predefined values), convert minutes to hours as points
    if (estimation > ESTIMATION_16_HOURS) {
        return estimation / 60
    }

    // Use predefined mapping for standard estimations
    const points = ESTIMATION_POINTS_VALUES[estimation]
    return typeof points === 'number' ? points : 0
}

/**
 * Update user statistics for task completion
 * Cloud-compatible version of utils/backends/firestore.js updateStatistics
 *
 * @param {string} projectId - Project ID
 * @param {string} taskOwnerUid - User ID who owns the task
 * @param {number} estimation - Estimation in minutes
 * @param {boolean} subtract - If true, subtract from stats (for reversing); if false, add to stats
 * @param {boolean} onlyEstimation - If true, only update estimation metrics (not task count)
 * @param {number} completed - Timestamp when task was completed
 * @param {Object} batch - BatchWrapper instance for batching operations
 */
async function updateStatistics(projectId, taskOwnerUid, estimation, subtract, onlyEstimation, completed, batch) {
    console.log('📊 updateStatistics', {
        projectId,
        taskOwnerUid,
        estimation,
        subtract,
        onlyEstimation,
    })

    // Get the date for statistics tracking
    const date = completed ? moment(completed) : moment()
    const slimDate = date.format('DDMMYYYY') // Format: 10112025
    const dayDate = parseInt(date.format('YYYYMMDD')) // Format: 20251110
    const timestamp = date.valueOf()

    // Calculate points based on estimation
    const donePoints = getEstimationPointsValue(estimation)

    // Build statistics update
    const statistics = {
        doneTasks: admin.firestore.FieldValue.increment(subtract ? -1 : 1),
        donePoints: admin.firestore.FieldValue.increment(subtract ? -donePoints : donePoints),
        doneTime: admin.firestore.FieldValue.increment(subtract ? -estimation : estimation),
        timestamp,
        day: dayDate,
    }

    // If only updating estimation (not task count), remove doneTasks field
    if (onlyEstimation) {
        delete statistics.doneTasks
    }

    // Get Firestore instance from batch
    const db = batch.db || admin.firestore()
    const statsRef = db.doc(`statistics/${projectId}/${taskOwnerUid}/${slimDate}`)

    batch.set(statsRef, statistics, { merge: true })

    console.log('📊 Statistics update queued', {
        statsPath: `statistics/${projectId}/${taskOwnerUid}/${slimDate}`,
        donePoints,
        doneTime: estimation,
    })
}

module.exports = {
    updateStatistics,
    getEstimationPointsValue,
}
