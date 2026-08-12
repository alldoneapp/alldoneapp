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

const { resolveTaskSortIndex } = require('./calendarTaskSortIndex')
const { mapTaskData } = require('../Utils/MapDataFuncions')

const MEETING_START = '2026-08-20T10:00:00+02:00'
const CREATED = moment('2026-08-08T09:00:00+02:00').valueOf()

describe('AT-2259 - server-side task mapping normalizes the legacy calendar sortIndex', () => {
    it('maps a legacy calendar sortIndex onto the task creation time', () => {
        const mapped = mapTaskData('task-1', {
            name: 'Weekly sync',
            userId: 'user-1',
            created: CREATED,
            calendarData: { eventId: 'event-1', start: { dateTime: MEETING_START } },
            sortIndex: moment(MEETING_START).valueOf(),
        })

        expect(mapped.sortIndex).toBe(CREATED)
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
    it('only rewrites the untouched calendar-derived value', () => {
        const legacy = moment(MEETING_START).valueOf()
        const calendarData = { start: { dateTime: MEETING_START } }

        expect(resolveTaskSortIndex(legacy, calendarData, CREATED)).toBe(CREATED)
        expect(resolveTaskSortIndex(legacy + 1, calendarData, CREATED)).toBe(legacy + 1)
        expect(resolveTaskSortIndex(legacy, null, CREATED)).toBe(legacy)
        expect(resolveTaskSortIndex(legacy, calendarData, undefined)).toBe(legacy)
    })
})

describe('the calendar sync no longer stores the event start as the ordering key', () => {
    it('has no source path deriving sortIndex from calendarData.start', () => {
        const source = require('fs').readFileSync(
            require('path').join(__dirname, '../GoogleCalendarTasks/calendarTasks.js'),
            'utf8'
        )
        const assignments = source.match(/sortIndex\s*=\s*[^\n]*/g) || []

        expect(assignments.length).toBeGreaterThan(0)
        assignments.forEach(assignment => {
            expect(assignment).not.toMatch(/start|dateTime|timezoneOffset/)
        })
    })
})
