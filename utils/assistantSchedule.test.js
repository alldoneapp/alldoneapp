import moment from 'moment-timezone'

import {
    buildAssistantProfileTimelineDates,
    buildAssistantScheduleOccurrences,
    getScheduleActivations,
} from './assistantSchedule'
import { RECURRENCE_DAILY, RECURRENCE_ONCE, RECURRENCE_WEEKLY } from '../components/TaskListView/Utils/TasksHelper'

describe('assistant schedule timeline', () => {
    const startDate = moment.tz('2026-08-04 12:00', 'UTC').valueOf()
    const users = {
        'user-1': { uid: 'user-1', preferredTimezone: 'UTC' },
        'user-2': { uid: 'user-2', preferredTimezone: 'Europe/Berlin' },
    }

    it('projects every member activation independently', () => {
        const task = {
            id: 'schedule-1',
            name: 'Project report',
            startDate,
            startTime: '09:00',
            recurrence: RECURRENCE_DAILY,
            recurrenceByUser: {
                'user-1': RECURRENCE_DAILY,
                'user-2': RECURRENCE_WEEKLY,
            },
        }

        const occurrences = buildAssistantScheduleOccurrences([task], userId => users[userId], {
            now: moment.tz('2026-08-03 08:00', 'UTC').valueOf(),
            horizonDays: 30,
        })

        expect(occurrences.filter(item => item.userId === 'user-1')).toHaveLength(1)
        expect(occurrences.filter(item => item.userId === 'user-2')).toHaveLength(1)
        expect(occurrences.find(item => item.userId === 'user-1').timezoneName).toBe('UTC')
        expect(occurrences.find(item => item.userId === 'user-2').timezoneName).toBe('Europe/Berlin')
    })

    it('shows an active one-off schedule once and hides it after completion', () => {
        const task = {
            id: 'schedule-once',
            name: 'Launch brief',
            startDate,
            startTime: '09:00',
            recurrence: RECURRENCE_ONCE,
            recurrenceByUser: {
                'user-1': RECURRENCE_ONCE,
                'user-2': RECURRENCE_ONCE,
            },
            completedOneOffUserIds: ['user-1'],
        }

        expect(getScheduleActivations(task)).toEqual([{ userId: 'user-2', recurrence: RECURRENCE_ONCE }])
        expect(
            buildAssistantScheduleOccurrences([task], userId => users[userId], {
                now: moment.tz('2026-08-03 08:00', 'UTC').valueOf(),
            })
        ).toHaveLength(1)
    })

    it('reveals the following recurrence only after the current occurrence succeeds', () => {
        const task = {
            id: 'schedule-next',
            name: 'Daily handover',
            startDate,
            startTime: '09:00',
            recurrence: RECURRENCE_DAILY,
            recurrenceByUser: { 'user-1': RECURRENCE_DAILY },
        }
        const now = moment.tz('2026-08-04 10:00', 'UTC').valueOf()

        const current = buildAssistantScheduleOccurrences([task], userId => users[userId], { now })
        const afterSuccess = buildAssistantScheduleOccurrences(
            [
                {
                    ...task,
                    lastExecutedByUser: { 'user-1': moment.tz('2026-08-04 09:00', 'UTC').valueOf() },
                },
            ],
            userId => users[userId],
            { now }
        )

        expect(moment.tz(current[0].timestamp, 'UTC').format('YYYY-MM-DD HH:mm')).toBe('2026-08-04 09:00')
        expect(moment.tz(afterSuccess[0].timestamp, 'UTC').format('YYYY-MM-DD HH:mm')).toBe('2026-08-05 09:00')
    })

    it('does not resurrect a paused schedule through its legacy activator fields', () => {
        expect(
            getScheduleActivations({
                recurrence: RECURRENCE_DAILY,
                recurrenceByUser: {},
                activatedUserIds: [],
                activatorUserId: 'user-1',
                creatorUserId: 'user-1',
            })
        ).toEqual([])
    })

    it('merges the next occurrence into ordinary task dates and adds schedule-only dates', () => {
        const now = moment.tz('2026-08-03 08:00', 'UTC').valueOf()
        const occurrences = [
            { id: 'today', dateKey: '20260803' },
            { id: 'future', dateKey: '20260805' },
        ]

        expect(buildAssistantProfileTimelineDates(['0', '20260804'], occurrences, now)).toEqual([
            { dateKey: '0', dateIndex: 0, occurrences: [occurrences[0]] },
            { dateKey: '20260804', dateIndex: 1, occurrences: [] },
            { dateKey: '20260805', dateIndex: null, occurrences: [occurrences[1]] },
        ])
    })
})
