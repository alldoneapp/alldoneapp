import moment from 'moment'

import {
    DEFAULT_WORKING_HOURS_END,
    DEFAULT_WORKING_HOURS_START,
    MEETING_TIME_CALENDAR_LOADING,
    MEETING_TIME_CALENDAR_UNAVAILABLE,
    MEETING_TIME_LOADING,
    MEETING_TIME_NO_CALENDAR,
    MEETING_TIME_READY,
    WORKDAY_AFTER,
    WORKDAY_BEFORE,
    WORKDAY_DURING,
    computeMeetingTime,
    deriveMeetingTimeView,
    formatClockTime,
    formatDurationCompact,
    formatWorkingHoursRange,
    getMeetingInterval,
    getRemainingWindow,
    getWorkingWindow,
    isAfterWorkView,
    isSoloWorkBlock,
    mergeIntervalsInWindow,
    resolveWorkingHours,
} from './meetingTimeToday'

// Every timestamp is built in the test runner's local zone, like the feature reads "today".
const DAY = '2026-11-23'
const at = clock => moment(`${DAY}T${clock}:00`).valueOf()
const iso = clock => moment(`${DAY}T${clock}:00`).format() // with the local offset, like Google
const NOW = at('16:00')
// Before the working day: the remaining window is the whole window (the pre-live figures).
const EARLY = at('07:00')

let nextId = 0
const meeting = (start, end, extra = {}) => ({
    id: extra.id || `event-${++nextId}`,
    name: extra.name || `Meeting ${nextId}`,
    calendarData: { start: { dateTime: iso(start) }, end: { dateTime: iso(end) }, ...(extra.calendarData || {}) },
})

const WINDOW_9_17 = getWorkingWindow({ start: '09:00', end: '17:00' }, NOW)

describe('resolveWorkingHours', () => {
    it('reuses the saved meeting link working hours', () => {
        expect(resolveWorkingHours({ workingHoursStart: '08:30', workingHoursEnd: '18:00' })).toEqual({
            start: '08:30',
            end: '18:00',
            isDefault: false,
        })
    })

    it('falls back to the labelled 9–17 default when nothing is saved', () => {
        const expected = { start: DEFAULT_WORKING_HOURS_START, end: DEFAULT_WORKING_HOURS_END, isDefault: true }
        expect(resolveWorkingHours(null)).toEqual(expected)
        expect(resolveWorkingHours({ slug: 'karsten' })).toEqual(expected)
        expect(expected.start).toBe('09:00')
        expect(expected.end).toBe('17:00')
    })

    it('does not trust malformed or inverted saved hours', () => {
        expect(resolveWorkingHours({ workingHoursStart: '9', workingHoursEnd: '17:00' }).isDefault).toBe(true)
        expect(resolveWorkingHours({ workingHoursStart: '18:00', workingHoursEnd: '09:00' }).isDefault).toBe(true)
        expect(resolveWorkingHours({ workingHoursStart: '09:00', workingHoursEnd: '09:00' }).isDefault).toBe(true)
    })
})

describe('getWorkingWindow', () => {
    it('covers the whole working day, not only the rest of it', () => {
        expect(WINDOW_9_17).toEqual({ startMs: at('09:00'), endMs: at('17:00'), minutes: 480 })
    })

    it('is the same window before, during and after working hours', () => {
        expect(getWorkingWindow({ start: '09:00', end: '17:00' }, at('06:00'))).toEqual(WINDOW_9_17)
        expect(getWorkingWindow({ start: '09:00', end: '17:00' }, at('23:30'))).toEqual(WINDOW_9_17)
    })
})

