import moment from 'moment'
import { orderBy } from 'lodash'

import {
    compareTasksByCalendarPlacement,
    getCalendarOrderKey,
    getCalendarStartDayKey,
    isCalendarTask,
    orderCalendarTasksLast,
} from './CalendarTaskOrder'
import { sortTasksByPriority, TASK_PRIORITY_MUST_DO, TASK_PRIORITY_NONE, TASK_PRIORITY_SHOULD_DO } from './TaskPriority'

const serverCalendarOrder = require('../functions/shared/calendarTaskOrder')

const NOW = moment('2026-08-18T15:00:00+02:00').valueOf()

/**
 * Exactly what every grouped list runs: `sortIndex` descending, then the shared ordering funnel.
 * See `sortTasksListThatHaveNewTasks` (openTasks.js), `openGoalTasks.js` and `TasksList.js`.
 */
const orderGroupLikeTheTaskList = (tasks, focusedTaskId = null) =>
    sortTasksByPriority(orderBy(tasks, 'sortIndex', 'desc'), focusedTaskId)

const task = (id, { sortIndex = NOW, priority = TASK_PRIORITY_NONE } = {}) => ({
    id,
    sortIndex,
    created: sortIndex,
    priority,
    calendarData: null,
})

const meeting = (id, start, { sortIndex = NOW, priority = TASK_PRIORITY_NONE } = {}) => ({
    id,
    sortIndex,
    created: sortIndex,
    priority,
    calendarData: { eventId: `event-${id}`, link: 'https://cal', start },
})

const timed = value => ({ dateTime: value })
const allDay = value => ({ date: value })

const ids = tasks => tasks.map(item => item.id)

describe('isCalendarTask', () => {
    it('keys on calendarData, like every other call site in the app', () => {
        expect(isCalendarTask(meeting('m', timed('2026-08-18T10:00:00+02:00')))).toBe(true)
        expect(isCalendarTask(task('t'))).toBe(false)
        expect(isCalendarTask(null)).toBe(false)
        expect(isCalendarTask(undefined)).toBe(false)
    })
})

describe('getCalendarStartDayKey', () => {
    it('reads the day as a string prefix, so every reader agrees regardless of timezone', () => {
        // A 9am meeting in UTC+13 parses to the PREVIOUS day in UTC. The prefix is what the user
        // sees on their own calendar, which is the day the list has to group it under.
        expect(getCalendarStartDayKey({ start: timed('2026-08-20T09:00:00+13:00') })).toBe('2026-08-20')
        expect(getCalendarStartDayKey({ start: allDay('2026-08-20') })).toBe('2026-08-20')
        expect(getCalendarStartDayKey({ start: { dateTime: 'not-a-date' } })).toBeNull()
        expect(getCalendarStartDayKey({ start: {} })).toBeNull()
        expect(getCalendarStartDayKey(null)).toBeNull()
    })
})

describe('getCalendarOrderKey', () => {
    it('ranks an all-day event ahead of the timed events of the same day', () => {
        expect(getCalendarOrderKey({ start: allDay('2026-08-20') }).allDayRank).toBe(0)
        expect(getCalendarOrderKey({ start: timed('2026-08-20T09:00:00+02:00') }).allDayRank).toBe(1)
    })

    it('is null when there is no usable start', () => {
        expect(getCalendarOrderKey({ start: {} })).toBeNull()
        expect(getCalendarOrderKey(null)).toBeNull()
    })
})

describe('orderCalendarTasksLast — the reported behaviour', () => {
    it('always puts calendar tasks at the end of the group, in start order', () => {
        const group = [
            meeting('late-meeting', timed('2026-08-18T16:00:00+02:00')),
            task('task-a'),
            meeting('early-meeting', timed('2026-08-18T09:00:00+02:00')),
            task('task-b'),
        ]

        expect(ids(orderCalendarTasksLast(group))).toEqual(['task-a', 'task-b', 'early-meeting', 'late-meeting'])
    })

    it('leaves the relative order of non-calendar tasks completely untouched', () => {
        const group = [task('c'), meeting('m', timed('2026-08-18T10:00:00+02:00')), task('a'), task('b')]

        // c, a, b is the order they arrived in - the rule must not re-sort them.
        expect(ids(orderCalendarTasksLast(group))).toEqual(['c', 'a', 'b', 'm'])
    })

    it('is a no-op for a group with no calendar tasks', () => {
        const group = [task('a'), task('b'), task('c')]
        expect(ids(orderCalendarTasksLast(group))).toEqual(['a', 'b', 'c'])
    })

    it('handles a group that is only calendar tasks', () => {
        const group = [
            meeting('noon', timed('2026-08-18T12:00:00+02:00')),
            meeting('morning', timed('2026-08-18T08:30:00+02:00')),
        ]
        expect(ids(orderCalendarTasksLast(group))).toEqual(['morning', 'noon'])
    })

    it('returns [] for anything that is not an array', () => {
        expect(orderCalendarTasksLast(null)).toEqual([])
        expect(orderCalendarTasksLast(undefined)).toEqual([])
    })
})

