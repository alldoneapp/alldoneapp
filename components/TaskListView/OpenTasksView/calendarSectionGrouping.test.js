import { buildChronologicalCalendarRuns } from './calendarSectionGrouping'

// Mirrors `NOT_PARENT_GOAL_INDEX`. The module under test never compares against it - a run with no
// goal is just a run whose `goalId` happens to be this - so it is a plain fixture here.
const GENERAL_TASKS = '0'

const meeting = (id, start) => ({ id, calendarData: { email: 'karsten@alldone.app', start } })
const timed = (id, isoStart) => meeting(id, { dateTime: isoStart })
const allDay = (id, day) => meeting(id, { date: day })

const runShape = runs => runs.map(run => [run.goalId, run.taskList.map(task => task.id)])

// AT-2436 - the whole day is one chronological list; a goal is a heading cut into it.
describe('buildChronologicalCalendarRuns', () => {
    it('interleaves a goal meeting between the general meetings it sits between', () => {
        // The reported case: the 11:30 meeting carries a goal and used to render below the 17:15 one,
        // because its goal bucket sorted after the whole general bucket.
        const runs = buildChronologicalCalendarRuns([
            [
                GENERAL_TASKS,
                [
                    timed('ten', '2026-08-26T10:00:00+02:00'),
                    timed('fourteen', '2026-08-26T14:00:00+02:00'),
                    timed('seventeen', '2026-08-26T17:15:00+02:00'),
                ],
            ],
            ['goal-1', [timed('eleven-thirty', '2026-08-26T11:30:00+02:00')]],
        ])

        expect(runShape(runs)).toEqual([
            [GENERAL_TASKS, ['ten']],
            ['goal-1', ['eleven-thirty']],
            [GENERAL_TASKS, ['fourteen', 'seventeen']],
        ])
    })

    it('keeps consecutive meetings of one goal in a single run', () => {
        const runs = buildChronologicalCalendarRuns([
            [GENERAL_TASKS, [timed('nine', '2026-08-26T09:00:00+02:00')]],
            ['goal-1', [timed('eleven', '2026-08-26T11:00:00+02:00'), timed('ten', '2026-08-26T10:00:00+02:00')]],
        ])

        expect(runShape(runs)).toEqual([
            [GENERAL_TASKS, ['nine']],
            ['goal-1', ['ten', 'eleven']],
        ])
    })

    // The alternative - one card holding both meetings - is the bug: it lifts the 16:00 meeting above
    // the 12:00 one. Chronology wins, so the goal gets a second heading.
    it('opens a second run for a goal whose meetings are separated in time', () => {
        const runs = buildChronologicalCalendarRuns([
            [
                'goal-1',
                [timed('goal-ten', '2026-08-26T10:00:00+02:00'), timed('goal-four', '2026-08-26T16:00:00+02:00')],
            ],
            [GENERAL_TASKS, [timed('general-noon', '2026-08-26T12:00:00+02:00')]],
        ])

        expect(runShape(runs)).toEqual([
            ['goal-1', ['goal-ten']],
            [GENERAL_TASKS, ['general-noon']],
            ['goal-1', ['goal-four']],
        ])
    })

    it('numbers the runs of one goal so each can get its own key', () => {
        const runs = buildChronologicalCalendarRuns([
            [
                'goal-1',
                [timed('goal-ten', '2026-08-26T10:00:00+02:00'), timed('goal-four', '2026-08-26T16:00:00+02:00')],
            ],
            [GENERAL_TASKS, [timed('general-noon', '2026-08-26T12:00:00+02:00')]],
        ])

        expect(runs.map(run => run.occurrence)).toEqual([0, 0, 1])
        expect(runs.map(run => run.key)).toEqual(['goal-1#0', '0#0', 'goal-1#1'])
        expect(new Set(runs.map(run => run.key)).size).toBe(runs.length)
    })

    // The drag system resolves a drop target from the bucket index, and the buckets are untouched -
    // only their rendering is re-cut - so every run of a goal keeps that goal's original index.
    it('keeps the index of the goal bucket in the incoming array', () => {
        const runs = buildChronologicalCalendarRuns([
            [GENERAL_TASKS, [timed('general-noon', '2026-08-26T12:00:00+02:00')]],
            [
                'goal-1',
                [timed('goal-ten', '2026-08-26T10:00:00+02:00'), timed('goal-four', '2026-08-26T16:00:00+02:00')],
            ],
        ])

        expect(runs.map(run => [run.goalId, run.goalIndex])).toEqual([
            ['goal-1', 1],
            [GENERAL_TASKS, 0],
            ['goal-1', 1],
        ])
    })

    it('leads the day with its all-day events, whichever group they are in', () => {
        const runs = buildChronologicalCalendarRuns([
            [GENERAL_TASKS, [timed('general-nine', '2026-08-26T09:00:00+02:00')]],
            ['goal-1', [allDay('goal-all-day', '2026-08-26')]],
        ])

        expect(runShape(runs)).toEqual([
            ['goal-1', ['goal-all-day']],
            [GENERAL_TASKS, ['general-nine']],
        ])
    })

    it('sorts a meeting with no usable start to the end instead of dropping it', () => {
        const runs = buildChronologicalCalendarRuns([
            [GENERAL_TASKS, [{ id: 'broken', calendarData: {} }, timed('nine', '2026-08-26T09:00:00+02:00')]],
        ])

        expect(runShape(runs)).toEqual([[GENERAL_TASKS, ['nine', 'broken']]])
    })

    // Two meetings starting at the same moment must never swap places between renders.
    it('breaks a tie by bucket order and then arrival order', () => {
        const buckets = [
            [
                GENERAL_TASKS,
                [timed('general-a', '2026-08-26T09:00:00+02:00'), timed('general-b', '2026-08-26T09:00:00+02:00')],
            ],
            ['goal-1', [timed('goal-a', '2026-08-26T09:00:00+02:00')]],
        ]

        expect(runShape(buildChronologicalCalendarRuns(buckets))).toEqual([
            [GENERAL_TASKS, ['general-a', 'general-b']],
            ['goal-1', ['goal-a']],
        ])
        expect(runShape(buildChronologicalCalendarRuns(buckets))).toEqual(
            runShape(buildChronologicalCalendarRuns(buckets))
        )
    })

    it('survives an empty, malformed or absent bucket list', () => {
        expect(buildChronologicalCalendarRuns([])).toEqual([])
        expect(buildChronologicalCalendarRuns(undefined)).toEqual([])
        expect(buildChronologicalCalendarRuns([[GENERAL_TASKS, []], ['goal-1', null], null])).toEqual([])
        expect(
            runShape(
                buildChronologicalCalendarRuns([[GENERAL_TASKS, [null, timed('nine', '2026-08-26T09:00:00+02:00')]]])
            )
        ).toEqual([[GENERAL_TASKS, ['nine']]])
    })

    it('does not mutate the buckets it was given', () => {
        const generalTasks = [timed('noon', '2026-08-26T12:00:00+02:00'), timed('nine', '2026-08-26T09:00:00+02:00')]
        const calendarEvents = [[GENERAL_TASKS, generalTasks]]

        buildChronologicalCalendarRuns(calendarEvents)

        expect(generalTasks.map(task => task.id)).toEqual(['noon', 'nine'])
        expect(calendarEvents[0][1]).toBe(generalTasks)
    })

    // A goal id is user-facing data, so it must never be used as a plain-object key.
    it('handles a goal id that would corrupt a plain object', () => {
        const runs = buildChronologicalCalendarRuns([
            ['__proto__', [timed('a', '2026-08-26T09:00:00+02:00'), timed('c', '2026-08-26T13:00:00+02:00')]],
            [GENERAL_TASKS, [timed('b', '2026-08-26T11:00:00+02:00')]],
        ])

        expect(runs.map(run => run.key)).toEqual(['__proto__#0', '0#0', '__proto__#1'])
    })
})
