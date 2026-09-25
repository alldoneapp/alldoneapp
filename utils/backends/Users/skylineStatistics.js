import moment from 'moment'

import { getDb } from '../firestore'

/**
 * Per-day completion statistics for the Empty inbox skyline (the 3D year view on the achievements
 * card).
 *
 * Reads `statistics/{projectId}/{userId}` — the same per-day documents the statistics modal
 * aggregates — with a single `day` range per project. `day` is a YYYYMMDD integer and a
 * single-field range needs no composite index.
 *
 * Cost discipline, because the card is rendered on the all-projects empty-inbox board as well as in
 * Settings: the past days of the year cannot change, so the range up to YESTERDAY is read once per
 * session and user (per project) and kept in memory; only TODAY is re-read on each mount, which is
 * one document per project. A failed read (offline, not cached) contributes nothing rather than
 * failing the card — the city still renders from the inbox-zero days, just without heights.
 */

const pastRangeCache = new Map()

const toDayNumber = date => parseInt(moment(date).format('YYYYMMDD'), 10)

const readRange = async (projectId, userId, fromDay, toDay) => {
    const snapshot = await getDb()
        .collection(`statistics/${projectId}/${userId}`)
        .where('day', '>=', fromDay)
        .where('day', '<=', toDay)
        .get()
    const byDay = {}
    snapshot.forEach(doc => {
        const { day, doneTasks, doneTime } = doc.data() || {}
        if (!day) return
        byDay[day] = { doneTasks: Number(doneTasks) || 0, doneTime: Number(doneTime) || 0 }
    })
    return byDay
}

const safeRead = (projectId, userId, fromDay, toDay, onFailure) =>
    readRange(projectId, userId, fromDay, toDay).catch(error => {
        console.warn('[skyline] Could not read statistics', error && error.code ? error.code : error)
        if (onFailure) onFailure()
        return {}
    })

/**
 * @returns {Promise<Object<string, Object<number, {doneTasks: number, doneTime: number}>>>}
 *   projectId → YYYYMMDD → totals
 */
export async function loadSkylineStatistics(userId, projectIds, startDate, todayTimestamp = Date.now()) {
    if (!userId || !Array.isArray(projectIds) || projectIds.length === 0) return {}

    const fromDay = toDayNumber(startDate)
    const todayDay = toDayNumber(todayTimestamp)
    const yesterdayDay = toDayNumber(moment(todayTimestamp).subtract(1, 'day'))

    const entries = await Promise.all(
        projectIds.map(async projectId => {
            const cacheKey = `${userId}|${projectId}|${fromDay}|${yesterdayDay}`
            if (!pastRangeCache.has(cacheKey)) {
                // A failed read is not remembered, so the next mount (e.g. after reconnecting)
                // tries again instead of showing a flat year for the rest of the session.
                const pending = safeRead(projectId, userId, fromDay, yesterdayDay, () =>
                    pastRangeCache.delete(cacheKey)
                )
                pastRangeCache.set(cacheKey, pending)
            }
            const [past, today] = await Promise.all([
                pastRangeCache.get(cacheKey),
                safeRead(projectId, userId, todayDay, todayDay),
            ])
            return [projectId, { ...past, ...today }]
        })
    )

    return Object.fromEntries(entries)
}

export const __resetSkylineStatisticsCache = () => pastRangeCache.clear()
