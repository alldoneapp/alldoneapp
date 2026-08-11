import moment from 'moment'
import { orderBy } from 'lodash'

import {
    getCalendarEventStartTimestamp,
    isCalendarDerivedSortIndex,
    resolveTaskSortIndex,
} from './CalendarTaskSortIndex'
import { sortTasksByPriority, TASK_PRIORITY_MUST_DO, TASK_PRIORITY_NONE } from './TaskPriority'

const {
    isCalendarDerivedSortIndex: serverIsCalendarDerivedSortIndex,
    resolveTaskSortIndex: serverResolveTaskSortIndex,
} = require('../functions/shared/calendarTaskSortIndex')

const NOW = moment('2026-08-11T17:00:00+02:00').valueOf()
const MEETING_START = '2026-08-20T10:00:00+02:00'

/** Exactly what `sortTasksListThatHaveNewTasks` runs for a main-task group. */
const orderGroupLikeTheTaskList = tasks => sortTasksByPriority(orderBy(tasks, 'sortIndex', 'desc'))

/** A task as it lands in the store: `mapTaskData` normalizes sortIndex on the way in. */
const ingest = task => ({
    ...task,
    priority: task.priority || TASK_PRIORITY_NONE,
    sortIndex: resolveTaskSortIndex(task.sortIndex, task.calendarData, task.created),
})

const buildLegacyCalendarTask = (id, { start = { dateTime: MEETING_START }, created = NOW - 3 * 86400000 } = {}) => ({
    id,
    calendarData: { eventId: `event-${id}`, start },
    // The bug: the event start was persisted as the ordering key.
    sortIndex: start.dateTime ? moment(start.dateTime).valueOf() : moment(start.date).valueOf(),
    created,
})

const buildTask = (id, sortIndex) => ({ id, sortIndex, created: sortIndex, calendarData: null })

const idsOf = tasks => tasks.map(task => task.id)

describe('AT-2259 - calendar tasks are not pinned to the top of their group', () => {
    it('adds a newly created task above an existing calendar task', () => {
        const meeting = ingest(buildLegacyCalendarTask('meeting'))
        const existing = ingest(buildTask('existing', NOW - 60000))
        const justAdded = ingest(buildTask('just-added', NOW))

        expect(idsOf(orderGroupLikeTheTaskList([meeting, existing, justAdded]))).toEqual([
            'just-added',
            'existing',
            'meeting',
        ])
    })

    it('leaves the meeting above tasks that are older than it is, rather than always demoting it', () => {
        // The rule is "ordered by when it entered the list", not "calendar tasks go last".
        const meeting = ingest(buildLegacyCalendarTask('meeting', { created: NOW - 3600000 }))
        const older = ingest(buildTask('older', NOW - 7200000))
        const newer = ingest(buildTask('newer', NOW - 600000))

        expect(idsOf(orderGroupLikeTheTaskList([older, meeting, newer]))).toEqual(['newer', 'meeting', 'older'])
    })

    it('lets a task dragged to the top of the group actually land above the calendar task', () => {
        // DragHelper assigns `generateSortIndex()` (= now) when a task is dropped at index 0. Under
        // the old behavior that was still below the meeting's future event start.
        const meeting = ingest(buildLegacyCalendarTask('meeting'))
        const dragged = { ...ingest(buildTask('dragged', NOW - 86400000)), sortIndex: NOW }

        expect(idsOf(orderGroupLikeTheTaskList([meeting, dragged]))).toEqual(['dragged', 'meeting'])
    })

    it('keeps an all-day event from outranking everything in a future group', () => {
        const allDay = ingest(
            buildLegacyCalendarTask('all-day', { start: { date: '2026-08-20' }, created: NOW - 86400000 })
        )
        const justAdded = ingest(buildTask('just-added', NOW))

        expect(idsOf(orderGroupLikeTheTaskList([allDay, justAdded]))).toEqual(['just-added', 'all-day'])
    })

    it('still lets priority beat recency, for calendar tasks too', () => {
        const meeting = { ...ingest(buildLegacyCalendarTask('meeting')), priority: TASK_PRIORITY_MUST_DO }
        const justAdded = ingest(buildTask('just-added', NOW))

        expect(idsOf(orderGroupLikeTheTaskList([justAdded, meeting]))).toEqual(['meeting', 'just-added'])
    })

    it('orders several calendar tasks among themselves by when they arrived', () => {
        const first = ingest(buildLegacyCalendarTask('synced-first', { created: NOW - 7200000 }))
        const second = ingest(
            buildLegacyCalendarTask('synced-second', {
                start: { dateTime: '2026-08-20T08:00:00+02:00' },
                created: NOW - 3600000,
            })
        )

        expect(idsOf(orderGroupLikeTheTaskList([first, second]))).toEqual(['synced-second', 'synced-first'])
    })
})

