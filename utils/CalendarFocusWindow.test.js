import moment from 'moment'

import * as clientCalendarFocusWindow from './CalendarFocusWindow'

const serverCalendarFocusWindow = require('../functions/shared/calendarFocusWindow')

/**
 * AT-2496 — the shared contract for "may this meeting take the focus task right now".
 *
 * Driven through BOTH mirrors, exactly as `CalendarTaskOrder.test.js` does, because the rule is
 * duplicated for Cloud Functions and a drift between the two is precisely the class of bug this
 * ticket fixed: three pickers, one answer expected.
 *
 * Everything here is expressed in absolute milliseconds and never touches `sortIndex`. That is the
 * whole point — the two authoritative pickers were dead for months because they keyed the rule on
 * `sortIndex`, which AT-2259 had quietly repurposed from "the event start" to "when the sync
 * created this task".
 */

// A concrete Thursday morning in Berlin. Absolute, so the machine's timezone cannot change a result.
const NOW = moment('2026-09-03T11:28:00+02:00').valueOf()
const MINUTE = 60 * 1000

const iso = ms => moment(ms).toISOString()

const timedEvent = (startMs, durationMinutes = 30) => ({
    eventId: 'event-1',
    start: { dateTime: iso(startMs) },
    end: { dateTime: iso(startMs + durationMinutes * MINUTE) },
})

const allDayEvent = (startDay, endDay) => ({
    eventId: 'event-all-day',
    start: { date: startDay },
    end: { date: endDay },
})

