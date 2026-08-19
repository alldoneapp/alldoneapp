import moment from 'moment'
import { orderBy } from 'lodash'

import {
    CALENDAR_LEGACY_SORT_INDEX_BASE,
    getCalendarEventStartTimestamp,
    isLegacyCalendarBandSortIndex,
    isLegacyCalendarEventStartSortIndex,
    resolveTaskSortIndex,
} from './CalendarTaskSortIndex'
import { sortTasksByPriority, TASK_PRIORITY_NONE } from './TaskPriority'

const {
    isLegacyCalendarBandSortIndex: serverIsLegacyCalendarBandSortIndex,
    isLegacyCalendarEventStartSortIndex: serverIsLegacyCalendarEventStartSortIndex,
    resolveTaskSortIndex: serverResolveTaskSortIndex,
} = require('../functions/shared/calendarTaskSortIndex')

const NOW = moment('2026-08-18T15:00:00+02:00').valueOf()
const CREATED = NOW - 3 * 86400000
const MEETING_START = '2026-08-20T10:00:00+02:00'

const calendarData = (start = { dateTime: MEETING_START }) => ({ eventId: 'event-1', start })

/** How the sync wrote a calendar task before AT-2259: the event start WAS the ordering key. */
const legacyEventStartIndex = start =>
    start.dateTime ? moment(start.dateTime).valueOf() : moment(start.date).valueOf()

/** How AT-2270 wrote it: a reserved band two orders of magnitude below every generated index. */
const legacyBandIndex = start => {
    const eventStart = start.dateTime
        ? moment(start.dateTime).valueOf()
        : moment.utc(start.date, 'YYYY-MM-DD', true).valueOf()
    return CALENDAR_LEGACY_SORT_INDEX_BASE - eventStart
}

describe('getCalendarEventStartTimestamp', () => {
    it('reads the event start, and only from calendarData', () => {
        expect(getCalendarEventStartTimestamp(calendarData())).toBe(moment(MEETING_START).valueOf())
        expect(getCalendarEventStartTimestamp(calendarData({ date: '2026-08-20' }))).toBe(
            moment('2026-08-20').valueOf()
        )
        expect(getCalendarEventStartTimestamp(null)).toBeNull()
        expect(getCalendarEventStartTimestamp({ eventId: 'no-start' })).toBeNull()
    })
})

describe('isLegacyCalendarBandSortIndex', () => {
    it('recognises an AT-2270 band value', () => {
        expect(isLegacyCalendarBandSortIndex(legacyBandIndex({ dateTime: MEETING_START }))).toBe(true)
        expect(isLegacyCalendarBandSortIndex(legacyBandIndex({ date: '2026-08-20' }))).toBe(true)
    })

    it('does not touch any value a generator can actually produce', () => {
        expect(isLegacyCalendarBandSortIndex(NOW)).toBe(false)
        // generateNegativeSortIndex() — subtasks, templates, the "no stored index" fallback.
        expect(isLegacyCalendarBandSortIndex(-NOW)).toBe(false)
        // The focus band.
        expect(isLegacyCalendarBandSortIndex(Number.MAX_SAFE_INTEGER - 1e15 + NOW)).toBe(false)
        expect(isLegacyCalendarBandSortIndex(0)).toBe(false)
        expect(isLegacyCalendarBandSortIndex(undefined)).toBe(false)
        expect(isLegacyCalendarBandSortIndex(NaN)).toBe(false)
    })
})

describe('isLegacyCalendarEventStartSortIndex', () => {
    it('matches a timed event exactly', () => {
        const start = { dateTime: MEETING_START }
        expect(isLegacyCalendarEventStartSortIndex(legacyEventStartIndex(start), calendarData(start))).toBe(true)
        expect(isLegacyCalendarEventStartSortIndex(legacyEventStartIndex(start) + 1, calendarData(start))).toBe(false)
    })

    it('matches an all-day event by proximity to local midnight AND minute alignment', () => {
        const start = { date: '2026-08-20' }
        const localMidnight = moment('2026-08-20').valueOf()

        expect(isLegacyCalendarEventStartSortIndex(localMidnight, calendarData(start))).toBe(true)
        // A different timezone's midnight for the same day is still within tolerance.
        expect(isLegacyCalendarEventStartSortIndex(localMidnight + 6 * 3600000, calendarData(start))).toBe(true)
        // A generated index is an arbitrary millisecond, so it is not minute-aligned.
        expect(isLegacyCalendarEventStartSortIndex(localMidnight + 1, calendarData(start))).toBe(false)
        // Far outside any real offset.
        expect(isLegacyCalendarEventStartSortIndex(localMidnight + 40 * 3600000, calendarData(start))).toBe(false)
    })

    it('never matches a task that is not a calendar task', () => {
        expect(isLegacyCalendarEventStartSortIndex(NOW, null)).toBe(false)
        expect(isLegacyCalendarEventStartSortIndex(NOW, { eventId: 'no-start' })).toBe(false)
    })
})

