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

const { getDefaultCalendarSortIndex, resolveTaskSortIndex } = require('./calendarTaskSortIndex')
const { mapTaskData } = require('../Utils/MapDataFuncions')

const MEETING_START = '2026-08-20T10:00:00+02:00'
const CREATED = moment('2026-08-08T09:00:00+02:00').valueOf()
const DEFAULT_PLACEMENT = getDefaultCalendarSortIndex({ start: { dateTime: MEETING_START } })

describe('AT-2259 / AT-2270 - server-side task mapping normalizes the calendar sortIndex', () => {
    it('maps an untouched calendar sortIndex onto the default placement, in both stored shapes', () => {
        const legacy = mapTaskData('task-1', {
            name: 'Weekly sync',
            userId: 'user-1',
            created: CREATED,
            calendarData: { eventId: 'event-1', start: { dateTime: MEETING_START } },
            sortIndex: moment(MEETING_START).valueOf(), // pre-AT-2259: the event start
        })
        expect(legacy.sortIndex).toBe(DEFAULT_PLACEMENT)

        const arrival = mapTaskData('task-1b', {
            name: 'Weekly sync',
            userId: 'user-1',
            created: CREATED,
            calendarData: { eventId: 'event-1', start: { dateTime: MEETING_START } },
            sortIndex: CREATED + 1, // post-AT-2259: the arrival index
        })
        expect(arrival.sortIndex).toBe(DEFAULT_PLACEMENT)
        // Below every generated index, so the meeting sits under the ordinary tasks of its group.
        expect(DEFAULT_PLACEMENT).toBeLessThan(-moment().valueOf())
    })

    it('leaves a normal task and a user-influenced calendar task untouched', () => {
        const normal = mapTaskData('task-2', {
            name: 'Write the report',
            userId: 'user-1',
            created: CREATED,
            sortIndex: CREATED,
        })
        expect(normal.sortIndex).toBe(CREATED)

        const dragged = moment('2026-08-11T17:04:03.271+02:00').valueOf()
        const movedCalendarTask = mapTaskData('task-3', {
            name: 'Weekly sync',
            userId: 'user-1',
            created: CREATED,
            calendarData: { eventId: 'event-1', start: { dateTime: MEETING_START } },
            sortIndex: dragged,
        })
        expect(movedCalendarTask.sortIndex).toBe(dragged)
    })

    it('keeps the existing fallback for a task with no sortIndex at all', () => {
        const mapped = mapTaskData('task-4', { name: 'Imported', userId: 'user-1', created: CREATED })
        expect(mapped.sortIndex).toBeLessThan(0)
    })
})

describe('resolveTaskSortIndex', () => {
    it('only rewrites a sortIndex no user has influenced', () => {
        const legacy = moment(MEETING_START).valueOf()
        const calendarData = { start: { dateTime: MEETING_START } }

        expect(resolveTaskSortIndex(legacy, calendarData, CREATED)).toBe(DEFAULT_PLACEMENT)
        expect(resolveTaskSortIndex(legacy + 1, calendarData, CREATED)).toBe(legacy + 1)
        expect(resolveTaskSortIndex(legacy, null, CREATED)).toBe(legacy)
        // A legacy value is recognisable without `created`, an arrival index is not.
        expect(resolveTaskSortIndex(legacy, calendarData, undefined)).toBe(DEFAULT_PLACEMENT)
        expect(resolveTaskSortIndex(CREATED, calendarData, undefined)).toBe(CREATED)
    })
})

describe('the calendar sync never stores a sortIndex that can outrank an ordinary task', () => {
    it('derives every calendar sortIndex through the shared helper', () => {
        const source = require('fs').readFileSync(
            require('path').join(__dirname, '../GoogleCalendarTasks/calendarTasks.js'),
            'utf8'
        )
        const assignments = source.match(/^\s*[\w.]*sortIndex\s*=\s*[^\n]*/gm) || []

        expect(assignments.length).toBeGreaterThan(0)
        assignments.forEach(assignment => {
            // AT-2259: the event start must never be assigned raw. AT-2270: the only permitted
            // source is generateCalendarTaskSortIndex(), which derives the below-everything band.
            expect(assignment).toMatch(/generateCalendarTaskSortIndex\(/)
            expect(assignment).not.toMatch(/moment\(|timezoneOffset/)
        })
    })
})
