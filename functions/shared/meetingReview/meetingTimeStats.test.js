'use strict'

const {
    computeMeetingTimeStats,
    filterMeetingStatRows,
    splitOverlaps,
    toPercentShares,
    MEETING_CATEGORY_OPEN,
    MEETING_UNRATED,
    MEETING_ROW_EXCLUDED,
    MEETING_ROW_NOT_ATTENDED,
    MEETING_ROW_PLANNED,
} = require('./meetingTimeStats')

const MIN = 60 * 1000
const HOUR = 60 * MIN
// Tuesday 2026-11-24 00:00 in UTC; the functions suite runs with TZ=UTC and day starts are passed in.
const DAY = Date.UTC(2026, 10, 24)
const at = (h, m = 0) => DAY + h * HOUR + m * MIN
const NEXT_DAY = DAY + 24 * HOUR

const entry = (id, start, end, extra = {}) => ({
    id,
    name: id,
    projectId: 'p1',
    startMs: start,
    endMs: end,
    done: true,
    ...extra,
})

const rated = (category, usefulness) => ({ category, categoryConfirmed: true, usefulness })

const dayStats = (entries, nowMs = NEXT_DAY + HOUR) =>
    computeMeetingTimeStats({ entries, rangeStartMs: DAY, rangeEndMs: NEXT_DAY, dayStartsMs: [DAY], nowMs })

const minutes = ms => Math.round(ms / MIN)
const segment = (stats, key) => stats.usefulnessSegments.find(item => item.key === key)
const categoryRow = (stats, key) => stats.categoryRows.find(item => item.key === key)
const row = (stats, id) => stats.rows.find(item => item.id === id)

describe('toPercentShares', () => {
    it('always sums to 100 and matches the concept week example (53/19/12/16)', () => {
        const shares = toPercentShares([19.5, 7, 4.5, 6])
        expect(shares).toEqual([53, 19, 12, 16])
        expect(shares.reduce((a, b) => a + b, 0)).toBe(100)
    })

    it('returns zeros for an empty total and never gives a share to a zero value', () => {
        expect(toPercentShares([0, 0])).toEqual([0, 0])
        const shares = toPercentShares([1, 0, 1, 1])
        expect(shares[1]).toBe(0)
        expect(shares.reduce((a, b) => a + b, 0)).toBe(100)
    })
})

describe('splitOverlaps', () => {
    it('splits shared time evenly and counts each wall-clock minute once', () => {
        const result = splitOverlaps(
            [
                { key: 'a', startMs: at(14), endMs: at(15) },
                { key: 'b', startMs: at(14, 30), endMs: at(15) },
            ],
            [DAY]
        )
        expect(minutes(result.get('a').countedMs)).toBe(45)
        expect(minutes(result.get('b').countedMs)).toBe(15)
        expect([...result.get('b').overlapWith]).toEqual(['a'])
    })

    it('handles three-way overlaps without exceeding the union', () => {
        const result = splitOverlaps(
            [
                { key: 'a', startMs: at(9), endMs: at(11) },
                { key: 'b', startMs: at(10), endMs: at(12) },
                { key: 'c', startMs: at(10), endMs: at(11) },
            ],
            [DAY]
        )
        const total = [...result.values()].reduce((sum, bucket) => sum + bucket.countedMs, 0)
        expect(minutes(total)).toBe(180)
        expect(minutes(result.get('c').countedMs)).toBe(20)
    })
})