describe('resolveTaskSortIndex', () => {
    it('maps the pre-AT-2259 event start onto the created stamp', () => {
        const start = { dateTime: MEETING_START }
        expect(resolveTaskSortIndex(legacyEventStartIndex(start), calendarData(start), CREATED)).toBe(CREATED)
    })

    it('maps the AT-2270 band onto the created stamp', () => {
        const start = { dateTime: MEETING_START }
        expect(resolveTaskSortIndex(legacyBandIndex(start), calendarData(start), CREATED)).toBe(CREATED)
    })

    it('repairs a band value on a NON-calendar task too', () => {
        // Drag & drop derives a dropped task's index from its neighbours, so a normal task dropped
        // below a banded meeting inherited ~-1e14 and sank below everything else permanently.
        const inheritedFromBandedNeighbour = legacyBandIndex({ dateTime: MEETING_START }) - 1
        expect(resolveTaskSortIndex(inheritedFromBandedNeighbour, null, CREATED)).toBe(CREATED)
    })

    it('passes an ordinary index straight through', () => {
        expect(resolveTaskSortIndex(NOW, calendarData(), CREATED)).toBe(NOW)
        expect(resolveTaskSortIndex(NOW, null, CREATED)).toBe(NOW)
        expect(resolveTaskSortIndex(-NOW, null, CREATED)).toBe(-NOW)
        // The focus band must survive - it is what keeps the focused task pinned.
        const focusIndex = Number.MAX_SAFE_INTEGER - 1e15 + NOW
        expect(resolveTaskSortIndex(focusIndex, calendarData(), CREATED)).toBe(focusIndex)
    })

    it('passes non-numbers through untouched', () => {
        expect(resolveTaskSortIndex(undefined, calendarData(), CREATED)).toBeUndefined()
        expect(resolveTaskSortIndex(null, calendarData(), CREATED)).toBeNull()
        expect(resolveTaskSortIndex(NOW, calendarData(), undefined)).toBe(NOW)
    })
})

describe('legacy documents order sanely once repaired', () => {
    const ingest = task => ({
        ...task,
        priority: TASK_PRIORITY_NONE,
        sortIndex: resolveTaskSortIndex(task.sortIndex, task.calendarData, task.created),
    })

    const orderGroupLikeTheTaskList = tasks => sortTasksByPriority(orderBy(tasks, 'sortIndex', 'desc'))

    it('stops a pre-AT-2259 meeting from hogging the top of the sortIndex ordering', () => {
        const start = { dateTime: MEETING_START }
        const group = [
            ingest({
                id: 'legacy-meeting',
                calendarData: calendarData(start),
                sortIndex: legacyEventStartIndex(start),
                created: CREATED,
            }),
            ingest({ id: 'normal', calendarData: null, sortIndex: NOW, created: NOW }),
        ]

        // Repaired to `created`, so the normal task outranks it on sortIndex - and the calendar
        // rule sends the meeting to the end regardless.
        expect(group.find(item => item.id === 'legacy-meeting').sortIndex).toBe(CREATED)
        expect(orderGroupLikeTheTaskList(group).map(item => item.id)).toEqual(['normal', 'legacy-meeting'])
    })

    it('rescues a normal task that had inherited a band index from a dragged-past meeting', () => {
        const stranded = ingest({
            id: 'stranded',
            calendarData: null,
            sortIndex: legacyBandIndex({ dateTime: MEETING_START }) - 1,
            created: NOW + 1000,
        })

        const group = [stranded, ingest({ id: 'other', calendarData: null, sortIndex: NOW, created: NOW })]

        expect(stranded.sortIndex).toBe(NOW + 1000)
        expect(orderGroupLikeTheTaskList(group).map(item => item.id)).toEqual(['stranded', 'other'])
    })
})

// Cloud Functions cannot import app modules, so functions/shared/calendarTaskSortIndex.js is a hand
// mirror of this module. Drive both through the same inputs so they cannot drift apart silently.
describe('client / Cloud Functions parity', () => {
    const start = { dateTime: MEETING_START }
    const allDayStart = { date: '2026-08-20' }

    const inputs = [
        [legacyEventStartIndex(start), calendarData(start), CREATED],
        [legacyBandIndex(start), calendarData(start), CREATED],
        [legacyEventStartIndex(allDayStart), calendarData(allDayStart), CREATED],
        [legacyBandIndex(allDayStart), calendarData(allDayStart), CREATED],
        [NOW, calendarData(start), CREATED],
        [NOW, null, CREATED],
        [-NOW, null, CREATED],
        [0, calendarData(start), CREATED],
        [Number.MAX_SAFE_INTEGER - 1e15 + NOW, calendarData(start), CREATED],
    ]

    it.each(inputs.map((input, index) => [index, input]))('resolveTaskSortIndex matches for case %i', (_i, input) => {
        expect(serverResolveTaskSortIndex(...input)).toBe(resolveTaskSortIndex(...input))
    })

    it('the predicates match too', () => {
        inputs.forEach(([sortIndex, data]) => {
            expect(serverIsLegacyCalendarBandSortIndex(sortIndex)).toBe(isLegacyCalendarBandSortIndex(sortIndex))
            expect(serverIsLegacyCalendarEventStartSortIndex(sortIndex, data)).toBe(
                isLegacyCalendarEventStartSortIndex(sortIndex, data)
            )
        })
    })
})