describe('getMeetingInterval', () => {
    it('ignores all-day events, like the availability engine', () => {
        expect(getMeetingInterval({ calendarData: { start: { date: DAY }, end: { date: '2026-11-24' } } })).toBeNull()
    })

    it('ignores timed events that span several days', () => {
        expect(
            getMeetingInterval({
                calendarData: {
                    start: { dateTime: iso('09:00') },
                    end: { dateTime: moment(`2026-11-25T17:00:00`).format() },
                },
            })
        ).toBeNull()
    })

    it('ignores tasks without calendar data and broken or zero-length timings', () => {
        expect(getMeetingInterval({ id: 'x' })).toBeNull()
        expect(
            getMeetingInterval({ calendarData: { start: { dateTime: 'nonsense' }, end: { dateTime: iso('10:00') } } })
        ).toBeNull()
        expect(getMeetingInterval(meeting('10:00', '10:00'))).toBeNull()
        expect(getMeetingInterval(meeting('11:00', '10:00'))).toBeNull()
    })

    it('reads a Microsoft wall time in its stored timezone (UTC), not in the local zone', () => {
        const interval = getMeetingInterval({
            calendarData: {
                start: { dateTime: '2026-11-23T09:00:00.0000000', timeZone: 'UTC' },
                end: { dateTime: '2026-11-23T10:00:00.0000000', timeZone: 'UTC' },
            },
        })
        expect(interval).toEqual({ startMs: Date.UTC(2026, 10, 23, 9), endMs: Date.UTC(2026, 10, 23, 10) })
    })

    it('reads a Google time with its own offset', () => {
        const interval = getMeetingInterval({
            calendarData: {
                start: { dateTime: '2026-11-23T10:00:00+01:00' },
                end: { dateTime: '2026-11-23T11:30:00+01:00' },
            },
        })
        expect(interval).toEqual({ startMs: Date.UTC(2026, 10, 23, 9), endMs: Date.UTC(2026, 10, 23, 10, 30) })
    })
})

describe('mergeIntervalsInWindow', () => {
    it('clips to the window and unions overlapping and touching intervals', () => {
        const merged = mergeIntervalsInWindow(
            [
                { startMs: at('08:00'), endMs: at('09:30') },
                { startMs: at('11:00'), endMs: at('12:00') },
                { startMs: at('09:30'), endMs: at('10:00') },
                { startMs: at('11:30'), endMs: at('12:30') },
                { startMs: at('16:30'), endMs: at('18:00') },
                { startMs: at('18:00'), endMs: at('19:00') },
            ],
            at('09:00'),
            at('17:00')
        )
        expect(merged).toEqual([
            { startMs: at('09:00'), endMs: at('10:00') },
            { startMs: at('11:00'), endMs: at('12:30') },
            { startMs: at('16:30'), endMs: at('17:00') },
        ])
    })
})

