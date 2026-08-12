import moment from 'moment'

jest.mock('../../../../utils/BackendBridge', () => ({
    setTaskDueDateMultiple: jest.fn(),
}))
jest.mock('../../../../utils/backends/Tasks/tasksFirestore', () => ({
    setTaskDueDate: jest.fn(),
}))
jest.mock('../../../../redux/actions', () => ({
    setSelectedTasks: (...args) => ({ type: 'setSelectedTasks', args }),
    setLastSelectedDueDate: dueDate => ({ type: 'setLastSelectedDueDate', dueDate }),
}))

import Backend from '../../../../utils/BackendBridge'
import { setTaskDueDate } from '../../../../utils/backends/Tasks/tasksFirestore'
import { applyDaySelection } from './daySelection'

const tomorrow = moment().add(1, 'day')
const tomorrowParts = { year: tomorrow.year(), month: tomorrow.month() + 1, day: tomorrow.date() }
const expectedDueDate = new Date(tomorrowParts.year, tomorrowParts.month - 1, tomorrowParts.day).getTime()

const baseContext = () => ({
    dispatch: jest.fn(),
    updateDate: jest.fn(),
    projectId: 'p1',
    isObservedTabActive: false,
})

describe('applyDaySelection (extracted from the due-date Day cell)', () => {
    beforeEach(() => jest.clearAllMocks())

    it('rejects a past day and applies nothing', () => {
        const yesterday = moment().subtract(1, 'day')
        const context = baseContext()
        const applied = applyDaySelection(
            { year: yesterday.year(), month: yesterday.month() + 1, day: yesterday.date() },
            context
        )
        expect(applied).toBe(false)
        expect(context.updateDate).not.toHaveBeenCalled()
        expect(context.dispatch).not.toHaveBeenCalled()
    })

    it('prefers the explicit saveDueDateBeforeSaveTask callback over any write', () => {
        const context = { ...baseContext(), saveDueDateBeforeSaveTask: jest.fn(), task: { id: 't1' } }
        expect(applyDaySelection(tomorrowParts, context)).toBe(true)
        expect(context.saveDueDateBeforeSaveTask).toHaveBeenCalledWith(expectedDueDate, false)
        expect(setTaskDueDate).not.toHaveBeenCalled()
        expect(context.dispatch).toHaveBeenCalledWith({ type: 'setLastSelectedDueDate', dueDate: expectedDueDate })
    })

    it('writes a single task due date through tasksFirestore', () => {
        const task = { id: 't1' }
        const context = { ...baseContext(), task }
        expect(applyDaySelection(tomorrowParts, context)).toBe(true)
        expect(setTaskDueDate).toHaveBeenCalledWith('p1', 't1', expectedDueDate, task, false, null)
    })

    it('multi-select writes all tasks and clears the selection', () => {
        const tasks = [{ id: 'a' }, { id: 'b' }]
        const context = { ...baseContext(), task: { id: 'a' }, tasks, multipleTasks: true }
        expect(applyDaySelection(tomorrowParts, context)).toBe(true)
        expect(Backend.setTaskDueDateMultiple).toHaveBeenCalledWith(tasks, expectedDueDate)
        expect(context.dispatch).toHaveBeenCalledWith({ type: 'setSelectedTasks', args: [null, true] })
        expect(setTaskDueDate).not.toHaveBeenCalled()
    })

    it('a parent-goal reminder callback outranks the single-task write', () => {
        const context = { ...baseContext(), task: { id: 't1' }, updateParentGoalReminderDate: jest.fn() }
        expect(applyDaySelection(tomorrowParts, context)).toBe(true)
        expect(context.updateParentGoalReminderDate).toHaveBeenCalledWith(expectedDueDate)
        expect(setTaskDueDate).not.toHaveBeenCalled()
    })

    it('goal milestones get a noon timestamp', () => {
        const context = { ...baseContext(), updateGoalMilestone: jest.fn() }
        expect(applyDaySelection(tomorrowParts, context)).toBe(true)
        const expectedNoon = moment(new Date(tomorrowParts.year, tomorrowParts.month - 1, tomorrowParts.day))
            .hour(12)
            .minute(0)
            .valueOf()
        expect(context.updateGoalMilestone).toHaveBeenCalledWith(expectedNoon)
    })
})
