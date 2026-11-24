'use strict'

/**
 * AT-3137 — the arithmetic behind the meeting time statistics (concept chapter 4).
 *
 * Pure: entries in, numbers out. Day boundaries come from the caller (the app computes them in the
 * user's local timezone with moment, so DST days are 23h/25h long and "Monday" means the user's
 * Monday); this module never guesses a timezone.
 *
 * Definitions, all from the concept and the decisions of 2026-11-23:
 *   - DENOMINATOR "recorded calendar time": the counted time of every calendar task in the period,
 *     after exclusions, overlap split and clipping to the period. Every share is a share of it.
 *   - counted duration = the user's adjusted duration if there is one, otherwise the planned one
 *   - not attended → 0 minutes (listed in the drill-down, not in the denominator)
 *   - all-day / cancelled / declined → not counted (listed as excluded)
 *   - future parts of not-completed appointments → not counted, reported as "still planned"
 *   - past, not completed (E2) → counted as UNRATED and flagged `notCheckedOff`
 *   - overlaps: every wall-clock minute counts once; shared time is split evenly between the
 *     appointments running at that moment
 *   - unrated time is its own segment, never extrapolated, never good or bad
 *   - unconfirmed categories (E1) are NOT added to a category: they form the row "category open"
 *   - "not helpful" is a RANGE: lower = not helpful, upper = not helpful + partly
 *   - average per day (E6) divides by the days in the period that have recorded time
 *   - project scope (AT-3145): the overlap split always runs over ALL projects, then only the
 *     scoped project's appointments are counted, so the per-project figures add up to the total
 *     of "all projects" and a minute shared with another project's appointment is never counted
 *     twice. `projectRows` breaks the (scoped) total down by project.
 */

const {
    MEETING_CATEGORIES,
    MEETING_USEFULNESS_LEVELS,
    MEETING_USEFULNESS_NOT_HELPFUL,
    MEETING_USEFULNESS_PARTLY,
    MEETING_ATTENDANCE_NOT_ATTENDED,
    MEETING_RATED_SHARE_WARNING_THRESHOLD,
    isMeetingCategory,
    isMeetingUsefulness,
} = require('./meetingReviewConstants')

const MEETING_CATEGORY_OPEN = 'open'
const MEETING_UNRATED = 'unrated'

const MEETING_ROW_COUNTED = 'counted'
const MEETING_ROW_NOT_ATTENDED = 'not_attended'
const MEETING_ROW_EXCLUDED = 'excluded'
const MEETING_ROW_PLANNED = 'planned'

const USEFULNESS_BUCKETS = [...MEETING_USEFULNESS_LEVELS, MEETING_UNRATED]
const CATEGORY_ROWS = [...MEETING_CATEGORIES, MEETING_CATEGORY_OPEN]

const emptyUsefulnessTotals = () => USEFULNESS_BUCKETS.reduce((acc, key) => ({ ...acc, [key]: 0 }), {})

const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value)

/**
 * Integer percentages that add up to exactly 100 (largest remainder method), so a view never shows
 * 99 % or 101 %. Returns zeros when the total is zero.
 */
const toPercentShares = values => {
    const list = values.map(value => (isFiniteNumber(value) && value > 0 ? value : 0))
    const total = list.reduce((sum, value) => sum + value, 0)
    if (!(total > 0)) return list.map(() => 0)
    const raw = list.map(value => (value / total) * 100)
    const floors = raw.map(Math.floor)
    let remaining = 100 - floors.reduce((sum, value) => sum + value, 0)
    const order = raw
        .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
        .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    const result = floors.slice()
    for (let i = 0; i < order.length && remaining > 0; i++) {
        if (list[order[i].index] <= 0) continue
        result[order[i].index] += 1
        remaining -= 1
    }
    return result
}

const getAdjustedInterval = entry => {
    const { actualStartMs, actualEndMs } = entry
    if (isFiniteNumber(actualStartMs) && isFiniteNumber(actualEndMs) && actualEndMs > actualStartMs) {
        return { startMs: actualStartMs, endMs: actualEndMs }
    }
    return null
}