describe('computeMeetingTime', () => {
    it('returns the full window as calendar-free when there is no meeting', () => {
        expect(computeMeetingTime([], WINDOW_9_17, EARLY)).toEqual({
            meetingMinutes: 0,
            freeMinutes: 480,
            windowMinutes: 480,
            remainingWindowMinutes: 480,
            remainingMeetingMinutes: 0,
            remainingFromMs: at('09:00'),
            workdayPhase: WORKDAY_BEFORE,
            meetingCount: 0,
            workBlockCount: 0,
        })
    })

    it('counts meetings that already happened today', () => {
        const result = computeMeetingTime([meeting('09:00', '10:00'), meeting('14:00', '15:00')], WINDOW_9_17)
        expect(result.meetingMinutes).toBe(120)
        expect(result.freeMinutes).toBe(360)
    })

    it('clips meetings at both window borders and drops those outside', () => {
        const result = computeMeetingTime(
            [
                meeting('08:00', '09:30'),
                meeting('16:45', '18:00'),
                meeting('07:00', '08:00'),
                meeting('18:00', '19:00'),
            ],
            WINDOW_9_17
        )
        expect(result.meetingMinutes).toBe(45)
        expect(result.meetingCount).toBe(2)
    })

    it('does not count overlapping meetings twice', () => {
        const result = computeMeetingTime(
            [meeting('10:00', '11:00'), meeting('10:30', '11:30'), meeting('10:15', '10:45')],
            WINDOW_9_17
        )
        expect(result.meetingMinutes).toBe(90)
        expect(result.meetingCount).toBe(3)
    })

    it('deduplicates the same task from two streams and the same event from two calendars', () => {
        const original = meeting('10:00', '11:00', { id: 'event-a', name: 'Weekly' })
        const result = computeMeetingTime(
            [original, { ...original }, meeting('10:00', '11:00', { id: 'event-b', name: 'weekly ' })],
            WINDOW_9_17
        )
        expect(result.meetingMinutes).toBe(60)
        expect(result.meetingCount).toBe(1)
    })

    it('never reports negative free time', () => {
        const result = computeMeetingTime([meeting('08:00', '18:00'), meeting('09:00', '17:00')], WINDOW_9_17)
        expect(result.meetingMinutes).toBe(480)
        expect(result.freeMinutes).toBe(0)
    })

    it('leaves all-day events out of the meeting time', () => {
        const allDay = { id: 'holiday', calendarData: { start: { date: DAY }, end: { date: '2026-11-24' } } }
        expect(computeMeetingTime([allDay, meeting('10:00', '10:30')], WINDOW_9_17).meetingMinutes).toBe(30)
    })

    it('ignores meetings of other days (old open meeting tasks)', () => {
        const yesterday = {
            id: 'old',
            calendarData: {
                start: { dateTime: moment('2026-11-22T10:00:00').format() },
                end: { dateTime: moment('2026-11-22T11:00:00').format() },
            },
        }
        expect(computeMeetingTime([yesterday], WINDOW_9_17).meetingMinutes).toBe(0)
    })
})