describe.each([
    ['client', clientCalendarFocusWindow],
    ['server', serverCalendarFocusWindow],
])('CalendarFocusWindow (%s mirror)', (_name, impl) => {
    const {
        CALENDAR_FOCUS_RUNNING_WINDOW_MS,
        CALENDAR_FOCUS_UPCOMING_WINDOW_MS,
        compareCalendarFocusCandidacy,
        getCalendarFocusCandidacy,
        getCalendarFocusDueDateWindow,
        getCalendarFocusStartMs,
        isCalendarFocusCandidate,
    } = impl

    describe('upcoming meetings — the historical AT-2251 rule, unchanged', () => {
        test('a meeting starting in five minutes is a candidate', () => {
            expect(getCalendarFocusCandidacy(timedEvent(NOW + 5 * MINUTE), NOW)).toEqual({
                startMs: NOW + 5 * MINUTE,
                running: false,
            })
        })

        test('a meeting starting exactly now counts as upcoming, not running', () => {
            expect(getCalendarFocusCandidacy(timedEvent(NOW), NOW)).toEqual({ startMs: NOW, running: false })
        })

        test('the far edge of the window is exclusive', () => {
            expect(getCalendarFocusCandidacy(timedEvent(NOW + CALENDAR_FOCUS_UPCOMING_WINDOW_MS), NOW)).toBeNull()
            expect(
                getCalendarFocusCandidacy(timedEvent(NOW + CALENDAR_FOCUS_UPCOMING_WINDOW_MS - 1), NOW)
            ).not.toBeNull()
        })

        test('a meeting later today is not a candidate', () => {
            expect(isCalendarFocusCandidate(timedEvent(NOW + 3 * 60 * MINUTE), NOW)).toBe(false)
        })
    })

    describe('running meetings (AT-2496)', () => {
        test('a meeting that started ten minutes ago is a candidate', () => {
            expect(getCalendarFocusCandidacy(timedEvent(NOW - 10 * MINUTE, 60), NOW)).toEqual({
                startMs: NOW - 10 * MINUTE,
                running: true,
            })
        })

        test('a meeting that has already ended is not', () => {
            // Started 40 minutes ago, ran 30 — over, even though it is inside the running cap.
            expect(isCalendarFocusCandidate(timedEvent(NOW - 40 * MINUTE, 30), NOW)).toBe(false)
        })

        test('a short meeting is covered right up to its end', () => {
            expect(isCalendarFocusCandidate(timedEvent(NOW - 12 * MINUTE, 13), NOW)).toBe(true)
            expect(isCalendarFocusCandidate(timedEvent(NOW - 13 * MINUTE, 13), NOW)).toBe(false)
        })

        /**
         * The reason the running rule is capped at all. Real calendars are full of multi-hour
         * blocks — the reporting account has a 5-hour "Work Blocker" and 4-hour "Jacob Zeit"
         * blocks — and an uncapped rule would make each of them the focus task for its whole
         * length, so every task completed inside a work block handed focus straight back to the
         * block.
         */
        test('a five-hour block stops taking focus once the cap expires', () => {
            const fiveHours = 5 * 60
            expect(isCalendarFocusCandidate(timedEvent(NOW - 30 * MINUTE, fiveHours), NOW)).toBe(true)
            expect(isCalendarFocusCandidate(timedEvent(NOW - CALENDAR_FOCUS_RUNNING_WINDOW_MS, fiveHours), NOW)).toBe(
                false
            )
        })

        test('an event with no usable end falls back to the cap', () => {
            const noEnd = { start: { dateTime: iso(NOW - 10 * MINUTE) } }
            expect(isCalendarFocusCandidate(noEnd, NOW)).toBe(true)

            const malformedEnd = {
                start: { dateTime: iso(NOW - 10 * MINUTE) },
                end: { dateTime: iso(NOW - 20 * MINUTE) }, // end before start
            }
            expect(isCalendarFocusCandidate(malformedEnd, NOW)).toBe(true)
        })
    })

    describe('all-day events are upcoming-only', () => {
        /**
         * They are birthdays, holidays and multi-day stays, not meetings you are in. Treating one
         * as "running" would hand it the focus task for the whole day — or, for the reporting
         * account's two-day "Stay at Motel One", for two.
         */
        test('an all-day event covering right now never takes focus', () => {
            expect(isCalendarFocusCandidate(allDayEvent('2026-09-03', '2026-09-04'), NOW)).toBe(false)
        })

        test('a multi-day event covering right now never takes focus', () => {
            expect(isCalendarFocusCandidate(allDayEvent('2026-09-02', '2026-09-05'), NOW)).toBe(false)
        })

        test('but one about to start still qualifies, exactly as before', () => {
            const startsSoon = moment(NOW + 5 * MINUTE)
            const allDay = { start: { date: startsSoon.toISOString() }, end: { date: '2026-09-04' } }
            expect(getCalendarFocusCandidacy(allDay, NOW)).toEqual({ startMs: NOW + 5 * MINUTE, running: false })
        })
    })

    describe('non-candidates', () => {
        // moment warns (once, loudly) when it falls back to `new Date()` for a non-ISO string.
        // That fallback is exactly what the unparseable cases below exercise, so keep it quiet.
        let warnSpy
        beforeAll(() => {
            warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
        })
        afterAll(() => warnSpy.mockRestore())

        test.each([
            ['no calendar data', null],
            ['undefined calendar data', undefined],
            ['calendar data without a start', { eventId: 'e' }],
            ['an unparseable start', { start: { dateTime: 'not-a-date' } }],
            ['an empty start', { start: { dateTime: '' } }],
        ])('%s is never a candidate', (_label, calendarData) => {
            expect(getCalendarFocusCandidacy(calendarData, NOW)).toBeNull()
        })

        test('a non-finite now is never a candidate', () => {
            expect(getCalendarFocusCandidacy(timedEvent(NOW), Number.NaN)).toBeNull()
        })
    })

    describe('getCalendarFocusStartMs', () => {
        test('reads the event start and nothing else', () => {
            expect(getCalendarFocusStartMs(timedEvent(NOW + MINUTE))).toBe(NOW + MINUTE)
            expect(getCalendarFocusStartMs(null)).toBeNull()
        })

        test('never consults sortIndex — the encoding AT-2259 retired', () => {
            const meeting = timedEvent(NOW + 5 * MINUTE)
            // A production calendar task carries the SYNC time here, hours before the event.
            const taskShape = { sortIndex: NOW - 6 * 60 * MINUTE, calendarData: meeting }
            expect(getCalendarFocusStartMs(taskShape.calendarData)).toBe(NOW + 5 * MINUTE)
            expect(isCalendarFocusCandidate(taskShape.calendarData, NOW)).toBe(true)
        })
    })

    describe('ranking', () => {
        const upcomingSoon = getCalendarFocusCandidacy(timedEvent(NOW + 2 * MINUTE), NOW)
        const upcomingLater = getCalendarFocusCandidacy(timedEvent(NOW + 10 * MINUTE), NOW)
        const runningRecent = getCalendarFocusCandidacy(timedEvent(NOW - 5 * MINUTE, 60), NOW)
        const runningOlder = getCalendarFocusCandidacy(timedEvent(NOW - 40 * MINUTE, 90), NOW)

        test('an upcoming meeting outranks one already running', () => {
            expect(compareCalendarFocusCandidacy(upcomingLater, runningRecent)).toBeLessThan(0)
            expect(compareCalendarFocusCandidacy(runningRecent, upcomingLater)).toBeGreaterThan(0)
        })

        test('among upcoming meetings the earliest wins', () => {
            expect(compareCalendarFocusCandidacy(upcomingSoon, upcomingLater)).toBeLessThan(0)
        })

        test('among running meetings the most recently started wins', () => {
            expect(compareCalendarFocusCandidacy(runningRecent, runningOlder)).toBeLessThan(0)
        })

        test('any candidate beats no candidate, so a picker can seed with null', () => {
            expect(compareCalendarFocusCandidacy(runningOlder, null)).toBeLessThan(0)
            expect(compareCalendarFocusCandidacy(null, runningOlder)).toBeGreaterThan(0)
            expect(compareCalendarFocusCandidacy(null, null)).toBe(0)
        })
    })

    describe('getCalendarFocusDueDateWindow', () => {
        const DAY = 24 * 60 * MINUTE

        test('brackets now by the rule window plus a day of local-midnight slack', () => {
            const { from, to } = getCalendarFocusDueDateWindow(NOW)

            expect(from).toBe(NOW - CALENDAR_FOCUS_RUNNING_WINDOW_MS - DAY)
            expect(to).toBe(NOW + CALENDAR_FOCUS_UPCOMING_WINDOW_MS + DAY)
        })

        test("covers a real production calendar task's dueDate", () => {
            // Observed in production: a meeting on 2026-09-03 carries dueDate = LOCAL midnight of
            // its event day (22:00 UTC the previous day for this UTC+2 account), while its
            // sortIndex is the 05:37 sync time.
            const dueDate = moment('2026-09-03T00:00:00+02:00').valueOf()
            const { from, to } = getCalendarFocusDueDateWindow(NOW)

            expect(dueDate).toBeGreaterThanOrEqual(from)
            expect(dueDate).toBeLessThanOrEqual(to)
        })

        /**
         * The window must not depend on knowing the reader's timezone: the Cloud Function is
         * called with `timezoneOffset === null` on some paths, and a UTC-day window would exclude
         * the local-midnight dueDates of every non-UTC user — silently, which is the exact failure
         * mode this ticket exists to remove.
         */
        test('covers every candidate in every timezone', () => {
            const { from, to } = getCalendarFocusDueDateWindow(NOW)

            for (let offsetHours = -12; offsetHours <= 14; offsetHours += 1) {
                // A meeting anywhere in the relevant span, and its event day's local midnight.
                for (const startOffset of [
                    -CALENDAR_FOCUS_RUNNING_WINDOW_MS + 1,
                    0,
                    CALENDAR_FOCUS_UPCOMING_WINDOW_MS - 1,
                ]) {
                    const start = moment(NOW + startOffset).utcOffset(offsetHours * 60)
                    expect(getCalendarFocusCandidacy(timedEvent(start.valueOf(), 90), NOW)).not.toBeNull()

                    const localMidnight = start.clone().startOf('day').valueOf()
                    expect(localMidnight).toBeGreaterThanOrEqual(from)
                    expect(localMidnight).toBeLessThanOrEqual(to)
                }
            }
        })
    })
})

