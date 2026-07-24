import moment from 'moment'

import {
    buildEmptyInboxActivityWeeks,
    buildEmptyInboxMonthSegments,
    getEmptyInboxAchievementStats,
    getEmptyInboxDaysWithLegacyFallback,
    normalizeEmptyInboxDays,
} from './AchievementsHelper'

describe('AchievementsHelper', () => {
    const today = moment('2026-07-02', 'YYYY-MM-DD').valueOf()

    it('normalizes valid day keys and removes duplicates', () => {
        expect(normalizeEmptyInboxDays(['2026-07-02', 'invalid', '2026-07-01', '2026-07-02'])).toEqual([
            '2026-07-01',
            '2026-07-02',
        ])
    })

    it('uses the legacy last achieved day only when history has not been initialized', () => {
        expect(getEmptyInboxDaysWithLegacyFallback({ emptyInboxDays: [], lastDayEmptyInbox: today })).toEqual([])
        expect(getEmptyInboxDaysWithLegacyFallback({ lastDayEmptyInbox: today })).toEqual(['2026-07-02'])
    })

    it('calculates total, current, and longest streaks', () => {
        const days = [
            '2026-01-01',
            '2026-01-02',
            '2026-01-03',
            '2026-06-28',
            '2026-06-29',
            '2026-06-30',
            '2026-07-01',
            '2026-07-02',
        ]

        expect(getEmptyInboxAchievementStats(days, today)).toEqual({
            currentStreak: 5,
            longestStreak: 5,
            totalDays: 8,
        })
    })

    it('keeps a streak current through the end of the following day', () => {
        expect(getEmptyInboxAchievementStats(['2026-06-30', '2026-07-01'], today).currentStreak).toBe(2)
        expect(getEmptyInboxAchievementStats(['2026-06-29', '2026-06-30'], today).currentStreak).toBe(0)
    })

    it('builds Monday-first activity weeks and marks future days', () => {
        const weeks = buildEmptyInboxActivityWeeks(['2026-07-02', '2026-07-03'], 2, today)

        expect(weeks[0].days[0].dateKey).toBe('2026-06-22')
        expect(weeks[1].days[3]).toMatchObject({ dateKey: '2026-07-02', achieved: true, isToday: true })
        expect(weeks[1].days[4]).toMatchObject({ dateKey: '2026-07-03', achieved: false, isFuture: true })
    })

    it('groups month labels across their week columns', () => {
        const weeks = buildEmptyInboxActivityWeeks([], 41, today)

        expect(buildEmptyInboxMonthSegments(weeks).slice(0, 2)).toEqual([
            { monthName: 'September', numberOfWeeks: 1 },
            { monthName: 'October', numberOfWeeks: 4 },
        ])
    })
})
