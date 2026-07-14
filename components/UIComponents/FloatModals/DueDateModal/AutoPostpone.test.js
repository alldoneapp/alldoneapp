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

    test('postpones a goal and its connected tasks through one goal action', async () => {
        const goal = { id: 'goal-1', timesPostponed: 2 }
        const tasks = [{ id: 'task-1' }, { id: 'task-2' }]

        await renderAndPress({ goal, tasks, updateParentGoalReminderDate: jest.fn(), inParentGoal: true })

        expect(mockAutoPostponeGoal).toHaveBeenCalledWith('project-1', goal, 'target-1', true)
        expect(mockAutoPostponeMultipleTasks).not.toHaveBeenCalled()
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_LAST_SELECTED_DUE_DATE', value: 654321 })
        expect(baseProps.closePopover).toHaveBeenCalled()
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