describe('orderCalendarTasksLast — edge cases inside the calendar block', () => {
    it('puts an all-day event first among its own day, and orders days chronologically', () => {
        const group = [
            meeting('tomorrow-9am', timed('2026-08-19T09:00:00+02:00')),
            meeting('today-4pm', timed('2026-08-18T16:00:00+02:00')),
            meeting('tomorrow-all-day', allDay('2026-08-19')),
            meeting('today-all-day', allDay('2026-08-18')),
            meeting('today-9am', timed('2026-08-18T09:00:00+02:00')),
        ]

        expect(ids(orderCalendarTasksLast(group))).toEqual([
            'today-all-day',
            'today-9am',
            'today-4pm',
            'tomorrow-all-day',
            'tomorrow-9am',
        ])
    })

    it('keeps an all-day event ahead of the same day regardless of the reader timezone', () => {
        // In UTC+13 the 9am timed event parses BEFORE the all-day event's UTC midnight. Comparing
        // parsed timestamps would flip these two; comparing the day prefix first does not.
        const group = [
            meeting('timed-far-east', timed('2026-08-20T09:00:00+13:00')),
            meeting('all-day', allDay('2026-08-20')),
        ]

        expect(ids(orderCalendarTasksLast(group))).toEqual(['all-day', 'timed-far-east'])
    })

    it('sorts a calendar task with no usable start to the end of the block, still after normal tasks', () => {
        const group = [
            meeting('broken', {}),
            task('normal'),
            meeting('real', timed('2026-08-18T10:00:00+02:00')),
            meeting('also-broken', null),
        ]

        expect(ids(orderCalendarTasksLast(group))).toEqual(['normal', 'real', 'broken', 'also-broken'])
    })

    it('keeps equal start times in a stable, deterministic order', () => {
        const sameStart = timed('2026-08-18T10:00:00+02:00')
        const group = [meeting('b', sameStart), meeting('a', sameStart), meeting('c', sameStart)]

        // Arrival order is preserved rather than being resolved arbitrarily, so two meetings that
        // genuinely start together never swap places between renders.
        expect(ids(orderCalendarTasksLast(group))).toEqual(['b', 'a', 'c'])
        expect(ids(orderCalendarTasksLast(orderCalendarTasksLast(group)))).toEqual(['b', 'a', 'c'])
    })

    it('treats identical offsets written differently as the same instant', () => {
        const group = [
            meeting('utc-written', timed('2026-08-18T08:00:00Z')),
            meeting('offset-written', timed('2026-08-18T09:00:00+01:00')),
        ]

        // Same instant, same day prefix is NOT the same here ('2026-08-18' both) - order falls back
        // to arrival, which is stable either way.
        expect(ids(orderCalendarTasksLast(group))).toEqual(['utc-written', 'offset-written'])
    })
})

describe('the focused task is exempt', () => {
    it('keeps a focused calendar task where the caller put it', () => {
        const group = [
            meeting('focused-meeting', timed('2026-08-18T16:00:00+02:00')),
            task('a'),
            meeting('other-meeting', timed('2026-08-18T09:00:00+02:00')),
        ]

        expect(ids(orderCalendarTasksLast(group, 'focused-meeting'))).toEqual(['focused-meeting', 'a', 'other-meeting'])
    })

    it('still sends every OTHER calendar task to the end', () => {
        const group = [
            meeting('focused-meeting', timed('2026-08-18T16:00:00+02:00')),
            meeting('late', timed('2026-08-18T18:00:00+02:00')),
            task('a'),
            meeting('early', timed('2026-08-18T09:00:00+02:00')),
        ]

        expect(ids(orderCalendarTasksLast(group, 'focused-meeting'))).toEqual(['focused-meeting', 'a', 'early', 'late'])
    })
})

describe('sortTasksByPriority — the funnel every grouped list goes through', () => {
    it('sends a calendar task to the end even when it carries the highest priority', () => {
        // This is the hole AT-2270 could not close: priority is applied AFTER the sortIndex order,
        // so any encoding in sortIndex was simply overruled.
        const group = [
            task('normal', { sortIndex: NOW - 5000 }),
            meeting('must-do-meeting', timed('2026-08-18T10:00:00+02:00'), {
                sortIndex: NOW,
                priority: TASK_PRIORITY_MUST_DO,
            }),
        ]

        expect(ids(orderGroupLikeTheTaskList(group))).toEqual(['normal', 'must-do-meeting'])
    })

    it('still ranks non-calendar tasks by priority', () => {
        const group = [
            task('none', { sortIndex: NOW }),
            task('must', { sortIndex: NOW - 5000, priority: TASK_PRIORITY_MUST_DO }),
            task('should', { sortIndex: NOW - 1000, priority: TASK_PRIORITY_SHOULD_DO }),
            meeting('meeting', timed('2026-08-18T10:00:00+02:00')),
        ]

        expect(ids(orderGroupLikeTheTaskList(group))).toEqual(['must', 'should', 'none', 'meeting'])
    })

    it('pins the focused task to the top even when it is a meeting', () => {
        const group = [
            task('a', { sortIndex: NOW }),
            meeting('focused', timed('2026-08-18T10:00:00+02:00'), { sortIndex: NOW - 1000 }),
        ]

        expect(ids(orderGroupLikeTheTaskList(group, 'focused'))).toEqual(['focused', 'a'])
    })

    it('returns [] for a non-array, as before', () => {
        expect(sortTasksByPriority(null)).toEqual([])
    })
})