// AT-3136 (2026-11-23): "meetings in which I am alone should count as real work time", narrowed by
// the user to solo WORK blocks (the routing model or Google focus time decides "work block").
describe('solo work blocks', () => {
    const SOLO_WORK = { soloEvent: true, workBlock: true, workBlockSource: 'ai' }
    const soloWork = (start, end, extra = {}) =>
        meeting(start, end, {
            ...extra,
            calendarData: { attendeeCount: 0, ...SOLO_WORK, ...(extra.calendarData || {}) },
        })

    it('only a reliably solo event that is a work block is time to work', () => {
        expect(isSoloWorkBlock(soloWork('10:00', '11:00'))).toBe(true)
        // solo, but private (doctor) or not judged yet
        expect(
            isSoloWorkBlock(meeting('10:00', '11:00', { calendarData: { soloEvent: true, workBlock: false } }))
        ).toBe(false)
        expect(isSoloWorkBlock(meeting('10:00', '11:00', { calendarData: { soloEvent: true } }))).toBe(false)
        // a work block with others in it is a working meeting
        expect(
            isSoloWorkBlock(meeting('10:00', '11:00', { calendarData: { soloEvent: false, workBlock: true } }))
        ).toBe(false)
        // participant data unknown (synced before AT-3136, group calendar organizer, hidden guests)
        expect(isSoloWorkBlock(meeting('10:00', '11:00', { calendarData: { workBlock: true } }))).toBe(false)
        expect(
            isSoloWorkBlock(meeting('10:00', '11:00', { calendarData: { attendeeCount: 0, workBlock: true } }))
        ).toBe(false)
        expect(
            isSoloWorkBlock(meeting('10:00', '11:00', { calendarData: { soloEvent: 'true', workBlock: 'true' } }))
        ).toBe(false)
    })

    it('a solo work block (sole self attendee or organizer only) neither reduces time to work nor adds meeting time', () => {
        const result = computeMeetingTime([soloWork('09:00', '12:00'), meeting('14:00', '15:00')], WINDOW_9_17)
        expect(result).toMatchObject({
            meetingMinutes: 60,
            freeMinutes: 420,
            windowMinutes: 480,
            meetingCount: 1,
            workBlockCount: 1,
        })
    })

    it('keeps counting multi-person meetings, also when the others have not accepted, and private solo appointments', () => {
        const invited = meeting('10:00', '11:00', {
            calendarData: { soloEvent: false, attendeeCount: 2, workBlock: false, selfResponseStatus: 'accepted' },
        })
        const doctor = meeting('13:00', '14:00', {
            calendarData: { soloEvent: true, attendeeCount: 0, workBlock: false },
        })
        const unjudged = meeting('15:00', '15:30', { calendarData: { soloEvent: true, attendeeCount: 0 } })
        const result = computeMeetingTime([invited, doctor, unjudged], WINDOW_9_17)
        expect(result.meetingMinutes).toBe(150)
        expect(result.meetingCount).toBe(3)
        expect(result.workBlockCount).toBe(0)
    })

    it('counts events with unavailable participant data as meetings', () => {
        const legacy = meeting('10:00', '11:00', { calendarData: {} })
        const groupCalendar = meeting('11:00', '11:30', { calendarData: { attendeeCount: 0, workBlock: true } })
        const result = computeMeetingTime([legacy, groupCalendar], WINDOW_9_17)
        expect(result.meetingMinutes).toBe(90)
        expect(result.workBlockCount).toBe(0)
    })

    it('counts only the union of the multi-person meetings where they overlap a solo work block', () => {
        const result = computeMeetingTime(
            [
                soloWork('09:00', '12:00'),
                meeting('10:00', '11:00', { calendarData: { soloEvent: false, attendeeCount: 3 } }),
                meeting('10:30', '11:30', { calendarData: { soloEvent: false, attendeeCount: 1 } }),
                soloWork('11:00', '13:00'),
            ],
            WINDOW_9_17
        )
        expect(result.meetingMinutes).toBe(90)
        expect(result.freeMinutes).toBe(390)
        expect(result.meetingCount).toBe(2)
        expect(result.workBlockCount).toBe(2)
    })

    it('still clips at the working-hours borders around a solo work block', () => {
        const result = computeMeetingTime(
            [soloWork('08:00', '10:00'), meeting('08:30', '09:30', { calendarData: { soloEvent: false } })],
            WINDOW_9_17
        )
        expect(result.meetingMinutes).toBe(30)
        expect(result.workBlockCount).toBe(1)
    })

    it('counts an event imported twice once as a meeting when only one copy is a reliable solo work block', () => {
        const fromWork = soloWork('10:00', '11:00', { id: 'copy-a', name: 'Planning' })
        const fromPrivate = meeting('10:00', '11:00', { id: 'copy-b', name: 'Planning', calendarData: {} })
        for (const order of [
            [fromWork, fromPrivate],
            [fromPrivate, fromWork],
        ]) {
            const result = computeMeetingTime(order, WINDOW_9_17)
            expect(result.meetingMinutes).toBe(60)
            expect(result.meetingCount).toBe(1)
            expect(result.workBlockCount).toBe(0)
        }
        const twice = computeMeetingTime(
            [fromWork, soloWork('10:00', '11:00', { id: 'copy-c', name: 'planning' })],
            WINDOW_9_17
        )
        expect(twice).toMatchObject({ meetingMinutes: 0, meetingCount: 0, workBlockCount: 1 })
    })

    it('reports the full window as time to work on a day of only solo work blocks', () => {
        const view = deriveMeetingTimeView({
            settings: null,
            calendarConnected: true,
            tasksLoaded: true,
            tasksError: false,
            tasks: [soloWork('09:00', '17:00')],
            nowMs: EARLY,
        })
        expect(view).toMatchObject({
            status: MEETING_TIME_READY,
            meetingMinutes: 0,
            freeMinutes: 480,
            workBlockCount: 1,
        })
    })
})

