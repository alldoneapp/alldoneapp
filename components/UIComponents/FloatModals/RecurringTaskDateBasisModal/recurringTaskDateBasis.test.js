import moment from 'moment'

import {
    getRecurrenceDateBasisOptions,
    isRecurringTaskOverdue,
    RECURRENCE_BASIS_ORIGINAL,
    RECURRENCE_BASIS_SCHEDULED,
    RECURRENCE_BASIS_TODAY,
    shouldShowRecurringTaskDateBasisModal,
    toRecurrenceBaseDate,
    wasRecurringTaskPostponed,
} from './recurringTaskDateBasis'

// AT-2803. Jest runs with TZ=UTC, so "local day" is the UTC day here.
const at = value => moment(value).valueOf()
const NOW = at('2026-10-28T08:00:00')

const recurringTask = overrides => ({
    id: 'task-1',
    recurrence: 'weekly',
    done: false,
    parentId: null,
    userIds: ['user-1'],
    dueDate: at('2026-10-28T09:00:00'),
    recurrenceOriginalDueDate: null,
    ...overrides,
})

const keys = (task, now = NOW) => getRecurrenceDateBasisOptions(task, now).map(option => option.key)

describe('when the completion popup asks for the recurrence basis', () => {
    test('a task completed on its planned day completes silently (legacy behaviour)', () => {
        expect(shouldShowRecurringTaskDateBasisModal(recurringTask(), NOW)).toBe(false)
    })

    test('a task completed early, never postponed, completes silently', () => {
        expect(shouldShowRecurringTaskDateBasisModal(recurringTask({ dueDate: at('2026-11-02T09:00:00') }), NOW)).toBe(
            false
        )
    })

    test('a postponed task asks: original, current due date and today', () => {
        const task = recurringTask({
            recurrenceOriginalDueDate: at('2026-10-26T09:00:00'),
            dueDate: at('2026-10-30T09:00:00'),
        })

        expect(shouldShowRecurringTaskDateBasisModal(task, NOW)).toBe(true)
        expect(keys(task)).toEqual([RECURRENCE_BASIS_ORIGINAL, RECURRENCE_BASIS_SCHEDULED, RECURRENCE_BASIS_TODAY])
    })

    test('an overdue task that was never postponed asks too: current due date or today', () => {
        const task = recurringTask({ dueDate: at('2026-10-21T09:00:00') })

        expect(isRecurringTaskOverdue(task, NOW)).toBe(true)
        expect(shouldShowRecurringTaskDateBasisModal(task, NOW)).toBe(true)
        expect(keys(task)).toEqual([RECURRENCE_BASIS_SCHEDULED, RECURRENCE_BASIS_TODAY])
    })

    test('due earlier today is not overdue', () => {
        const task = recurringTask({ dueDate: at('2026-10-28T00:15:00') })
        expect(isRecurringTaskOverdue(task, NOW)).toBe(false)
        expect(shouldShowRecurringTaskDateBasisModal(task, NOW)).toBe(false)
    })

    test('postponed to today: the duplicate "today" row is merged into the current due date', () => {
        const task = recurringTask({
            recurrenceOriginalDueDate: at('2026-10-26T09:00:00'),
            dueDate: at('2026-10-28T09:00:00'),
        })

        expect(keys(task)).toEqual([RECURRENCE_BASIS_ORIGINAL, RECURRENCE_BASIS_SCHEDULED])
        expect(shouldShowRecurringTaskDateBasisModal(task, NOW)).toBe(true)
    })

    test('postponed, then moved back to the planned day: no longer a postponed task', () => {
        const task = recurringTask({
            recurrenceOriginalDueDate: at('2026-10-28T09:00:00'),
            dueDate: at('2026-10-28T17:00:00'),
        })

        expect(wasRecurringTaskPostponed(task)).toBe(false)
        expect(shouldShowRecurringTaskDateBasisModal(task, NOW)).toBe(false)
    })

    test('postponed to Someday: original or today, never "Someday" as a base', () => {
        const task = recurringTask({
            recurrenceOriginalDueDate: at('2026-10-20T09:00:00'),
            dueDate: Number.MAX_SAFE_INTEGER,
        })

        expect(keys(task)).toEqual([RECURRENCE_BASIS_ORIGINAL, RECURRENCE_BASIS_TODAY])
        expect(shouldShowRecurringTaskDateBasisModal(task, NOW)).toBe(true)
    })

    test('postponed to Someday from today: only one distinct date, so nothing to ask', () => {
        const task = recurringTask({
            recurrenceOriginalDueDate: at('2026-10-28T09:00:00'),
            dueDate: Number.MAX_SAFE_INTEGER,
        })

        expect(shouldShowRecurringTaskDateBasisModal(task, NOW)).toBe(false)
    })

    test.each([
        ['not recurring', { recurrence: 'never' }],
        ['without recurrence', { recurrence: undefined }],
        ['already done', { done: true }],
        ['a subtask', { parentId: 'parent-1' }],
        ['several assignees', { userIds: ['user-1', 'user-2'] }],
        ['owned by an assistant', { assigneeType: 'ASSISTANT' }],
        ['owned by an assistant (scheduler casing)', { assigneeType: 'assistant' }],
    ])('never asks for a task that is %s', (label, overrides) => {
        const task = recurringTask({ dueDate: at('2026-10-21T09:00:00'), ...overrides })
        expect(shouldShowRecurringTaskDateBasisModal(task, NOW)).toBe(false)
    })

    test('object-shaped recurrence is recognised', () => {
        const task = recurringTask({ recurrence: { type: 'daily' }, dueDate: at('2026-10-21T09:00:00') })
        expect(shouldShowRecurringTaskDateBasisModal(task, NOW)).toBe(true)
    })

    test('legacy tasks without the new field are handled', () => {
        const task = recurringTask({ dueDate: at('2026-10-21T09:00:00') })
        delete task.recurrenceOriginalDueDate
        expect(keys(task)).toEqual([RECURRENCE_BASIS_SCHEDULED, RECURRENCE_BASIS_TODAY])
    })
})

describe('the base date sent to the server', () => {
    test('is local noon of the chosen day, whatever its time of day', () => {
        expect(moment(toRecurrenceBaseDate(at('2026-10-28T00:05:00'))).format('YYYY-MM-DD HH:mm:ss.SSS')).toBe(
            '2026-10-28 12:00:00.000'
        )
        expect(moment(toRecurrenceBaseDate(at('2026-10-28T23:59:59'))).format('YYYY-MM-DD HH:mm')).toBe(
            '2026-10-28 12:00'
        )
    })
})
