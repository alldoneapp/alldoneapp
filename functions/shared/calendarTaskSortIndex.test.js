const moment = require('moment')

// MapDataFuncions only reaches firebase-admin through this module of plain constants/helpers, so
// stubbing it keeps the mapper itself real without pulling in the functions runtime.
jest.mock('../Utils/HelperFunctionsCloud', () => ({
    FEED_PUBLIC_FOR_ALL: 0,
    DEFAULT_WORKSTREAM_ID: 'default',
    CAPACITY_NONE: 'none',
    BACKLOG_DATE_NUMERIC: Number.MAX_SAFE_INTEGER,
    CURRENT_DAY_VERSION_ID: 'current',
    RECURRENCE_NEVER: 'never',
    OPEN_STEP: 'open',
    ESTIMATION_0_MIN: 0,
    ALL_USERS: 'ALL_USERS',
    getTaskNameWithoutMeta: name => name,
    DYNAMIC_PERCENT: 'dynamic',
    TASK_ASSIGNEE_USER_TYPE: 'user',
    PROJECT_COLOR_DEFAULT: '#FFFFFF',
    ESTIMATION_TYPE_TIME: 'time',
    PROJECT_PUBLIC: 'public',
    generateNegativeSortIndex: () => -1,
}))

const { CALENDAR_LEGACY_SORT_INDEX_BASE, resolveTaskSortIndex } = require('./calendarTaskSortIndex')
const { mapTaskData } = require('../Utils/MapDataFuncions')

const MEETING_START = '2026-08-20T10:00:00+02:00'
const CREATED = moment('2026-08-08T09:00:00+02:00').valueOf()
const LEGACY_EVENT_START = moment(MEETING_START).valueOf()
const LEGACY_BAND = CALENDAR_LEGACY_SORT_INDEX_BASE - LEGACY_EVENT_START

const calendarData = { eventId: 'event-1', start: { dateTime: MEETING_START } }

describe('AT-2351 - server-side task mapping repairs the two abandoned sortIndex encodings', () => {
    it('maps a pre-AT-2259 event-start index onto the created stamp', () => {
        const mapped = mapTaskData('task-1', {
            name: 'Weekly sync',
            userId: 'user-1',
            created: CREATED,
            calendarData,
            sortIndex: LEGACY_EVENT_START,
        })

        expect(mapped.sortIndex).toBe(CREATED)
        // The whole point: it is no longer a FUTURE timestamp that nothing generated can outrank.
        expect(mapped.sortIndex).toBeLessThan(LEGACY_EVENT_START)
    })

    it('maps an AT-2270 band index onto the created stamp', () => {
        const mapped = mapTaskData('task-2', {
            name: 'Weekly sync',
            userId: 'user-1',
            created: CREATED,
            calendarData,
            sortIndex: LEGACY_BAND,
        })

        expect(mapped.sortIndex).toBe(CREATED)
    })

    it('leaves an ordinary index alone, on a calendar task as much as a normal one', () => {
        // Since AT-2351 the sync writes a plain arrival index and nothing re-derives it. Where the
        // meeting renders is decided by calendarTaskOrder.js, not by this number.
        const arrival = mapTaskData('task-3', {
            name: 'Weekly sync',
            userId: 'user-1',
            created: CREATED,
            calendarData,
            sortIndex: CREATED + 1,
        })
        expect(arrival.sortIndex).toBe(CREATED + 1)

        const normal = mapTaskData('task-4', {
            name: 'Write the report',
            userId: 'user-1',
            created: CREATED,
            sortIndex: CREATED,
        })
        expect(normal.sortIndex).toBe(CREATED)

        const dragged = moment('2026-08-11T17:04:03.271+02:00').valueOf()
        const movedCalendarTask = mapTaskData('task-5', {
            name: 'Weekly sync',
            userId: 'user-1',
            created: CREATED,
            calendarData,
            sortIndex: dragged,
        })
        expect(movedCalendarTask.sortIndex).toBe(dragged)
    })

    it('keeps the existing fallback for a task with no sortIndex at all', () => {
        const mapped = mapTaskData('task-6', { name: 'Imported', userId: 'user-1', created: CREATED })
        expect(mapped.sortIndex).toBeLessThan(0)
    })
})

describe('resolveTaskSortIndex', () => {
    it('rewrites only the two abandoned encodings', () => {
        expect(resolveTaskSortIndex(LEGACY_EVENT_START, calendarData, CREATED)).toBe(CREATED)
        expect(resolveTaskSortIndex(LEGACY_BAND, calendarData, CREATED)).toBe(CREATED)

        expect(resolveTaskSortIndex(LEGACY_EVENT_START + 1, calendarData, CREATED)).toBe(LEGACY_EVENT_START + 1)
        expect(resolveTaskSortIndex(LEGACY_EVENT_START, null, CREATED)).toBe(LEGACY_EVENT_START)
    })

    it('repairs a band index on a normal task too', () => {
        // Drag & drop derives a dropped task's index from its neighbours, so a normal task dropped
        // below a banded meeting inherited ~-1e14 and sank below everything else permanently.
        expect(resolveTaskSortIndex(LEGACY_BAND - 1, null, CREATED)).toBe(CREATED)
    })

    it('needs a usable created stamp to repair anything', () => {
        expect(resolveTaskSortIndex(LEGACY_BAND, calendarData, undefined)).toBe(LEGACY_BAND)
    })
})

describe('the calendar sync never encodes the event time into sortIndex', () => {
    it('derives every calendar sortIndex through the shared helper', () => {
        const source = require('fs').readFileSync(
            require('path').join(__dirname, '../GoogleCalendarTasks/calendarTasks.js'),
            'utf8'
        )
        const assignments = source.match(/^\s*[\w.]*sortIndex\s*=\s*[^\n]*/gm) || []

        expect(assignments.length).toBeGreaterThan(0)
        assignments.forEach(assignment => {
            // AT-2259 forbade assigning the event start raw; AT-2270 replaced it with a derived
            // band; AT-2351 removed the derivation entirely. The one permitted source is
            // generateCalendarTaskSortIndex(), which is now just "now".
            expect(assignment).toMatch(/generateCalendarTaskSortIndex\(\)/)
            expect(assignment).not.toMatch(/moment\(|timezoneOffset|calendarData/)
        })
    })
})