// AT-3136, user correction 2026-11-23: "available work time should update live; free hours that
// have already passed are no longer available". Time to work = the rest of today's working window
// [max(now, start), end) minus the union of the meetings in it. The meeting total stays whole-day.
describe('remaining time to work (live)', () => {
    const WINDOW_9_18 = getWorkingWindow({ start: '09:00', end: '18:00' }, NOW)
    const SOLO_WORK = { soloEvent: true, workBlock: true }
    const day = [
        meeting('09:30', '10:30', { name: 'Standup' }), // over by noon
        meeting('11:30', '12:30', { name: 'Review' }), // ongoing at noon
        meeting('12:00', '13:00', { name: 'Lunch call' }), // overlaps the ongoing one
        meeting('15:00', '16:00', { name: 'Planning' }), // future
        meeting('17:30', '19:00', { name: 'Late' }), // clipped at 18:00
    ]
    const live = nowClock => computeMeetingTime(day, WINDOW_9_18, at(nowClock))

    it('is the remaining window from max(now, start) to the end, with its phase', () => {
        expect(getRemainingWindow(WINDOW_9_18, at('06:00'))).toEqual({
            startMs: at('09:00'),
            endMs: at('18:00'),
            minutes: 540,
            phase: WORKDAY_BEFORE,
        })
        expect(getRemainingWindow(WINDOW_9_18, at('09:00'))).toMatchObject({ minutes: 540, phase: WORKDAY_DURING })
        expect(getRemainingWindow(WINDOW_9_18, at('14:15'))).toEqual({
            startMs: at('14:15'),
            endMs: at('18:00'),
            minutes: 225,
            phase: WORKDAY_DURING,
        })
        expect(getRemainingWindow(WINDOW_9_18, at('18:00'))).toEqual({
            startMs: at('18:00'),
            endMs: at('18:00'),
            minutes: 0,
            phase: WORKDAY_AFTER,
        })
        expect(getRemainingWindow(WINDOW_9_18, at('23:59'))).toMatchObject({ minutes: 0, phase: WORKDAY_AFTER })
    })

    it('before the working day: the whole day is still available', () => {
        // 540 − (60 + 90 union 11:30–13:00 + 60 + 30) = 540 − 240
        expect(live('07:45')).toMatchObject({
            meetingMinutes: 240,
            freeMinutes: 300,
            remainingWindowMinutes: 540,
            remainingMeetingMinutes: 240,
            workdayPhase: WORKDAY_BEFORE,
            meetingCount: 5,
        })
    })

    it('during the working day: elapsed free time is gone, the meeting total stays whole-day', () => {
        // 11:00: 7h left; meetings ahead 11:30–13:00, 15–16, 17:30–18 = 3h → 4h free.
        expect(live('11:00')).toMatchObject({ meetingMinutes: 240, freeMinutes: 240, workdayPhase: WORKDAY_DURING })
        // 10:59 → 11:00 → 11:01: one more minute of free time gone each minute.
        expect(live('10:59').freeMinutes).toBe(241)
        expect(live('11:01').freeMinutes).toBe(239)
    })

    it('an ongoing meeting only takes its rest, overlapping ones count once', () => {
        // 12:15: inside the union 11:30–13:00 → 45 min of it left, + 60 + 30 ahead.
        expect(live('12:15')).toMatchObject({ remainingWindowMinutes: 345, remainingMeetingMinutes: 135 })
        expect(live('12:15').freeMinutes).toBe(210)
        // Free time does not shrink while sitting in a meeting.
        expect(live('12:00').freeMinutes).toBe(live('12:59').freeMinutes)
        expect(live('12:00').freeMinutes).toBe(210)
    })

    it('a meeting that is over no longer reduces the available time', () => {
        const before = computeMeetingTime(day.slice(1), WINDOW_9_18, at('10:45')).freeMinutes
        expect(live('10:45').freeMinutes).toBe(before)
    })

    it('future meetings and the end clip still count until the end of the working hours', () => {
        // 17:10: 50 min left, 17:30–18:00 meeting → 20 min.
        expect(live('17:10')).toMatchObject({ freeMinutes: 20, remainingMeetingMinutes: 30 })
        // 17:45: inside the last meeting → nothing free.
        expect(live('17:45')).toMatchObject({ freeMinutes: 0, remainingWindowMinutes: 15 })
    })

    it('after the working day: zero available, whole-day meeting total unchanged', () => {
        expect(live('18:00')).toMatchObject({
            freeMinutes: 0,
            remainingWindowMinutes: 0,
            remainingMeetingMinutes: 0,
            meetingMinutes: 240,
            workdayPhase: WORKDAY_AFTER,
        })
        expect(live('22:30').freeMinutes).toBe(0)
    })

    it('a solo work block ahead stays time to work; a real meeting overlapping it still counts', () => {
        const tasks = [
            meeting('13:00', '14:00', { calendarData: SOLO_WORK }),
            meeting('15:00', '17:00', { calendarData: SOLO_WORK }),
            meeting('16:00', '16:30', { calendarData: { soloEvent: false, attendeeCount: 2 } }),
        ]
        expect(computeMeetingTime(tasks, WINDOW_9_18, at('14:30'))).toMatchObject({
            freeMinutes: 180, // 14:30–18:00 = 210 − 30
            remainingMeetingMinutes: 30,
            meetingMinutes: 30,
            workBlockCount: 2,
        })
    })

    it('deduplicates the same event from two calendars in the remaining window too', () => {
        const tasks = [
            meeting('15:00', '16:00', { id: 'a', name: 'Weekly' }),
            meeting('15:00', '16:00', { id: 'b', name: 'weekly' }),
        ]
        expect(computeMeetingTime(tasks, WINDOW_9_18, at('15:30'))).toMatchObject({
            remainingMeetingMinutes: 30,
            freeMinutes: 120,
            meetingCount: 1,
        })
    })

    it('counts partial minutes exactly (the display rounds)', () => {
        const result = computeMeetingTime([], WINDOW_9_18, at('17:00') + 30 * 1000)
        expect(result.freeMinutes).toBe(59.5)
        expect(formatDurationCompact(result.freeMinutes)).toBe('1h')
    })

    it('is what deriveMeetingTimeView reports for its nowMs', () => {
        const view = deriveMeetingTimeView({
            settings: { workingHoursStart: '09:00', workingHoursEnd: '18:00' },
            calendarConnected: true,
            tasksLoaded: true,
            tasksError: false,
            tasks: day,
            nowMs: at('12:15'),
        })
        expect(view).toMatchObject({
            status: MEETING_TIME_READY,
            meetingMinutes: 240,
            freeMinutes: 210,
            windowMinutes: 540,
            remainingFromMs: at('12:15'),
        })
    })
})

