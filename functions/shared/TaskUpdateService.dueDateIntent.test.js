jest.mock('./AlertService', () => ({ setTaskAlertCloud: jest.fn().mockResolvedValue(undefined) }))

const moment = require('moment-timezone')
const TaskUpdateService = require('./TaskUpdateService')
const { setTaskAlertCloud } = require('./AlertService')
const { isDateOnlyDueDate, isAlreadyDueOnLocalDay } = require('./dueDateIntent')

// AT-2891: Codex resent `dueDate: "2026-10-27"` with every progress comment to keep a task in
// Today, and each call wrote the task and posted "updated task due" again. A date-only value
// names a day; when the task is already due on that day nothing changes.
describe('TaskUpdateService day-level dueDate intent (AT-2891)', () => {
    // Production shape: Berlin user, `timezone` stored as integer hours (UTC+1 in late October).
    const buildService = (timezone = 1) => {
        const updateAndPersistTask = jest.fn().mockResolvedValue({ changes: [], updatedTask: { id: 'task-1' } })
        const database = {
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({
                    get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ timezone }) }),
                })),
            })),
        }
        const service = new TaskUpdateService({ database, moment })
        service.taskService = { updateAndPersistTask }
        return { service, updateAndPersistTask }
    }

    // 2026-10-27 00:00 Europe/Berlin (UTC+1) — exactly what "2026-10-27" resolved to in production.
    const BERLIN_MIDNIGHT_OCT_27 = 1793055600000
    const at = iso => moment.parseZone(iso).valueOf()

    const performUpdate = (service, currentDueDate, updateFields) =>
        service.performTaskUpdate(
            { id: 'task-1', name: 'Judy Job', userId: 'user-1', dueDate: currentDueDate },
            'project-1',
            'Project One',
            updateFields,
            'user-1',
            { uid: 'user-1', via: 'mcp', viaClient: 'Codex' }
        )

    const forwardedDueDate = updateAndPersistTask => updateAndPersistTask.mock.calls[0][0].dueDate

    beforeEach(() => setTaskAlertCloud.mockClear())

    test('repeated ensure-today calls keep the stored due date and do not request a write', async () => {
        const { service, updateAndPersistTask } = buildService()

        for (let i = 0; i < 3; i++) {
            const result = await performUpdate(service, BERLIN_MIDNIGHT_OCT_27, {
                dueDate: '2026-10-27',
                comment: `progress ${i}`,
            })
            expect(result.message).toContain('Due date unchanged: the task is already due on 2026-10-27')
        }

        expect(updateAndPersistTask).toHaveBeenCalledTimes(3)
        updateAndPersistTask.mock.calls.forEach(([params]) => {
            expect(params.dueDate).toBeUndefined()
            expect(params.keepCurrentDueDate).toBe(true)
        })
    })

    test('a task due later the same day keeps its time instead of jumping to midnight', async () => {
        const { service, updateAndPersistTask } = buildService()

        await performUpdate(service, at('2026-10-27T21:23:00+01:00'), { dueDate: '2026-10-27' })

        expect(forwardedDueDate(updateAndPersistTask)).toBeUndefined()
    })

    test('an overdue task is moved to the requested day', async () => {
        const { service, updateAndPersistTask } = buildService()

        const result = await performUpdate(service, at('2026-10-26T15:00:00+01:00'), { dueDate: '2026-10-27' })

        expect(forwardedDueDate(updateAndPersistTask)).toBe(BERLIN_MIDNIGHT_OCT_27)
        expect(updateAndPersistTask.mock.calls[0][0].keepCurrentDueDate).toBe(false)
        expect(result.message).not.toContain('Due date unchanged')
    })

    test('a task due on a later day is moved to the requested day', async () => {
        const { service, updateAndPersistTask } = buildService()

        await performUpdate(service, at('2026-10-29T09:00:00+01:00'), { dueDate: '2026-10-27' })

        expect(forwardedDueDate(updateAndPersistTask)).toBe(BERLIN_MIDNIGHT_OCT_27)
    })

    test('the day is judged in the user timezone, not in UTC', async () => {
        // 2026-10-26T23:30Z is 00:30 on Oct 27 in Berlin but still Oct 26 in UTC.
        const lateUtc = at('2026-10-26T23:30:00Z')

        const berlin = buildService(1)
        await performUpdate(berlin.service, lateUtc, { dueDate: '2026-10-27' })
        expect(forwardedDueDate(berlin.updateAndPersistTask)).toBeUndefined()

        const utc = buildService(0)
        await performUpdate(utc.service, lateUtc, { dueDate: '2026-10-27' })
        expect(forwardedDueDate(utc.updateAndPersistTask)).toBe(at('2026-10-27T00:00:00Z'))
    })

    test('a due date just past local midnight belongs to the next day', async () => {
        const { service, updateAndPersistTask } = buildService()

        // 00:30 on Oct 28 in Berlin, still Oct 27 in UTC.
        await performUpdate(service, at('2026-10-27T23:30:00Z'), { dueDate: '2026-10-27' })

        expect(forwardedDueDate(updateAndPersistTask)).toBe(BERLIN_MIDNIGHT_OCT_27)
    })

    test('an explicit time on the same day is still applied', async () => {
        const { service, updateAndPersistTask } = buildService()

        await performUpdate(service, BERLIN_MIDNIGHT_OCT_27, { dueDate: '2026-10-27T15:00:00' })

        expect(forwardedDueDate(updateAndPersistTask)).toBe(at('2026-10-27T15:00:00+01:00'))
    })

    test('a reminder request keeps treating dueDate as the alert time', async () => {
        const { service, updateAndPersistTask } = buildService()

        await performUpdate(service, at('2026-10-27T21:23:00+01:00'), {
            dueDate: '2026-10-27',
            alertEnabled: true,
        })

        expect(forwardedDueDate(updateAndPersistTask)).toBe(BERLIN_MIDNIGHT_OCT_27)
        expect(setTaskAlertCloud).toHaveBeenCalledTimes(1)
        expect(setTaskAlertCloud.mock.calls[0][4].dueDate).toBe(BERLIN_MIDNIGHT_OCT_27)
    })

    test('a Someday task is scheduled onto the requested day', async () => {
        const { service, updateAndPersistTask } = buildService()

        await performUpdate(service, Number.MAX_SAFE_INTEGER, { dueDate: '2026-10-27' })

        expect(forwardedDueDate(updateAndPersistTask)).toBe(BERLIN_MIDNIGHT_OCT_27)
    })

    test('a task without a due date gets the requested day', async () => {
        const { service, updateAndPersistTask } = buildService()

        await performUpdate(service, undefined, { dueDate: '2026-10-27' })

        expect(forwardedDueDate(updateAndPersistTask)).toBe(BERLIN_MIDNIGHT_OCT_27)
    })
})

describe('dueDateIntent helpers', () => {
    test('only a bare calendar date counts as date-only', () => {
        expect(isDateOnlyDueDate('2026-10-27')).toBe(true)
        expect(isDateOnlyDueDate(' 2026-10-27 ')).toBe(true)
        expect(isDateOnlyDueDate('2026-10-27T00:00:00')).toBe(false)
        expect(isDateOnlyDueDate('2026-10-27T00:00:00+01:00')).toBe(false)
        expect(isDateOnlyDueDate(1793055600000)).toBe(false)
        expect(isDateOnlyDueDate(undefined)).toBe(false)
    })

    test('compares the stored timestamp with the day in the given offset', () => {
        expect(isAlreadyDueOnLocalDay(1793055600000, '2026-10-27', 60, moment)).toBe(true)
        expect(isAlreadyDueOnLocalDay(1793055600000, '2026-10-27', 0, moment)).toBe(false)
        expect(isAlreadyDueOnLocalDay(Number.MAX_SAFE_INTEGER, '2026-10-27', 60, moment)).toBe(false)
        expect(isAlreadyDueOnLocalDay(null, '2026-10-27', 60, moment)).toBe(false)
    })
})
