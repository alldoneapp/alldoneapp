import moment from 'moment-timezone'

import {
    FREE_DAY_COMPLETE,
    FREE_DAY_FUTURE,
    FREE_DAY_NON_WORKDAY,
    FREE_DAY_TODAY,
    computeMeetingFreeWorkTime,
    getFreeTimeExclusion,
    getWorkingWindowForDay,
    resolveIncludeWeekends,
} from './meetingFreeWorkTime'
import { buildMeetingStatsEntries } from './buildMeetingStatsEntries'

// Monday 2026-11-23 in the runner's local zone (TZ=UTC in CI), like the app's local days.
const MONDAY = moment('2026-11-23T00:00:00')
const dayStart = offset => MONDAY.clone().add(offset, 'days').valueOf()
const at = (offset, clock) => moment(`${MONDAY.clone().add(offset, 'days').format('YYYY-MM-DD')}T${clock}:00`).valueOf()
const WEEK = [0, 1, 2, 3, 4, 5, 6].map(dayStart)
const WEEK_END = dayStart(7)
const AFTER_WEEK = dayStart(8)
const HOURS = { start: '09:00', end: '17:00' }
const MIN = 60 * 1000

const task = (id, startMs, endMs, extra = {}) => ({
    id,
    projectId: 'p1',
    name: id,
    done: true,
    ...extra,
    calendarData: { startMs, endMs, attendeeCount: 3, ...(extra.calendarData || {}) },
})

const compute = ({ tasks = [], reviews = {}, nowMs = AFTER_WEEK, ...rest } = {}) =>
    computeMeetingFreeWorkTime({
        entries: buildMeetingStatsEntries({ tasks, reviews }),
        workingHours: HOURS,
        includeWeekends: false,
        dayStartsMs: WEEK,
        rangeEndMs: WEEK_END,
        nowMs,
        ...rest,
    })

