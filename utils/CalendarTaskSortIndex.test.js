import moment from 'moment'
import { orderBy } from 'lodash'

import {
    CALENDAR_DEFAULT_SORT_INDEX_BASE,
    getCalendarEventStartTimestamp,
    getDefaultCalendarSortIndex,
    isCalendarDerivedSortIndex,
    isDefaultCalendarSortIndex,
    isUntouchedCalendarSortIndex,
    resolveTaskSortIndex,
} from './CalendarTaskSortIndex'
import { sortTasksByPriority, TASK_PRIORITY_MUST_DO, TASK_PRIORITY_NONE } from './TaskPriority'

const {
    getDefaultCalendarSortIndex: serverGetDefaultCalendarSortIndex,
    isCalendarDerivedSortIndex: serverIsCalendarDerivedSortIndex,
    isDefaultCalendarSortIndex: serverIsDefaultCalendarSortIndex,
    isUntouchedCalendarSortIndex: serverIsUntouchedCalendarSortIndex,
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

/** How the calendar sync writes a task today (AT-2270). */
const buildCalendarTask = (id, { start = { dateTime: MEETING_START }, created = NOW - 3 * 86400000 } = {}) => ({
    id,
    calendarData: { eventId: `event-${id}`, start },
    sortIndex: getDefaultCalendarSortIndex({ start }),
    created,
})

/** How the sync wrote it before AT-2259: the event start WAS the ordering key. */
const buildLegacyCalendarTask = (id, { start = { dateTime: MEETING_START }, created = NOW - 3 * 86400000 } = {}) => ({
    id,
    calendarData: { eventId: `event-${id}`, start },
    sortIndex: start.dateTime ? moment(start.dateTime).valueOf() : moment(start.date).valueOf(),
    created,
})

/** How the sync wrote it between AT-2259 and AT-2270: an ordinary arrival index. */
const buildArrivalCalendarTask = (id, { start = { dateTime: MEETING_START }, created = NOW - 86400000 } = {}) => ({
    id,
    calendarData: { eventId: `event-${id}`, start },
    sortIndex: created + 1, // sortIndex and created are stamped microseconds apart
    created,
})

const buildTask = (id, sortIndex) => ({ id, sortIndex, created: sortIndex, calendarData: null })

const idsOf = tasks => tasks.map(task => task.id)

describe('AT-2270 - calendar tasks default to the bottom of their group, in event order', () => {
    it('puts every calendar task below the ordinary tasks of the group', () => {
        const meeting = ingest(buildCalendarTask('meeting'))
        const oldest = ingest(buildTask('oldest', NOW - 30 * 86400000))
        const justAdded = ingest(buildTask('just-added', NOW))

        expect(idsOf(orderGroupLikeTheTaskList([meeting, oldest, justAdded]))).toEqual([
            'just-added',
            'oldest',
            'meeting',
        ])
    })

    it('orders the calendar tasks among themselves chronologically, earliest first', () => {
        const late = ingest(buildCalendarTask('late', { start: { dateTime: '2026-08-20T16:00:00+02:00' } }))
        const early = ingest(buildCalendarTask('early', { start: { dateTime: '2026-08-20T08:30:00+02:00' } }))
        const midday = ingest(buildCalendarTask('midday', { start: { dateTime: '2026-08-20T12:00:00+02:00' } }))

        expect(idsOf(orderGroupLikeTheTaskList([late, early, midday]))).toEqual(['early', 'midday', 'late'])
    })

    it('puts an all-day event above the timed events of the same day', () => {
        const allDay = ingest(buildCalendarTask('all-day', { start: { date: '2026-08-20' } }))
        const morning = ingest(buildCalendarTask('morning', { start: { dateTime: '2026-08-20T08:30:00+02:00' } }))
        const normal = ingest(buildTask('normal', NOW))

        expect(idsOf(orderGroupLikeTheTaskList([morning, allDay, normal]))).toEqual(['normal', 'all-day', 'morning'])
    })

    it('adopts the new default for tasks synced before AT-2270, without a data migration', () => {
        // Pre-AT-2259 (event start as the key) and post-AT-2259 (arrival index) alike.
        const legacy = ingest(buildLegacyCalendarTask('legacy'))
        const arrival = ingest(buildArrivalCalendarTask('arrival', { start: { dateTime: MEETING_START } }))
        const normal = ingest(buildTask('normal', NOW - 10 * 86400000))

        expect(idsOf(orderGroupLikeTheTaskList([legacy, arrival, normal]))).toEqual(['normal', 'legacy', 'arrival'])
        expect(legacy.sortIndex).toBe(getDefaultCalendarSortIndex({ start: { dateTime: MEETING_START } }))
    })

    it('never lets a future meeting outrank a task dragged to the top (AT-2259 stays fixed)', () => {
        const meeting = ingest(buildCalendarTask('meeting'))
        const legacyMeeting = ingest(buildLegacyCalendarTask('legacy-meeting'))
        // DragHelper assigns `generateSortIndex()` (= now) when a task is dropped at index 0.
        const dragged = { ...ingest(buildTask('dragged', NOW - 86400000)), sortIndex: NOW }

        expect(idsOf(orderGroupLikeTheTaskList([meeting, legacyMeeting, dragged]))[0]).toBe('dragged')
    })

    it('still lets priority beat the default placement, for calendar tasks too', () => {
        const meeting = { ...ingest(buildCalendarTask('meeting')), priority: TASK_PRIORITY_MUST_DO }
        const justAdded = ingest(buildTask('just-added', NOW))

        expect(idsOf(orderGroupLikeTheTaskList([justAdded, meeting]))).toEqual(['meeting', 'just-added'])
    })
})

describe('AT-2270 - a calendar task the user rearranged stays where they put it', () => {
    it('keeps a meeting dragged to the top of the group', () => {
        // Dropped at index 0: DragHelper writes `generateSortIndex()`.
        const dragged = ingest({ ...buildCalendarTask('meeting'), sortIndex: NOW })
        const normal = ingest(buildTask('normal', NOW - 3600000))

        expect(dragged.sortIndex).toBe(NOW)
        expect(idsOf(orderGroupLikeTheTaskList([normal, dragged]))).toEqual(['meeting', 'normal'])
    })

    it('keeps a meeting dropped between two other meetings, even though that is a band value', () => {
        // Dropping onto a neighbour takes its index and cascades - still inside the calendar band,
        // and it must NOT be read back as "untouched" and re-sorted by event start.
        const early = ingest(buildCalendarTask('early', { start: { dateTime: '2026-08-20T08:30:00+02:00' } }))
        const late = ingest(buildCalendarTask('late', { start: { dateTime: '2026-08-20T16:00:00+02:00' } }))
        const midday = ingest({
            ...buildCalendarTask('midday', { start: { dateTime: '2026-08-20T12:00:00+02:00' } }),
            sortIndex: late.sortIndex - 1, // dropped below the late meeting
        })

        expect(idsOf(orderGroupLikeTheTaskList([early, late, midday]))).toEqual(['early', 'late', 'midday'])
        expect(isUntouchedCalendarSortIndex(midday.sortIndex, midday.calendarData, midday.created)).toBe(false)
    })

    it('keeps a normal task the user dragged below the meetings', () => {
        const meeting = ingest(buildCalendarTask('meeting'))
        const parked = ingest({ ...buildTask('parked', NOW), sortIndex: meeting.sortIndex - 1 })

        expect(idsOf(orderGroupLikeTheTaskList([parked, meeting]))).toEqual(['meeting', 'parked'])
    })

    it('is stable across re-renders: resolving an already-resolved list changes nothing', () => {
        const tasks = [
            ingest(buildCalendarTask('meeting')),
            ingest(buildLegacyCalendarTask('legacy')),
            ingest({ ...buildCalendarTask('dragged'), sortIndex: NOW }),
            ingest(buildTask('normal', NOW - 1000)),
        ]

        expect(idsOf(orderGroupLikeTheTaskList(tasks.map(ingest)))).toEqual(idsOf(orderGroupLikeTheTaskList(tasks)))
    })
})

describe('getDefaultCalendarSortIndex', () => {
    it('is below every generated ordering index and orders by event start', () => {
        const early = getDefaultCalendarSortIndex({ start: { dateTime: '2026-08-20T08:30:00+02:00' } })
        const late = getDefaultCalendarSortIndex({ start: { dateTime: '2026-08-20T16:00:00+02:00' } })

        expect(early).toBeGreaterThan(late)
        expect(late).toBeLessThan(CALENDAR_DEFAULT_SORT_INDEX_BASE + 1)
        // Below the "no sortIndex stored" fallback (`generateNegativeSortIndex()`) and below the
        // negative index subtasks/templates use, and comfortably inside the safe integer range.
        expect(early).toBeLessThan(-moment().valueOf())
        expect(Number.isSafeInteger(early)).toBe(true)
    })

    it('reads an all-day event in UTC so the server and the browser agree', () => {
        // The value is written by Cloud Functions (UTC) and compared in the user's browser.
        expect(getDefaultCalendarSortIndex({ start: { date: '2026-08-20' } })).toBe(
            CALENDAR_DEFAULT_SORT_INDEX_BASE - Date.UTC(2026, 7, 20)
        )
    })

    it('is null when there is nothing to derive from', () => {
        expect(getDefaultCalendarSortIndex(null)).toBeNull()
        expect(getDefaultCalendarSortIndex({ eventId: 'no-start' })).toBeNull()
        expect(getDefaultCalendarSortIndex({ start: { date: 'not-a-date' } })).toBeNull()
    })
})

describe('resolveTaskSortIndex', () => {
    const calendarData = { start: { dateTime: MEETING_START } }
    const defaultSortIndex = getDefaultCalendarSortIndex(calendarData)

    it('leaves a normal task untouched', () => {
        expect(resolveTaskSortIndex(NOW, null, NOW - 1000)).toBe(NOW)
        expect(resolveTaskSortIndex(NOW, { eventId: 'no-start' }, NOW - 1000)).toBe(NOW)
    })

    it('maps every untouched shape onto the default placement', () => {
        const created = NOW - 86400000
        expect(resolveTaskSortIndex(moment(MEETING_START).valueOf(), calendarData, created)).toBe(defaultSortIndex)
        expect(resolveTaskSortIndex(created, calendarData, created)).toBe(defaultSortIndex)
        expect(resolveTaskSortIndex(defaultSortIndex, calendarData, created)).toBe(defaultSortIndex)
    })

    it('respects a sortIndex the user has since influenced', () => {
        // Dragged / postponed / re-assigned: no longer a sync-written value, so it is authoritative.
        const dragged = NOW - 12345
        expect(resolveTaskSortIndex(dragged, calendarData, NOW - 86400000)).toBe(dragged)
    })

    it('preserves the reserved focus range so a focused calendar task stays on top', () => {
        const focusSortIndex = Number.MAX_SAFE_INTEGER - 1e15 + NOW
        expect(resolveTaskSortIndex(focusSortIndex, calendarData, NOW)).toBe(focusSortIndex)
    })

    it('leaves the legacy value alone when there is nothing to derive a default from', () => {
        const legacy = moment(MEETING_START).valueOf()
        expect(resolveTaskSortIndex(legacy, { start: { date: 'not-a-date' } }, NOW)).toBe(legacy)
    })
})

describe('isDefaultCalendarSortIndex', () => {
    it('matches the derived value for the CURRENT event start and nothing else', () => {
        const calendarData = { start: { dateTime: MEETING_START } }
        const derived = getDefaultCalendarSortIndex(calendarData)

        expect(isDefaultCalendarSortIndex(derived, calendarData)).toBe(true)
        expect(isDefaultCalendarSortIndex(derived - 1, calendarData)).toBe(false)
        // A rescheduled event: the stored value belongs to the old start. The sync re-derives it;
        // a read must not, because it cannot tell this apart from a deliberate placement.
        expect(isDefaultCalendarSortIndex(derived, { start: { dateTime: '2026-08-20T11:00:00+02:00' } })).toBe(false)
        expect(isDefaultCalendarSortIndex(NaN, calendarData)).toBe(false)
    })
})

describe('isCalendarDerivedSortIndex (the pre-AT-2259 value)', () => {
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

describe('isUntouchedCalendarSortIndex', () => {
    const calendarData = { start: { dateTime: MEETING_START } }

    it('recognises the arrival index only within the second the task was created', () => {
        const created = NOW - 86400000
        expect(isUntouchedCalendarSortIndex(created + 1, calendarData, created)).toBe(true)
        // A meeting dragged later that day: far outside the window, so it is the user's placement.
        expect(isUntouchedCalendarSortIndex(created + 3600000, calendarData, created)).toBe(false)
    })

    it('is false for anything that is not a calendar task', () => {
        expect(isUntouchedCalendarSortIndex(NOW, null, NOW)).toBe(false)
        expect(isUntouchedCalendarSortIndex(NOW, { eventId: 'no-start' }, NOW)).toBe(false)
    })
})

// Cloud Functions cannot import app modules, so functions/shared/calendarTaskSortIndex.js is a hand
// copy. Drift between the two would mean the sync writes a placement the list does not reproduce,
// so pin them against each other here - this suite runs in the web config, which is the one CI
// executes on a branch.
describe('the Cloud Functions mirror stays in sync', () => {
    const cases = [
        [moment(MEETING_START).valueOf(), { start: { dateTime: MEETING_START } }, NOW - 86400000],
        [NOW, { start: { dateTime: MEETING_START } }, NOW - 86400000],
        [NOW, null, NOW],
        [NOW - 86400000 + 1, { start: { dateTime: MEETING_START } }, NOW - 86400000],
        [
            getDefaultCalendarSortIndex({ start: { dateTime: MEETING_START } }),
            { start: { dateTime: MEETING_START } },
            NOW,
        ],
        [moment('2026-08-20').valueOf(), { start: { date: '2026-08-20' } }, NOW],
        [moment('2026-08-20T09:41:07.512').valueOf(), { start: { date: '2026-08-20' } }, NOW],
        [undefined, { start: { dateTime: MEETING_START } }, NOW],
    ]

    it.each(cases)('agrees on (%p, %p, %p)', (sortIndex, calendarData, created) => {
        expect(serverIsCalendarDerivedSortIndex(sortIndex, calendarData)).toBe(
            isCalendarDerivedSortIndex(sortIndex, calendarData)
        )
        expect(serverIsDefaultCalendarSortIndex(sortIndex, calendarData)).toBe(
            isDefaultCalendarSortIndex(sortIndex, calendarData)
        )
        expect(serverIsUntouchedCalendarSortIndex(sortIndex, calendarData, created)).toBe(
            isUntouchedCalendarSortIndex(sortIndex, calendarData, created)
        )
        expect(serverResolveTaskSortIndex(sortIndex, calendarData, created)).toBe(
            resolveTaskSortIndex(sortIndex, calendarData, created)
        )
    })

    it('derives the same default placement on both sides', () => {
        for (const start of [{ dateTime: MEETING_START }, { date: '2026-08-20' }, { date: 'not-a-date' }]) {
            expect(serverGetDefaultCalendarSortIndex({ start })).toBe(getDefaultCalendarSortIndex({ start }))
        }
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