describe('the placement survives the write paths that used to destroy it', () => {
    // Under AT-2270 the position lived in `sortIndex`, and ~25 paths rewrite that field with
    // `generateSortIndex()` (postpone, backlog, assignee, project, goal, un-complete...). Each one
    // permanently ejected the meeting from its band. The ordering no longer reads the field at all.
    const postponedMeeting = meeting('meeting', timed('2026-08-18T10:00:00+02:00'), { sortIndex: NOW + 60000 })

    it.each([
        ['a freshly generated index (postpone, backlog, assignee, project, goal)', NOW + 60000],
        ['a drag-derived neighbour index', NOW - 1],
        ['the focus band', Number.MAX_SAFE_INTEGER - 1e15 + NOW],
        ['a negative subtask/template index', -NOW],
        ['zero', 0],
    ])('holds the meeting at the end of the group with %s', (_label, sortIndex) => {
        const group = [
            task('a', { sortIndex: NOW }),
            { ...postponedMeeting, sortIndex },
            task('b', { sortIndex: NOW - 1000 }),
        ]

        expect(ids(orderGroupLikeTheTaskList(group))).toEqual(['a', 'b', 'meeting'])
    })
})

describe('compareTasksByCalendarPlacement — the flat comparator for focus selection', () => {
    it('ranks any calendar task after any normal task', () => {
        const normal = task('n')
        const cal = meeting('m', timed('2026-08-18T10:00:00+02:00'))

        expect(compareTasksByCalendarPlacement(normal, cal)).toBeLessThan(0)
        expect(compareTasksByCalendarPlacement(cal, normal)).toBeGreaterThan(0)
    })

    it('returns 0 for two normal tasks so the caller decides', () => {
        expect(compareTasksByCalendarPlacement(task('a'), task('b'))).toBe(0)
    })

    it('orders two meetings by start', () => {
        const early = meeting('early', timed('2026-08-18T09:00:00+02:00'))
        const late = meeting('late', timed('2026-08-18T16:00:00+02:00'))

        expect(compareTasksByCalendarPlacement(early, late)).toBeLessThan(0)
        expect(compareTasksByCalendarPlacement(late, early)).toBeGreaterThan(0)
    })

    it('sorts a real group the same way the rendered list does', () => {
        const group = [
            meeting('late', timed('2026-08-18T16:00:00+02:00')),
            task('a'),
            meeting('early', timed('2026-08-18T09:00:00+02:00')),
            task('b'),
        ]

        const flatSorted = [...group].sort(
            (a, b) => compareTasksByCalendarPlacement(a, b) || group.indexOf(a) - group.indexOf(b)
        )

        expect(ids(flatSorted)).toEqual(ids(orderCalendarTasksLast(group)))
    })
})

// Cloud Functions cannot import app modules, so functions/shared/calendarTaskOrder.js is a hand
// mirror. Drive both through the same cases so they cannot drift apart silently.
describe('client / Cloud Functions parity', () => {
    const cases = [
        [
            meeting('late', timed('2026-08-18T16:00:00+02:00')),
            task('a'),
            meeting('early', timed('2026-08-18T09:00:00+02:00')),
        ],
        [meeting('all-day', allDay('2026-08-20')), meeting('timed', timed('2026-08-20T09:00:00+13:00'))],
        [meeting('broken', {}), meeting('real', timed('2026-08-18T10:00:00+02:00')), task('n')],
        [task('only-a'), task('only-b')],
    ]

    it.each(cases.map((group, index) => [index, group]))('orderCalendarTasksLast matches for case %i', (_i, group) => {
        expect(ids(serverCalendarOrder.orderCalendarTasksLast(group))).toEqual(ids(orderCalendarTasksLast(group)))
    })

    it('compareTasksByCalendarPlacement matches on every pair', () => {
        const all = cases.flat()
        all.forEach(a => {
            all.forEach(b => {
                expect(Math.sign(serverCalendarOrder.compareTasksByCalendarPlacement(a, b))).toBe(
                    Math.sign(compareTasksByCalendarPlacement(a, b))
                )
            })
        })
    })

    it('exposes the same day/timestamp readers', () => {
        const calendarData = { start: timed('2026-08-20T09:00:00+13:00') }
        expect(serverCalendarOrder.getCalendarStartDayKey(calendarData)).toBe(getCalendarStartDayKey(calendarData))
        expect(serverCalendarOrder.isCalendarTask(meeting('m', timed('2026-08-18T10:00:00+02:00')))).toBe(true)
    })
})