describe('deriveMeetingTimeView', () => {
    const base = {
        settings: { workingHoursStart: '09:00', workingHoursEnd: '18:00' },
        calendarConnected: true,
        tasksLoaded: true,
        tasksError: false,
        syncStatus: 'synced',
        tasks: [meeting('10:00', '12:00')],
        nowMs: NOW,
    }

    it('waits for the working-hours doc before showing anything', () => {
        expect(deriveMeetingTimeView({ ...base, settings: undefined })).toEqual({ status: MEETING_TIME_LOADING })
    })

    it('reports the figures when everything answered', () => {
        expect(deriveMeetingTimeView({ ...base, nowMs: EARLY })).toMatchObject({
            status: MEETING_TIME_READY,
            meetingMinutes: 120,
            freeMinutes: 420,
            windowMinutes: 540,
            syncStatus: 'synced',
            workingHours: { start: '09:00', end: '18:00', isDefault: false },
        })
    })

    it('shows no meeting figures without a connected calendar, only the working time', () => {
        const view = deriveMeetingTimeView({ ...base, settings: null, calendarConnected: false })
        expect(view).toEqual({
            status: MEETING_TIME_NO_CALENDAR,
            windowMinutes: 480,
            workingHours: { start: '09:00', end: '17:00', isDefault: true },
        })
        expect(view.meetingMinutes).toBeUndefined()
    })

    it('does not turn missing or failed calendar data into zeros', () => {
        const loading = deriveMeetingTimeView({ ...base, tasksLoaded: false })
        expect(loading.status).toBe(MEETING_TIME_CALENDAR_LOADING)
        expect(loading.meetingMinutes).toBeUndefined()

        const failed = deriveMeetingTimeView({ ...base, tasksError: true })
        expect(failed.status).toBe(MEETING_TIME_CALENDAR_UNAVAILABLE)
        expect(failed.freeMinutes).toBeUndefined()
    })
})