/**
 * Splits shared wall-clock time evenly between overlapping intervals and books it to the day it
 * falls in.
 *
 * @param {Array<{key:string,startMs:number,endMs:number}>} intervals
 * @param {number[]} dayStartsMs ascending local day starts covering the intervals
 * @returns {Map<string,{countedMs:number,byDay:Map<number,number>,overlapWith:Set<string>}>}
 */
const splitOverlaps = (intervals, dayStartsMs = []) => {
    const result = new Map()
    intervals.forEach(interval => result.set(interval.key, { countedMs: 0, byDay: new Map(), overlapWith: new Set() }))
    if (intervals.length === 0) return result

    const points = new Set()
    intervals.forEach(({ startMs, endMs }) => {
        points.add(startMs)
        points.add(endMs)
    })
    const minStart = Math.min(...intervals.map(i => i.startMs))
    const maxEnd = Math.max(...intervals.map(i => i.endMs))
    const days = (Array.isArray(dayStartsMs) ? dayStartsMs : []).filter(isFiniteNumber).sort((a, b) => a - b)
    days.forEach(day => {
        if (day > minStart && day < maxEnd) points.add(day)
    })
    const sorted = [...points].sort((a, b) => a - b)

    const dayOf = moment => {
        let found = days.length > 0 ? days[0] : 0
        for (let i = 0; i < days.length; i++) {
            if (days[i] <= moment) found = days[i]
            else break
        }
        return found
    }

    for (let i = 0; i < sorted.length - 1; i++) {
        const from = sorted[i]
        const to = sorted[i + 1]
        if (!(to > from)) continue
        const active = intervals.filter(interval => interval.startMs <= from && interval.endMs >= to)
        if (active.length === 0) continue
        const share = (to - from) / active.length
        const day = dayOf(from)
        active.forEach(interval => {
            const bucket = result.get(interval.key)
            bucket.countedMs += share
            bucket.byDay.set(day, (bucket.byDay.get(day) || 0) + share)
            if (active.length > 1) {
                active.forEach(other => {
                    if (other.key !== interval.key) bucket.overlapWith.add(other.key)
                })
            }
        })
    }
    return result
}

/**
 * @param {object} params
 * @param {Array<object>} params.entries one per calendar task, already deduplicated:
 *   { id, name, projectId, startMs, endMs, excludedReason, done,
 *     category, categoryConfirmed, suggestedCategory, usefulness, attendance,
 *     actualStartMs, actualEndMs }
 * @param {number} params.rangeStartMs inclusive
 * @param {number} params.rangeEndMs exclusive
 * @param {number[]} params.dayStartsMs local day starts inside the range (first = rangeStartMs)
 * @param {number} params.nowMs
 * @param {string|null} [params.projectId] only count this project's appointments (overlaps are
 *   still split against every project's appointments)
 */