describe('resolveTaskSortIndex', () => {
    it('leaves a normal task untouched', () => {
        expect(resolveTaskSortIndex(NOW, null, NOW - 1000)).toBe(NOW)
        expect(resolveTaskSortIndex(NOW, { eventId: 'no-start' }, NOW - 1000)).toBe(NOW)
    })

    it('maps a legacy calendar sortIndex onto the moment the task entered the list', () => {
        const created = NOW - 86400000
        expect(
            resolveTaskSortIndex(moment(MEETING_START).valueOf(), { start: { dateTime: MEETING_START } }, created)
        ).toBe(created)
    })

    it('respects a sortIndex the user has since influenced', () => {
        // Dragged / postponed / re-assigned: no longer the event start, so it is authoritative.
        const dragged = NOW - 12345
        expect(resolveTaskSortIndex(dragged, { start: { dateTime: MEETING_START } }, NOW - 86400000)).toBe(dragged)
    })

    it('preserves the reserved focus range so a focused calendar task stays on top', () => {
        const focusSortIndex = Number.MAX_SAFE_INTEGER - 1e15 + NOW
        expect(resolveTaskSortIndex(focusSortIndex, { start: { dateTime: MEETING_START } }, NOW)).toBe(focusSortIndex)
    })

    it('falls back to the stored value when the task has no usable created timestamp', () => {
        const legacy = moment(MEETING_START).valueOf()
        expect(resolveTaskSortIndex(legacy, { start: { dateTime: MEETING_START } }, undefined)).toBe(legacy)
        expect(resolveTaskSortIndex(legacy, { start: { dateTime: MEETING_START } }, NaN)).toBe(legacy)
    })
})

describe('isCalendarDerivedSortIndex', () => {
    it('matches a timed event exactly and nothing else', () => {
        const calendarData = { start: { dateTime: MEETING_START } }
        expect(isCalendarDerivedSortIndex(moment(MEETING_START).valueOf(), calendarData)).toBe(true)
        expect(isCalendarDerivedSortIndex(moment(MEETING_START).valueOf() + 1, calendarData)).toBe(false)
    })

    it('accepts an all-day value written under any real timezone offset', () => {
        const calendarData = { start: { date: '2026-08-20' } }
        const localMidnight = moment('2026-08-20').valueOf()
        for (const offsetHours of [-12, -5, 0, 2, 14]) {
            expect(isCalendarDerivedSortIndex(localMidnight + offsetHours * 3600000, calendarData)).toBe(true)
        }
        expect(isCalendarDerivedSortIndex(localMidnight - 48 * 3600000, calendarData)).toBe(false)
    })

    it('does not mistake an arbitrary-millisecond index for an all-day value', () => {
        // This is the case that matters: a task dragged next to today's all-day event. A generated
        // sortIndex is a raw millisecond, a calendar-derived one is always minute-aligned.
        const calendarData = { start: { date: '2026-08-20' } }
        expect(isCalendarDerivedSortIndex(moment('2026-08-20T09:41:07.512').valueOf(), calendarData)).toBe(false)
    })

    it('ignores anything that is not a finite number', () => {
        const calendarData = { start: { dateTime: MEETING_START } }
        expect(isCalendarDerivedSortIndex(undefined, calendarData)).toBe(false)
        expect(isCalendarDerivedSortIndex(NaN, calendarData)).toBe(false)
        expect(isCalendarDerivedSortIndex('123', calendarData)).toBe(false)
    })
})

// Cloud Functions cannot import app modules, so functions/shared/calendarTaskSortIndex.js is a hand
// copy. Drift between the two would mean the server picks a next focus task the list does not show
// at the top, so pin them against each other here - this suite runs in the web config, which is the
// one CI executes on a branch.
describe('the Cloud Functions mirror stays in sync', () => {
    const cases = [
        [moment(MEETING_START).valueOf(), { start: { dateTime: MEETING_START } }, NOW - 86400000],
        [NOW, { start: { dateTime: MEETING_START } }, NOW - 86400000],
        [NOW, null, NOW],
        [moment('2026-08-20').valueOf(), { start: { date: '2026-08-20' } }, NOW],
        [moment('2026-08-20T09:41:07.512').valueOf(), { start: { date: '2026-08-20' } }, NOW],
        [undefined, { start: { dateTime: MEETING_START } }, NOW],
    ]

    it.each(cases)('agrees on (%p, %p, %p)', (sortIndex, calendarData, created) => {
        expect(serverIsCalendarDerivedSortIndex(sortIndex, calendarData)).toBe(
            isCalendarDerivedSortIndex(sortIndex, calendarData)
        )
        expect(serverResolveTaskSortIndex(sortIndex, calendarData, created)).toBe(
            resolveTaskSortIndex(sortIndex, calendarData, created)
        )
    })
})

describe('getCalendarEventStartTimestamp', () => {
    it('is the field anything needing the event time should read', () => {
        expect(getCalendarEventStartTimestamp({ start: { dateTime: MEETING_START } })).toBe(
            moment(MEETING_START).valueOf()
        )
        expect(getCalendarEventStartTimestamp({ start: { date: '2026-08-20' } })).toBe(moment('2026-08-20').valueOf())
        expect(getCalendarEventStartTimestamp(null)).toBeNull()
        expect(getCalendarEventStartTimestamp({ eventId: 'no-start' })).toBeNull()
    })
})