// AT-3157: "Feierabend" follows the end of the working window, not a 0 figure.
describe('isAfterWorkView (AT-3157)', () => {
    const base = {
        settings: { workingHoursStart: '09:00', workingHoursEnd: '18:00' },
        calendarConnected: true,
        tasksLoaded: true,
        tasksError: false,
        syncStatus: 'synced',
        tasks: [],
    }

    it('is true once the working hours are over, from the end minute on', () => {
        expect(isAfterWorkView(deriveMeetingTimeView({ ...base, nowMs: at('18:00') }))).toBe(true)
        expect(isAfterWorkView(deriveMeetingTimeView({ ...base, nowMs: at('20:59') }))).toBe(true)
        expect(isAfterWorkView(deriveMeetingTimeView({ ...base, nowMs: at('17:59') }))).toBe(false)
        expect(isAfterWorkView(deriveMeetingTimeView({ ...base, nowMs: EARLY }))).toBe(false)
    })

    it('is false when meetings fill the rest of the working day (0 left, but not after work)', () => {
        const view = deriveMeetingTimeView({ ...base, tasks: [meeting('15:00', '18:00')], nowMs: NOW })
        expect(view.freeMinutes).toBe(0)
        expect(view.workdayPhase).toBe(WORKDAY_DURING)
        expect(isAfterWorkView(view)).toBe(false)
    })

    it('knows the phase while the meetings load, since it does not depend on the calendar', () => {
        const loading = deriveMeetingTimeView({ ...base, tasksLoaded: false, nowMs: at('19:00') })
        expect(loading.status).toBe(MEETING_TIME_CALENDAR_LOADING)
        expect(loading.workdayPhase).toBe(WORKDAY_AFTER)
        expect(loading.freeMinutes).toBeUndefined()
        expect(isAfterWorkView(loading)).toBe(true)
        const during = deriveMeetingTimeView({ ...base, tasksLoaded: false, nowMs: NOW })
        expect(isAfterWorkView(during)).toBe(false)
    })

    it('is false where the line shows no figure (no calendar, calendar data unavailable, loading hours)', () => {
        const late = at('19:00')
        expect(isAfterWorkView(deriveMeetingTimeView({ ...base, calendarConnected: false, nowMs: late }))).toBe(false)
        expect(isAfterWorkView(deriveMeetingTimeView({ ...base, tasksError: true, nowMs: late }))).toBe(false)
        expect(isAfterWorkView(deriveMeetingTimeView({ ...base, settings: undefined, nowMs: late }))).toBe(false)
        expect(isAfterWorkView(null)).toBe(false)
    })
})

describe('formatting', () => {
    it('formats durations compactly', () => {
        expect(formatDurationCompact(0)).toBe('0h')
        expect(formatDurationCompact(45)).toBe('45m')
        expect(formatDurationCompact(120)).toBe('2h')
        expect(formatDurationCompact(150)).toBe('2h 30m')
        expect(formatDurationCompact(89.6)).toBe('1h 30m')
        expect(formatDurationCompact(-5)).toBe('0h')
    })

    it('formats a clock time in 24 h form', () => {
        expect(formatClockTime(at('09:00'))).toBe('9:00')
        expect(formatClockTime(at('14:05'))).toBe('14:05')
    })

    it('formats the working hours range', () => {
        expect(formatWorkingHoursRange({ start: '09:00', end: '17:00' })).toBe('9–17')
        expect(formatWorkingHoursRange({ start: '08:30', end: '17:45' })).toBe('8:30–17:45')
    })
})