const computeMeetingTimeStats = ({
    entries = [],
    rangeStartMs,
    rangeEndMs,
    dayStartsMs = [],
    nowMs = Date.now(),
    projectId = null,
}) => {
    const rows = []
    const intervals = []
    let stillPlannedMs = 0

    ;(Array.isArray(entries) ? entries : []).forEach(entry => {
        if (!entry || !entry.id) return
        const inScope = !projectId || (entry.projectId || '') === projectId
        const usefulness = isMeetingUsefulness(entry.usefulness) ? entry.usefulness : null
        const confirmedCategory = entry.categoryConfirmed && isMeetingCategory(entry.category) ? entry.category : null
        const plannedMs =
            isFiniteNumber(entry.startMs) && isFiniteNumber(entry.endMs) ? Math.max(0, entry.endMs - entry.startMs) : 0
        const adjusted = getAdjustedInterval(entry)
        const baseInterval = adjusted || { startMs: entry.startMs, endMs: entry.endMs }
        const row = {
            id: entry.id,
            name: entry.name || '',
            projectId: entry.projectId || '',
            startMs: entry.startMs,
            endMs: entry.endMs,
            plannedMs,
            adjusted: !!adjusted,
            countedStartMs: baseInterval.startMs,
            countedEndMs: baseInterval.endMs,
            done: !!entry.done,
            notCheckedOff: false,
            category: confirmedCategory,
            categoryRow: confirmedCategory || MEETING_CATEGORY_OPEN,
            suggestedCategory: isMeetingCategory(entry.suggestedCategory) ? entry.suggestedCategory : null,
            usefulness,
            usefulnessBucket: usefulness || MEETING_UNRATED,
            status: MEETING_ROW_COUNTED,
            excludedReason: entry.excludedReason || null,
            countedMs: 0,
            rawMs: 0,
            overlapMs: 0,
            overlapWith: [],
            byDay: {},
        }

        if (entry.excludedReason) {
            if (!inScope) return
            row.status = MEETING_ROW_EXCLUDED
            if (isFiniteNumber(entry.startMs) && entry.startMs < rangeEndMs && entry.endMs > rangeStartMs)
                rows.push(row)
            return
        }
        if (!isFiniteNumber(baseInterval.startMs) || !isFiniteNumber(baseInterval.endMs)) return
        if (!(baseInterval.endMs > rangeStartMs && baseInterval.startMs < rangeEndMs)) return

        if (entry.attendance === MEETING_ATTENDANCE_NOT_ATTENDED) {
            if (!inScope) return
            row.status = MEETING_ROW_NOT_ATTENDED
            rows.push(row)
            return
        }

        let countStart = Math.max(baseInterval.startMs, rangeStartMs)
        let countEnd = Math.min(baseInterval.endMs, rangeEndMs)

        // A completed appointment counts in full: the user said it took place (and can adjust the
        // duration). An open one counts only up to now; the rest is "still planned".
        if (!entry.done) {
            if (countEnd > nowMs) {
                if (inScope) stillPlannedMs += countEnd - Math.max(countStart, nowMs)
                countEnd = Math.min(countEnd, nowMs)
            }
            if (!(countEnd > countStart)) {
                if (!inScope) return
                row.status = MEETING_ROW_PLANNED
                rows.push(row)
                return
            }
            row.notCheckedOff = true
        }

        row.rawMs = countEnd - countStart
        // Out-of-scope appointments still take part in the overlap split (see the header).
        intervals.push({ key: entry.id, startMs: countStart, endMs: countEnd })
        if (inScope) rows.push(row)
    })

    const split = splitOverlaps(intervals, dayStartsMs)
    const rowsById = new Map(rows.map(row => [row.id, row]))

    const byUsefulness = emptyUsefulnessTotals()
    const byCategory = CATEGORY_ROWS.reduce((acc, key) => ({ ...acc, [key]: emptyUsefulnessTotals() }), {})
    const byDayTotals = new Map()
    const byProject = new Map()
    let totalMs = 0
    let plannedBasisMs = 0
    let adjustedBasisMs = 0
    let overlapSplitMs = 0
    let countedAppointments = 0
    let notCheckedOffMs = 0

    split.forEach((bucket, key) => {
        const row = rowsById.get(key)
        if (!row) return
        row.countedMs = bucket.countedMs
        row.overlapMs = Math.max(0, row.rawMs - bucket.countedMs)
        row.overlapWith = [...bucket.overlapWith]
        bucket.byDay.forEach((ms, day) => {
            row.byDay[day] = ms
            byDayTotals.set(day, (byDayTotals.get(day) || 0) + ms)
        })
        totalMs += row.countedMs
        byUsefulness[row.usefulnessBucket] += row.countedMs
        byCategory[row.categoryRow][row.usefulnessBucket] += row.countedMs
        if (!byProject.has(row.projectId)) byProject.set(row.projectId, emptyUsefulnessTotals())
        byProject.get(row.projectId)[row.usefulnessBucket] += row.countedMs
        if (row.adjusted) adjustedBasisMs += row.countedMs
        else plannedBasisMs += row.countedMs
        overlapSplitMs += row.overlapMs
        if (row.notCheckedOff) notCheckedOffMs += row.countedMs
        if (row.countedMs > 0) countedAppointments += 1
    })

    const categoryRows = CATEGORY_ROWS.map(key => {
        const totals = byCategory[key]
        const rowTotal = USEFULNESS_BUCKETS.reduce((sum, bucket) => sum + totals[bucket], 0)
        return { key, totalMs: rowTotal, byUsefulness: totals }
    })
    const categoryShares = toPercentShares(categoryRows.map(row => row.totalMs))
    categoryRows.forEach((row, index) => {
        row.sharePercent = categoryShares[index]
    })

    const projectRows = [...byProject.entries()]
        .map(([key, totals]) => ({
            key,
            totalMs: USEFULNESS_BUCKETS.reduce((sum, bucket) => sum + totals[bucket], 0),
            byUsefulness: totals,
        }))
        .filter(row => row.totalMs > 0)
        .sort((a, b) => b.totalMs - a.totalMs || String(a.key).localeCompare(String(b.key)))
    const projectShares = toPercentShares(projectRows.map(row => row.totalMs))
    projectRows.forEach((row, index) => {
        row.sharePercent = projectShares[index]
    })

    const usefulnessSegments = USEFULNESS_BUCKETS.map(key => ({ key, totalMs: byUsefulness[key] }))
    const usefulnessShares = toPercentShares(usefulnessSegments.map(segment => segment.totalMs))
    usefulnessSegments.forEach((segment, index) => {
        segment.sharePercent = usefulnessShares[index]
    })

    const ratedMs = totalMs - byUsefulness[MEETING_UNRATED]
    const ratedShare = totalMs > 0 ? ratedMs / totalMs : 0
    const daysWithTime = [...byDayTotals.values()].filter(ms => ms > 0).length
    const notHelpfulMinMs = byUsefulness[MEETING_USEFULNESS_NOT_HELPFUL]
    const notHelpfulMaxMs = notHelpfulMinMs + byUsefulness[MEETING_USEFULNESS_PARTLY]

    rows.sort((a, b) => (a.startMs || 0) - (b.startMs || 0) || String(a.name).localeCompare(String(b.name)))

    return {
        rangeStartMs,
        rangeEndMs,
        totalMs,
        countedAppointments,
        ratedMs,
        unratedMs: byUsefulness[MEETING_UNRATED],
        ratedShare,
        limited: totalMs > 0 && ratedShare < MEETING_RATED_SHARE_WARNING_THRESHOLD,
        usefulnessSegments,
        categoryRows,
        projectRows,
        projectId: projectId || null,
        notHelpfulRange: { minMs: notHelpfulMinMs, maxMs: notHelpfulMaxMs },
        daysWithTime,
        averagePerDay:
            daysWithTime > 0
                ? {
                      totalMs: totalMs / daysWithTime,
                      notHelpfulMinMs: notHelpfulMinMs / daysWithTime,
                      notHelpfulMaxMs: notHelpfulMaxMs / daysWithTime,
                  }
                : null,
        plannedBasisMs,
        adjustedBasisMs,
        overlapSplitMs,
        notCheckedOffMs,
        stillPlannedMs,
        byDay: [...byDayTotals.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([dayStartMs, ms]) => ({ dayStartMs, totalMs: ms })),
        rows,
    }
}

/**
 * The drill-down behind one cell of the matrix: rows with counted time in that category row and/or
 * usefulness bucket. Pass null for "any".
 */
const filterMeetingStatRows = (stats, { categoryRow = null, usefulnessBucket = null } = {}) =>
    (stats?.rows || []).filter(
        row =>
            row.status === MEETING_ROW_COUNTED &&
            row.countedMs > 0 &&
            (categoryRow === null || row.categoryRow === categoryRow) &&
            (usefulnessBucket === null || row.usefulnessBucket === usefulnessBucket)
    )

module.exports = {
    MEETING_CATEGORY_OPEN,
    MEETING_UNRATED,
    MEETING_ROW_COUNTED,
    MEETING_ROW_NOT_ATTENDED,
    MEETING_ROW_EXCLUDED,
    MEETING_ROW_PLANNED,
    USEFULNESS_BUCKETS,
    CATEGORY_ROWS,
    toPercentShares,
    splitOverlaps,
    computeMeetingTimeStats,
    filterMeetingStatRows,
}