describe('computeMeetingFreeWorkTime', () => {
    it('clips meetings to the working window and counts overlapping meetings once', () => {
        const { days } = compute({
            tasks: [
                task('early', at(0, '08:30'), at(0, '09:30')),
                task('overlap', at(0, '09:00'), at(0, '10:00')),
                task('late', at(0, '16:30'), at(0, '18:00')),
            ],
        })
        const monday = days[0]
        expect(monday.status).toBe(FREE_DAY_COMPLETE)
        expect(monday.windowMs).toBe(8 * 60 * MIN)
        expect(monday.meetingMs).toBe(90 * MIN) // 9:00–10:00 + 16:30–17:00
        expect(monday.freeMs).toBe(390 * MIN)
        expect(monday.meetingCount).toBe(3)
        expect(monday.meetingIntervals).toEqual([
            { startMs: at(0, '09:00'), endMs: at(0, '10:00') },
            { startMs: at(0, '16:30'), endMs: at(0, '17:00') },
        ])
    })

    it('counts the same event from two calendars once', () => {
        const { days } = compute({
            tasks: [
                task('a', at(0, '10:00'), at(0, '11:00'), { name: 'Weekly' }),
                task('b', at(0, '10:00'), at(0, '11:00'), { name: 'Weekly', projectId: 'p2' }),
            ],
        })
        expect(days[0].meetingMs).toBe(60 * MIN)
        expect(days[0].meetingCount).toBe(1)
    })

    it('treats reliably solo work blocks as work time, like "Time to work"', () => {
        const { days } = compute({
            tasks: [
                task('focus', at(0, '10:00'), at(0, '12:00'), {
                    calendarData: { soloEvent: true, workBlock: true },
                }),
                // Solo but not a work block (doctor): still occupies the window.
                task('doctor', at(1, '10:00'), at(1, '11:00'), { calendarData: { soloEvent: true } }),
            ],
        })
        expect(days[0].meetingMs).toBe(0)
        expect(days[0].freeMs).toBe(8 * 60 * MIN)
        expect(days[0].soloBlockCount).toBe(1)
        expect(days[1].meetingMs).toBe(60 * MIN)
    })

    it('keeps a slot a meeting when another calendar imported it as a normal meeting', () => {
        const { days } = compute({
            tasks: [
                task('solo-copy', at(0, '10:00'), at(0, '11:00'), {
                    name: 'Planning',
                    calendarData: { soloEvent: true, workBlock: true },
                }),
                task('meeting-copy', at(0, '10:00'), at(0, '11:00'), { name: 'Planning' }),
            ],
        })
        expect(days[0].meetingMs).toBe(60 * MIN)
        expect(days[0].soloBlockCount).toBe(0)
    })

    it('ignores all-day, declined and multi-day events and honours the meeting review', () => {
        const { days } = compute({
            tasks: [
                task('holiday', at(0, '00:00'), at(1, '00:00'), {
                    calendarData: { isAllDay: true, start: { date: '2026-11-23' }, end: { date: '2026-11-24' } },
                }),
                task('declined', at(0, '09:00'), at(0, '10:00'), { calendarData: { selfResponseStatus: 'declined' } }),
                task('trip', at(0, '15:00'), at(1, '11:00'), {
                    calendarData: {
                        start: { dateTime: '2026-11-23T15:00:00Z' },
                        end: { dateTime: '2026-11-24T11:00:00Z' },
                    },
                }),
                task('skipped', at(0, '11:00'), at(0, '12:00')),
                task('overran', at(0, '13:00'), at(0, '14:00')),
            ],
            reviews: {
                skipped: { reviewStatus: 'rated', attendance: 'not_attended' },
                overran: { reviewStatus: 'rated', actualStartMs: at(0, '13:00'), actualEndMs: at(0, '14:30') },
            },
        })
        expect(days[0].meetingMs).toBe(90 * MIN)
        expect(days[0].hasCalendarEntries).toBe(true)
        expect(days[1].meetingMs).toBe(0)
    })

    it('counts past appointments that were never checked off', () => {
        const { days } = compute({ tasks: [task('open', at(0, '10:00'), at(0, '11:00'), { done: false })] })
        expect(days[0].meetingMs).toBe(60 * MIN)
    })

    it('uses the "Include weekends" setting for workdays', () => {
        const tasks = [task('saturday', at(5, '10:00'), at(5, '11:00'))]
        const weekdays = compute({ tasks })
        expect(weekdays.days[5].status).toBe(FREE_DAY_NON_WORKDAY)
        expect(weekdays.days[5].freeMs).toBeNull()
        expect(weekdays.summary.completeWorkdays).toBe(5)
        expect(weekdays.summary.windowMs).toBe(5 * 8 * 60 * MIN)

        const everyDay = compute({ tasks, includeWeekends: true })
        expect(everyDay.days[5].status).toBe(FREE_DAY_COMPLETE)
        expect(everyDay.days[5].freeMs).toBe(7 * 60 * MIN)
        expect(everyDay.summary.completeWorkdays).toBe(7)
    })

    it('shows today from the calendar but keeps it and future days out of the totals', () => {
        const { days, summary } = compute({
            tasks: [
                task('mon', at(0, '10:00'), at(0, '12:00')),
                task('wed', at(2, '10:00'), at(2, '11:00'), { done: false }),
                task('thu', at(3, '10:00'), at(3, '11:00'), { done: false }),
            ],
            nowMs: at(2, '12:00'),
        })
        expect(days[1].status).toBe(FREE_DAY_COMPLETE)
        expect(days[2].status).toBe(FREE_DAY_TODAY)
        expect(days[2].meetingMs).toBe(60 * MIN)
        expect(days[3].status).toBe(FREE_DAY_FUTURE)
        expect(days[3].freeMs).toBeNull()
        expect(summary.completeWorkdays).toBe(2)
        expect(summary.meetingMs).toBe(120 * MIN)
        expect(summary.freeMs).toBe(14 * 60 * MIN)
        expect(summary.averageFreeMs).toBe(7 * 60 * MIN)
        expect(summary.hasToday).toBe(true)
    })

    it('flags workdays without any calendar entry instead of presenting them as verified', () => {
        const { days, summary } = compute({
            tasks: [
                task('mon', at(0, '10:00'), at(0, '11:00')),
                task('tue-all-day', at(1, '00:00'), at(2, '00:00'), { calendarData: { isAllDay: true } }),
            ],
        })
        expect(days[0].noCalendarEntries).toBe(false)
        // An all-day entry proves the calendar was synced: not flagged, still fully free.
        expect(days[1].noCalendarEntries).toBe(false)
        expect(days[1].freeMs).toBe(8 * 60 * MIN)
        expect(days[2].noCalendarEntries).toBe(true)
        expect(days[2].freeMs).toBe(8 * 60 * MIN)
        expect(summary.noCalendarEntryDays).toBe(3) // Wed, Thu, Fri
    })

    it('keeps the free time global with a project scope and only adds that project’s part', () => {
        const tasks = [
            task('own', at(0, '10:00'), at(0, '11:00')),
            task('other', at(0, '10:30'), at(0, '12:00'), { projectId: 'p2' }),
        ]
        const global = compute({ tasks })
        const scoped = compute({ tasks, projectId: 'p1' })
        expect(scoped.days[0].freeMs).toBe(global.days[0].freeMs)
        expect(scoped.days[0].meetingMs).toBe(120 * MIN)
        expect(scoped.days[0].scopedMeetingMs).toBe(60 * MIN)
        expect(scoped.summary.scopedMeetingMs).toBe(60 * MIN)
        expect(global.days[0].scopedMeetingMs).toBeNull()
    })

    it('is empty but well-formed without entries', () => {
        const { days, summary } = compute({ tasks: [] })
        expect(days).toHaveLength(7)
        expect(summary.freeShare).toBe(1)
        expect(summary.noCalendarEntryDays).toBe(5)
    })
})

describe('helpers', () => {
    it('reads "Include weekends" only when explicitly on', () => {
        expect(resolveIncludeWeekends(null)).toBe(false)
        expect(resolveIncludeWeekends({ includeWeekends: 'yes' })).toBe(false)
        expect(resolveIncludeWeekends({ includeWeekends: true })).toBe(true)
    })

    it('keeps the wall-clock working hours on a DST change day', () => {
        moment.tz.setDefault('Europe/Berlin')
        try {
            const sunday = moment('2026-03-29T00:00:00').valueOf()
            const window = getWorkingWindowForDay(HOURS, sunday)
            expect(moment(window.startMs).format('HH:mm')).toBe('09:00')
            expect(moment(window.endMs).format('HH:mm')).toBe('17:00')
            expect(window.endMs - window.startMs).toBe(8 * 60 * MIN)
        } finally {
            moment.tz.setDefault()
        }
    })

    it('names why an entry does not occupy working time', () => {
        expect(getFreeTimeExclusion({ excludedReason: 'all_day' })).toBe('all_day')
        expect(getFreeTimeExclusion({ startMs: 2, endMs: 1 })).toBe('invalid')
        expect(getFreeTimeExclusion({ startMs: at(0, '10:00'), endMs: at(0, '11:00'), soloWorkBlock: true })).toBe(
            'solo_work_block'
        )
        expect(getFreeTimeExclusion({ startMs: at(0, '10:00'), endMs: at(0, '11:00') })).toBeNull()
    })
})