describe('CalendarFocusWindow mirrors', () => {
    test('expose the same API and the same windows', () => {
        expect(Object.keys(serverCalendarFocusWindow).sort()).toEqual(
            expect.arrayContaining([
                'CALENDAR_FOCUS_RUNNING_WINDOW_MS',
                'CALENDAR_FOCUS_UPCOMING_WINDOW_MS',
                'compareCalendarFocusCandidacy',
                'getCalendarFocusCandidacy',
                'getCalendarFocusDueDateWindow',
                'getCalendarFocusStartMs',
                'isCalendarFocusCandidate',
            ])
        )

        expect(serverCalendarFocusWindow.CALENDAR_FOCUS_UPCOMING_WINDOW_MS).toBe(
            clientCalendarFocusWindow.CALENDAR_FOCUS_UPCOMING_WINDOW_MS
        )
        expect(serverCalendarFocusWindow.CALENDAR_FOCUS_RUNNING_WINDOW_MS).toBe(
            clientCalendarFocusWindow.CALENDAR_FOCUS_RUNNING_WINDOW_MS
        )
    })

    test('agree case by case across the whole day', () => {
        const cases = []
        for (let offsetMinutes = -180; offsetMinutes <= 180; offsetMinutes += 7) {
            cases.push(timedEvent(NOW + offsetMinutes * MINUTE, 45))
            cases.push(timedEvent(NOW + offsetMinutes * MINUTE, 300))
        }
        cases.push(allDayEvent('2026-09-03', '2026-09-04'))

        cases.forEach(calendarData => {
            expect(clientCalendarFocusWindow.getCalendarFocusCandidacy(calendarData, NOW)).toEqual(
                serverCalendarFocusWindow.getCalendarFocusCandidacy(calendarData, NOW)
            )
        })
    })
})
