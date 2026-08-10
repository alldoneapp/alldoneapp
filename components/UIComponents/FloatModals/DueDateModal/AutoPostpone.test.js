/**
 * @jest-environment jsdom
 */

import React from 'react'
import moment from 'moment'
import { TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'

import AutoPostpone from './AutoPostpone'

const BACKLOG_DATE_NUMERIC = Number.MAX_SAFE_INTEGER

const mockAutoPostponeMultipleTasks = jest.fn(() => Promise.resolve({ updatedCount: 1 }))
const mockSetTaskDueDate = jest.fn(() => Promise.resolve())
const mockSetTaskToBacklog = jest.fn(() => Promise.resolve())
const mockAutoPostponeGoal = jest.fn(() => Promise.resolve(654321))
const mockDispatch = jest.fn()
let mockDateToMoveTask

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
}))

jest.mock('react-hot-keys', () => props => props.children)
jest.mock('../../../Icon', () => () => null)
jest.mock('../../../UIControls/Shortcut', () => () => null)
jest.mock('./DateText', () => () => null)
jest.mock('../../../TaskListView/Utils/TasksHelper', () => ({
    BACKLOG_DATE_NUMERIC: Number.MAX_SAFE_INTEGER,
}))

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: text => text,
}))

jest.mock('../../../../redux/actions', () => ({
    setLastSelectedDueDate: value => ({ type: 'SET_LAST_SELECTED_DUE_DATE', value }),
    setOptimisticGoalPostpone: (projectId, goalId, date, startedAt) => ({
        type: 'SET_OPTIMISTIC_GOAL_POSTPONE',
        projectId,
        goalId,
        date,
        startedAt,
    }),
    clearOptimisticGoalPostpone: (projectId, goalId) => ({
        type: 'CLEAR_OPTIMISTIC_GOAL_POSTPONE',
        projectId,
        goalId,
    }),
}))

jest.mock('../../../../utils/backends/Tasks/tasksFirestore', () => ({
    autoPostponeMultipleTasks: (...args) => mockAutoPostponeMultipleTasks(...args),
    setTaskDueDate: (...args) => mockSetTaskDueDate(...args),
    setTaskToBacklog: (...args) => mockSetTaskToBacklog(...args),
    getDateToMoveTaskInAutoPostpone: () => mockDateToMoveTask,
}))

jest.mock('../../../../utils/backends/Goals/goalsFirestore', () => ({
    autoPostponeGoal: (...args) => mockAutoPostponeGoal(...args),
    getDateToMoveGoalInAutoPostpone: () => require('moment')('2026-07-06T12:00:00'),
}))

const baseProps = {
    projectId: 'project-1',
    isObservedTabActive: false,
    closePopover: jest.fn(),
    updateParentGoalReminderDate: null,
    inParentGoal: false,
}

const renderAndPress = async props => {
    let component
    act(() => {
        component = renderer.create(<AutoPostpone {...baseProps} {...props} />)
    })
    await act(async () => component.root.findByType(TouchableOpacity).props.onPress())
    return component
}

