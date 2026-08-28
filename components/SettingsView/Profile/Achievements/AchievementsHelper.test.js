import moment from 'moment'

import {
    buildEmptyInboxActivityWeeks,
    buildEmptyInboxMonthSegments,
    getEmptyInboxAchievementStats,
    getEmptyInboxDaysWithLegacyFallback,
    getTodayEmptyInboxTimestamp,
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

    /**
     * AT-2461 — the card reports WHEN today's inbox zero happened, and `lastDayEmptyInbox` is the
     * only field that knows. It is a running "last time" pointer, not a per-day record, so every
     * rule here is about refusing to report a time that belongs to some other day — or to no day at
     * all.
     */
    describe('getTodayEmptyInboxTimestamp', () => {
        const reachedToday = moment('2026-07-02', 'YYYY-MM-DD').add(18, 'hours').add(34, 'minutes').valueOf()

        it('reports the moment today’s inbox zero was reached', () => {
            const user = { lastDayEmptyInbox: reachedToday }

            expect(getTodayEmptyInboxTimestamp(user, ['2026-07-01', '2026-07-02'], today)).toBe(reachedToday)
        })

        /**
         * The pointer is only rewritten on a day that is not yet recorded, so on any uncleaned day
         * it still holds an OLDER day's clock time. Reporting it would put a time on a day that
         * never happened — the exact reason the achievement days, not the pointer, decide whether
         * there is anything to report.
         */
        it('never borrows an earlier day’s clock time', () => {
            const reachedYesterday = moment('2026-07-01', 'YYYY-MM-DD').add(9, 'hours').valueOf()

            expect(getTodayEmptyInboxTimestamp({ lastDayEmptyInbox: reachedYesterday }, ['2026-07-01'], today)).toBe(
                null
            )
            // Even a day claimed as achieved cannot make a stale pointer speak for it.
            expect(
                getTodayEmptyInboxTimestamp(
                    { lastDayEmptyInbox: reachedYesterday },
                    ['2026-07-01', '2026-07-02'],
                    today
                )
            ).toBe(null)
        })

        /**
         * `ContactsHelper.createUserData` stamps a brand-new account with `lastDayEmptyInbox: now`
         * and an EMPTY day list. Without the second guard, signing up would congratulate you for
         * clearing an inbox you have never seen.
         */
        it('does not congratulate a fresh account for signing up', () => {
            expect(getTodayEmptyInboxTimestamp({ lastDayEmptyInbox: today }, [], today)).toBe(null)
        })

        /**
         * `moment(undefined)` is NOW, which would pass the same-day check and report the current
         * time as an achievement for every account that has never recorded one.
         */
        it('reports nothing when there is no timestamp at all', () => {
            const days = ['2026-07-02']

            expect(getTodayEmptyInboxTimestamp({ lastDayEmptyInbox: undefined }, days, today)).toBe(null)
            expect(getTodayEmptyInboxTimestamp({ lastDayEmptyInbox: null }, days, today)).toBe(null)
            expect(getTodayEmptyInboxTimestamp({ lastDayEmptyInbox: '' }, days, today)).toBe(null)
            // `mapUserData` writes 0 for an account that has never reached empty inbox.
            expect(getTodayEmptyInboxTimestamp({ lastDayEmptyInbox: 0 }, days, today)).toBe(null)
            expect(getTodayEmptyInboxTimestamp({}, days, today)).toBe(null)
            expect(getTodayEmptyInboxTimestamp(undefined, days, today)).toBe(null)
        })

        it('ignores a timestamp it cannot read', () => {
            expect(getTodayEmptyInboxTimestamp({ lastDayEmptyInbox: 'not a date' }, ['2026-07-02'], today)).toBe(null)
        })

        /**
         * An account whose history was never initialized resolves its days from the pointer itself
         * (`getEmptyInboxDaysWithLegacyFallback`), so it must answer exactly as the grid does for it
         * — the card renders one green cell for that day and now names its time too.
         */
        it('works for a legacy account whose day list was derived from the pointer', () => {
            const user = { lastDayEmptyInbox: reachedToday }

            expect(getTodayEmptyInboxTimestamp(user, getEmptyInboxDaysWithLegacyFallback(user), today)).toBe(
                reachedToday
            )
        })
    })
})