describe('computeMeetingTimeStats', () => {
    it('concept 4.3: customer call and standup overlap → 45 + 15 min; standup not attended → 60 + 0', () => {
        const call = entry('call', at(14), at(15), rated('stakeholder', 'worthwhile'))
        const standup = entry('standup', at(14, 30), at(15), rated('status', 'not_helpful'))

        const split = dayStats([call, standup])
        expect(minutes(split.totalMs)).toBe(60)
        expect(minutes(row(split, 'call').countedMs)).toBe(45)
        expect(minutes(row(split, 'standup').countedMs)).toBe(15)
        expect(minutes(row(split, 'standup').overlapMs)).toBe(15)
        expect(minutes(split.overlapSplitMs)).toBe(30)

        const notAttended = dayStats([call, { ...standup, attendance: 'not_attended' }])
        expect(minutes(row(notAttended, 'call').countedMs)).toBe(60)
        expect(row(notAttended, 'standup').status).toBe(MEETING_ROW_NOT_ATTENDED)
        expect(row(notAttended, 'standup').countedMs).toBe(0)
        expect(minutes(notAttended.totalMs)).toBe(60)
    })

    it('concept W9: the day example adds up to 7 h 15 with 62/14/17/7 % and a 1 h 15 – 2 h 15 range', () => {
        const stats = dayStats([
            entry('standup', at(9), at(9, 15), rated('status', 'not_helpful')),
            entry('weekly', at(9, 30), at(10, 30), rated('status', 'partly')),
            entry('focus', at(10, 30), at(12), rated('own_time', 'worthwhile')),
            entry('lunch', at(12), at(13), rated('own_time', 'worthwhile')),
            entry('workshop', at(13), at(14), rated('work', 'worthwhile')),
            entry('steering', at(14), at(14, 30), rated('stakeholder', 'not_helpful')),
            entry('intro', at(14, 30), at(15, 30), rated('network', 'worthwhile')),
            entry('reporting', at(15, 30), at(16, 30), {
                ...rated('status', 'not_helpful'),
                actualStartMs: at(15, 30),
                actualEndMs: at(16),
            }),
            entry('partner', at(16), at(17), { excludedReason: 'cancelled' }),
            entry('jourfixe', at(17), at(17, 30), { suggestedCategory: 'status' }),
        ])

        expect(minutes(stats.totalMs)).toBe(435)
        expect(stats.usefulnessSegments.map(item => [item.key, minutes(item.totalMs), item.sharePercent])).toEqual([
            ['worthwhile', 270, 62],
            ['partly', 60, 14],
            ['not_helpful', 75, 17],
            [MEETING_UNRATED, 30, 7],
        ])
        expect(minutes(stats.notHelpfulRange.minMs)).toBe(75)
        expect(minutes(stats.notHelpfulRange.maxMs)).toBe(135)
        expect(Math.round(stats.ratedShare * 100)).toBe(93)
        expect(stats.limited).toBe(false)

        // reporting: adjusted 30 of 60 planned, and the cancelled partner call does not count
        expect(row(stats, 'reporting').adjusted).toBe(true)
        expect(minutes(row(stats, 'reporting').countedMs)).toBe(30)
        expect(row(stats, 'reporting').plannedMs).toBe(HOUR)
        expect(row(stats, 'partner').status).toBe(MEETING_ROW_EXCLUDED)
        expect(minutes(stats.adjustedBasisMs)).toBe(30)
        expect(minutes(stats.plannedBasisMs)).toBe(405)

        // E1: the unconfirmed suggestion is NOT counted as status; it is "category open"
        expect(minutes(categoryRow(stats, 'status').totalMs)).toBe(15 + 60 + 30)
        expect(minutes(categoryRow(stats, MEETING_CATEGORY_OPEN).totalMs)).toBe(30)
        expect(stats.categoryRows.reduce((sum, item) => sum + item.sharePercent, 0)).toBe(100)

        const statusNotHelpful = filterMeetingStatRows(stats, {
            categoryRow: 'status',
            usefulnessBucket: 'not_helpful',
        })
        expect(statusNotHelpful.map(item => item.id)).toEqual(['standup', 'reporting'])
    })

    it('keeps unrated time as its own segment and flags a limited result below 70 % rated', () => {
        const stats = dayStats([entry('a', at(9), at(10), rated('work', 'worthwhile')), entry('b', at(10), at(12))])
        expect(minutes(segment(stats, MEETING_UNRATED).totalMs)).toBe(120)
        expect(minutes(segment(stats, 'worthwhile').totalMs)).toBe(60)
        expect(minutes(stats.notHelpfulRange.maxMs)).toBe(0)
        expect(stats.limited).toBe(true)
    })

    it('E2: a past appointment that was never checked off counts as unrated and is flagged', () => {
        const stats = dayStats([entry('past', at(9), at(10), { done: false })])
        expect(minutes(stats.totalMs)).toBe(60)
        expect(row(stats, 'past').notCheckedOff).toBe(true)
        expect(row(stats, 'past').usefulnessBucket).toBe(MEETING_UNRATED)
        expect(minutes(stats.notCheckedOffMs)).toBe(60)
    })

    it('does not count future time of open appointments; reports it as still planned', () => {
        const now = at(12)
        const stats = dayStats(
            [
                entry('future', at(15), at(16), { done: false }),
                entry('ongoing', at(11, 30), at(12, 30), { done: false }),
            ],
            now
        )
        expect(row(stats, 'future').status).toBe(MEETING_ROW_PLANNED)
        expect(minutes(row(stats, 'ongoing').countedMs)).toBe(30)
        expect(minutes(stats.totalMs)).toBe(30)
        expect(minutes(stats.stillPlannedMs)).toBe(90)
    })

    it('counts a completed appointment in full even when rated before its planned end (E5)', () => {
        const stats = dayStats([entry('early', at(11), at(12), rated('work', 'partly'))], at(11, 30))
        expect(minutes(stats.totalMs)).toBe(60)
    })

    it('excludes all-day, cancelled and declined appointments from the denominator', () => {
        const stats = dayStats([
            entry('allday', DAY, NEXT_DAY, { excludedReason: 'all_day' }),
            entry('declined', at(9), at(10), { excludedReason: 'declined' }),
            entry('counted', at(10), at(11)),
        ])
        expect(minutes(stats.totalMs)).toBe(60)
        expect(
            stats.rows
                .filter(item => item.status === MEETING_ROW_EXCLUDED)
                .map(item => item.id)
                .sort()
        ).toEqual(['allday', 'declined'])
    })

    it('splits an appointment across midnight by the given local day starts and averages per day with time', () => {
        const stats = computeMeetingTimeStats({
            entries: [entry('late', DAY + 23 * HOUR, NEXT_DAY + HOUR, rated('own_time', 'worthwhile'))],
            rangeStartMs: DAY,
            rangeEndMs: DAY + 7 * 24 * HOUR,
            dayStartsMs: Array.from({ length: 7 }, (_, i) => DAY + i * 24 * HOUR),
            nowMs: DAY + 8 * 24 * HOUR,
        })
        expect(stats.byDay.map(item => [item.dayStartMs, minutes(item.totalMs)])).toEqual([
            [DAY, 60],
            [NEXT_DAY, 60],
        ])
        expect(stats.daysWithTime).toBe(2)
        expect(minutes(stats.averagePerDay.totalMs)).toBe(60)
    })

    it('clips appointments to the period', () => {
        const stats = dayStats([entry('cross', DAY - HOUR, DAY + HOUR, rated('work', 'worthwhile'))])
        expect(minutes(stats.totalMs)).toBe(60)
    })

    it('a DST day of 23 hours is just a shorter day: boundaries come from the caller', () => {
        const dstDayStart = DAY
        const nextDayStart = DAY + 23 * HOUR
        const stats = computeMeetingTimeStats({
            entries: [entry('x', nextDayStart - HOUR, nextDayStart + HOUR, rated('work', 'worthwhile'))],
            rangeStartMs: dstDayStart,
            rangeEndMs: nextDayStart + 24 * HOUR,
            dayStartsMs: [dstDayStart, nextDayStart],
            nowMs: nextDayStart + 48 * HOUR,
        })
        expect(stats.byDay.map(item => minutes(item.totalMs))).toEqual([60, 60])
    })

    it('never invents a category: rated but unconfirmed time stays in the open row', () => {
        const stats = dayStats([
            entry('a', at(9), at(10), { usefulness: 'not_helpful', category: 'status', categoryConfirmed: false }),
        ])
        expect(minutes(categoryRow(stats, MEETING_CATEGORY_OPEN).byUsefulness.not_helpful)).toBe(60)
        expect(categoryRow(stats, 'status').totalMs).toBe(0)
    })
})