describe('DueDateModal AutoPostpone', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockDateToMoveTask = moment('2026-07-05T12:00:00')
        useDispatch.mockReturnValue(mockDispatch)
        useSelector.mockImplementation(selector =>
            selector({ currentUser: { uid: 'target-1' }, smallScreenNavigation: false })
        )
        baseProps.closePopover = jest.fn()
    })

    test('applies a persisted single task via a direct due-date write', async () => {
        const task = { id: 'task-1', timesPostponed: 2 }
        await renderAndPress({ task })

        const expectedDate = moment('2026-07-05T12:00:00').valueOf()
        expect(mockSetTaskDueDate).toHaveBeenCalledWith('project-1', 'task-1', expectedDate, task, false)
        expect(mockSetTaskToBacklog).not.toHaveBeenCalled()
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_LAST_SELECTED_DUE_DATE', value: expectedDate })
        expect(baseProps.closePopover).toHaveBeenCalled()
    })

    test('moves a persisted single task to the backlog when the postpone date is someday', async () => {
        mockDateToMoveTask = BACKLOG_DATE_NUMERIC
        const task = { id: 'task-1', timesPostponed: 5 }
        await renderAndPress({ task })

        expect(mockSetTaskToBacklog).toHaveBeenCalledWith('project-1', 'task-1', task, false, null)
        expect(mockSetTaskDueDate).not.toHaveBeenCalled()
        expect(mockDispatch).toHaveBeenCalledWith({
            type: 'SET_LAST_SELECTED_DUE_DATE',
            value: BACKLOG_DATE_NUMERIC,
        })
        expect(baseProps.closePopover).toHaveBeenCalled()
    })

    test('routes persisted multiple tasks through the callable wrapper', async () => {
        const tasks = [{ id: 'task-1' }, { id: 'task-2' }]
        await renderAndPress({ task: tasks[0], tasks })

        expect(mockAutoPostponeMultipleTasks).toHaveBeenCalledWith(tasks, 'target-1', { background: true })
        expect(baseProps.closePopover).toHaveBeenCalled()
    })

    test('closes immediately while postponing a goal and its connected tasks in the background', async () => {
        const goal = { id: 'goal-1', timesPostponed: 2 }
        const tasks = [{ id: 'task-1' }, { id: 'task-2' }]
        let resolveRequest
        const pendingRequest = new Promise(resolve => {
            resolveRequest = resolve
        })
        mockAutoPostponeGoal.mockReturnValueOnce(pendingRequest)

        await renderAndPress({ goal, tasks, updateParentGoalReminderDate: jest.fn(), inParentGoal: true })

        expect(mockAutoPostponeGoal).toHaveBeenCalledWith('project-1', goal, 'target-1', true, { background: true })
        expect(mockAutoPostponeMultipleTasks).not.toHaveBeenCalled()
        expect(mockDispatch).toHaveBeenCalledWith({
            type: 'SET_LAST_SELECTED_DUE_DATE',
            value: moment('2026-07-06T12:00:00').valueOf(),
        })
        expect(baseProps.closePopover).toHaveBeenCalled()

        resolveRequest(654321)
        await act(async () => pendingRequest)
    })

    // AT-2160
    test('marks the goal as optimistically postponed before the server call is even made', async () => {
        const goal = { id: 'goal-1', timesPostponed: 2 }
        let resolveRequest
        mockAutoPostponeGoal.mockReturnValueOnce(
            new Promise(resolve => {
                resolveRequest = resolve
            })
        )

        await renderAndPress({ goal, updateParentGoalReminderDate: jest.fn(), inParentGoal: true })

        const optimisticDispatch = mockDispatch.mock.calls
            .map(([action]) => action)
            .find(action => action.type === 'SET_OPTIMISTIC_GOAL_POSTPONE')
        expect(optimisticDispatch).toMatchObject({
            projectId: 'project-1',
            goalId: 'goal-1',
            date: moment('2026-07-06T12:00:00').valueOf(),
        })
        expect(typeof optimisticDispatch.startedAt).toBe('number')
        // Still pending: the row must stay hidden, so nothing clears it yet.
        expect(mockDispatch).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'CLEAR_OPTIMISTIC_GOAL_POSTPONE' })
        )

        resolveRequest(654321)
    })

    test('logs a goal auto-postpone background failure after closing', async () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
        mockAutoPostponeGoal.mockRejectedValueOnce(new Error('network'))

        await renderAndPress({
            goal: { id: 'goal-1', timesPostponed: 2 },
            updateParentGoalReminderDate: jest.fn(),
        })

        expect(baseProps.closePopover).toHaveBeenCalled()
        expect(consoleError).toHaveBeenCalledWith('AutoPostpone: failed to apply auto-postpone', expect.any(Error))
        consoleError.mockRestore()
    })

    // AT-2160: a rejected postpone must put the goal straight back into the list.
    test('rolls the optimistic postpone back when the server rejects it', async () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
        mockAutoPostponeGoal.mockRejectedValueOnce(new Error('network'))

        await renderAndPress({
            goal: { id: 'goal-1', timesPostponed: 2 },
            updateParentGoalReminderDate: jest.fn(),
        })

        expect(mockDispatch).toHaveBeenCalledWith({
            type: 'CLEAR_OPTIMISTIC_GOAL_POSTPONE',
            projectId: 'project-1',
            goalId: 'goal-1',
        })
        consoleError.mockRestore()
    })

    // AT-2160: swiping the general-tasks header, or a goal section holding exactly one task,
    // arrives here with a one-element list. That used to take the Cloud Function path.
    test('writes a one-element task list directly instead of using the bulk callable', async () => {
        const onlyTask = { id: 'task-1', timesPostponed: 2 }
        await renderAndPress({ task: onlyTask, tasks: [onlyTask] })

        const expectedDate = moment('2026-07-05T12:00:00').valueOf()
        expect(mockAutoPostponeMultipleTasks).not.toHaveBeenCalled()
        expect(mockSetTaskDueDate).toHaveBeenCalledWith('project-1', 'task-1', expectedDate, onlyTask, false)
        expect(baseProps.closePopover).toHaveBeenCalled()
    })

    test('still routes a one-element list to the backlog directly when the ladder says someday', async () => {
        mockDateToMoveTask = BACKLOG_DATE_NUMERIC
        const onlyTask = { id: 'task-1', timesPostponed: 6 }
        await renderAndPress({ task: onlyTask, tasks: [onlyTask] })

        expect(mockAutoPostponeMultipleTasks).not.toHaveBeenCalled()
        expect(mockSetTaskToBacklog).toHaveBeenCalledWith('project-1', 'task-1', onlyTask, false, null)
    })

    test('keeps an unsaved draft local', async () => {
        const saveDueDateBeforeSaveTask = jest.fn(() => Promise.resolve())
        await renderAndPress({ task: { timesPostponed: 0 }, saveDueDateBeforeSaveTask })

        expect(mockSetTaskDueDate).not.toHaveBeenCalled()
        expect(saveDueDateBeforeSaveTask).toHaveBeenCalledWith(moment('2026-07-05T12:00:00').valueOf(), false)
        expect(baseProps.closePopover).toHaveBeenCalled()
    })

    test('closes immediately and logs a background write failure', async () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
        mockSetTaskDueDate.mockRejectedValueOnce(new Error('network'))

        await renderAndPress({ task: { id: 'task-1', timesPostponed: 0 } })

        expect(baseProps.closePopover).toHaveBeenCalled()
        expect(consoleError).toHaveBeenCalled()
        consoleError.mockRestore()
    })
})
