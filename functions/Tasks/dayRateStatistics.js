const moment = require('moment-timezone')
const {
    normalizeDayRateTimeLogConfig,
    calculateDayRateTimeLogAdjustment,
    getDayRateTaskEstimation,
} = require('../shared/dayRateTimeLogCalculation')
const { getEstimationPointsValue } = require('../Utils/statisticsHelper')

function getStatisticsDay(dateKey, user = {}) {
    const timezoneName = user.timezoneName || user.preferredTimezone || user.timeZone
    if (timezoneName && moment.tz.zone(timezoneName)) {
        return moment.tz(dateKey, 'DDMMYYYY', true, timezoneName).startOf('day')
    }
    // Match the client's legacy numeric timezone: small values mean hours, larger ones minutes.
    const rawOffset = user.timezone ?? user.timezoneOffset ?? user.timezoneMinutes
    const offset = rawOffset === null || rawOffset === undefined || rawOffset === '' ? NaN : Number(rawOffset)
    if (!Number.isFinite(offset)) return null
    return moment.utc(dateKey, 'DDMMYYYY', true).utcOffset(Math.abs(offset) <= 16 ? offset * 60 : offset, true)
}

// Maintain days already stamped by Tagessatz. This does not create worked days or change the
// five-task trigger. A statistics write is the common path for calendar syncs, assistants,
// browser actions and late historical corrections, including those after the backfill cursor.
async function reconcileDayRateStatistics({ db, projectId, userId, dateKey }) {
    if (!/^\d{8}$/.test(dateKey || '')) return { updated: false }
    const statsRef = db.doc(`statistics/${projectId}/${userId}/${dateKey}`)
    const dayKey = `${dateKey.slice(4)}${dateKey.slice(2, 4)}${dateKey.slice(0, 2)}`
    const anchorRef = db.doc(`items/${projectId}/tasks/dayRateTimeLog_${userId.replace(/\//g, '_')}_${dayKey}`)

    // Read current documents rather than trusting an event snapshot. Transactions serialize
    // overlapping repairs with client writes; duplicate/out-of-order deliveries converge to a no-op.
    return db.runTransaction(async transaction => {
        const projectSnapshot = await transaction.get(db.doc(`projects/${projectId}`))
        const project = projectSnapshot.data() || {}
        const config = normalizeDayRateTimeLogConfig(project.dayRateTimeLog)
        if (!config.enabled || !(project.userIds || []).includes(userId)) return { updated: false }

        const anchorSnapshot = await transaction.get(anchorRef)
        const anchor = anchorSnapshot.data()
        if (
            anchor?.genericData?.type !== 'dayRateTimeLog' ||
            anchor.userId !== userId ||
            anchor.genericData.day !== dayKey ||
            !anchor.done ||
            !anchor.inDone
        ) {
            return { updated: false }
        }
        const statisticsSnapshot = await transaction.get(statsRef)
        if (!statisticsSnapshot.exists) return { updated: false }
        const statistics = statisticsSnapshot.data()
        const userSnapshot = await transaction.get(db.doc(`users/${userId}`))
        const day = getStatisticsDay(dateKey, userSnapshot.data())
        if (!day?.isValid()) return { updated: false }
        const start = day.valueOf()
        const end = day.clone().endOf('day').valueOf()
        // Do not repair a document using a timezone that no longer matches its generated anchor.
        if (!Number.isFinite(anchor.completed) || anchor.completed < start || anchor.completed > end) {
            return { updated: false }
        }

        // The existing owner/day collection-group index does not depend on readerIds. A moved
        // task's access projection can finish after its statistics write; waiting for that field
        // would omit the task and incorrectly repair the day. Limit results back to this project.
        const query = db
            .collectionGroup('tasks')
            .where('inDone', '==', true)
            .where('userId', '==', userId)
            .where('completed', '>=', start)
            .where('completed', '<=', end)
            .orderBy('completed', 'asc')
        const tasksSnapshot = await transaction.get(query)
        const tasks = tasksSnapshot.docs
            .filter(doc => doc.ref.parent.path === `items/${projectId}/tasks`)
            .map(doc => doc.data())
            .filter(task => task.done === true)
        const adjustment = calculateDayRateTimeLogAdjustment(tasks, config, anchor.genericData.manual === true)
        const { adjustmentMinutes, excessMinutes, shouldPinDay, dayCeilingMinutes, realLoggedMinutes } = adjustment
        const doneTime = shouldPinDay ? dayCeilingMinutes : realLoggedMinutes
        const cappedMinutes = shouldPinDay ? excessMinutes : 0
        const oldEstimation = getDayRateTaskEstimation(anchor)
        const oldCappedMinutes = Number(anchor.genericData.cappedMinutes || 0)
        const statisticsDoneTime = Number(statistics.doneTime || 0)
        const timeChanged = statisticsDoneTime !== doneTime
        const anchorChanged = oldEstimation !== adjustmentMinutes || oldCappedMinutes !== cappedMinutes
        if (!timeChanged && !anchorChanged) return { updated: false, doneTime }

        if (timeChanged || oldEstimation !== adjustmentMinutes) {
            // Keep the client's points accounting: replace the generated estimation, then apply
            // the remaining repair delta. Task counts, XP, gold and chart dates stay untouched.
            const repairDelta = doneTime - (statisticsDoneTime - oldEstimation + adjustmentMinutes)
            const donePoints =
                Number(statistics.donePoints || 0) -
                getEstimationPointsValue(oldEstimation) +
                getEstimationPointsValue(adjustmentMinutes) +
                Math.sign(repairDelta) * getEstimationPointsValue(Math.abs(repairDelta))
            transaction.update(statsRef, { doneTime, donePoints })
        }
        if (anchorChanged) {
            transaction.update(anchorRef, {
                'estimations.-1': adjustmentMinutes,
                'genericData.cappedMinutes': cappedMinutes,
                lastEditionDate: Date.now(),
            })
        }
        return { updated: true, doneTime, previousDoneTime: statisticsDoneTime }
    })
}

async function reconcileDayRateStatisticsOnWrite({ db, projectId, userId, dateKey, before, after }) {
    if (!after || Number(before?.doneTime || 0) === Number(after.doneTime || 0)) return { updated: false }
    return reconcileDayRateStatistics({ db, projectId, userId, dateKey })
}

module.exports = { getStatisticsDay, reconcileDayRateStatistics, reconcileDayRateStatisticsOnWrite }
