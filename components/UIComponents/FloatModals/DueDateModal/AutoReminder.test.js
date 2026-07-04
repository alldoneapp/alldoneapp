/**
 * @jest-environment jsdom
 */

import React from 'react'
import moment from 'moment'
import { TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'

import AutoReminder from './AutoReminder'

const mockAutoReminderMultipleTasks = jest.fn(() => Promise.resolve({ updatedCount: 1 }))
const mockAutoReminderTask = jest.fn(() => Promise.resolve(123456))
const mockAutoReminderGoal = jest.fn(() => Promise.resolve(654321))
const mockDispatch = jest.fn()

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
    autoReminderMultipleTasks: (...args) => mockAutoReminderMultipleTasks(...args),
    autoReminderTask: (...args) => mockAutoReminderTask(...args),
    getDateToMoveTaskInAutoTeminder: () => require('moment')('2026-07-05T12:00:00'),
}))

jest.mock('../../../../utils/backends/Goals/goalsFirestore', () => ({
    autoReminderGoal: (...args) => mockAutoReminderGoal(...args),
    getDateToMoveGoalInAutoReminder: () => require('moment')('2026-07-06T12:00:00'),
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
        component = renderer.create(<AutoReminder {...baseProps} {...props} />)
    })
    await act(async () => component.root.findByType(TouchableOpacity).props.onPress())
    return component
}

describe('DueDateModal AutoReminder', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        useDispatch.mockReturnValue(mockDispatch)
        useSelector.mockImplementation(selector =>
            selector({ currentUser: { uid: 'target-1' }, smallScreenNavigation: false })
        )
        baseProps.closePopover = jest.fn()
    })

    test('routes a persisted single task through the callable wrapper', async () => {
        const task = { id: 'task-1', timesPostponed: 2 }
        await renderAndPress({ task })

        expect(mockAutoReminderTask).toHaveBeenCalledWith('project-1', task, false, 'target-1', {
            background: true,
        })
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_LAST_SELECTED_DUE_DATE', value: 123456 })
        expect(baseProps.closePopover).toHaveBeenCalled()
    })

    test('routes persisted multiple tasks through the callable wrapper', async () => {
        const tasks = [{ id: 'task-1' }, { id: 'task-2' }]
        await renderAndPress({ task: tasks[0], tasks })

        expect(mockAutoReminderMultipleTasks).toHaveBeenCalledWith(tasks, 'target-1', { background: true })
        expect(baseProps.closePopover).toHaveBeenCalled()
    })

    test('keeps an unsaved draft local', async () => {
        const saveDueDateBeforeSaveTask = jest.fn(() => Promise.resolve())
        await renderAndPress({ task: { timesPostponed: 0 }, saveDueDateBeforeSaveTask })

        expect(mockAutoReminderTask).not.toHaveBeenCalled()
        expect(saveDueDateBeforeSaveTask).toHaveBeenCalledWith(moment('2026-07-05T12:00:00').valueOf(), false)
        expect(baseProps.closePopover).toHaveBeenCalled()
    })

    test('closes immediately and logs a background callable failure', async () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
        mockAutoReminderTask.mockRejectedValueOnce(new Error('network'))

        await renderAndPress({ task: { id: 'task-1', timesPostponed: 0 } })

        expect(baseProps.closePopover).toHaveBeenCalled()
        expect(consoleError).toHaveBeenCalled()
        consoleError.mockRestore()
    })
})
