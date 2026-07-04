/**
 * @jest-environment jsdom
 */

import React from 'react'
import moment from 'moment'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'

import AutoReminderTasksModal from './AutoReminderTasksModal'

const mockAutoReminderMultipleTasks = jest.fn(() => Promise.resolve({ updatedCount: 1 }))

jest.mock('react-redux', () => ({
    useSelector: jest.fn(),
}))

jest.mock('../../../i18n/TranslationService', () => ({
    translate: text => text,
}))

jest.mock('../../../utils/useWindowSize', () => ({
    __esModule: true,
    default: () => [1200, 800],
}))

jest.mock('../../../utils/HelperFunctions', () => ({
    applyPopoverWidthV2: () => ({ width: 758 }),
    MODAL_MAX_HEIGHT_GAP: 32,
}))

jest.mock('../../UIControls/Button', () => {
    const React = require('react')
    const { Text, TouchableOpacity } = require('react-native')
    return props =>
        React.createElement(
            TouchableOpacity,
            { onPress: props.onPress, disabled: props.disabled, title: props.title },
            React.createElement(Text, null, props.title)
        )
})

jest.mock('../Utils/TasksHelper', () => ({
    BACKLOG_DATE_NUMERIC: Number.MAX_SAFE_INTEGER,
}))

jest.mock('../../../utils/backends/Tasks/tasksFirestore', () => ({
    autoReminderMultipleTasks: (...args) => mockAutoReminderMultipleTasks(...args),
    getDateToMoveTaskInAutoTeminder: () => require('moment')('2026-07-05T12:00:00'),
}))

const today = moment().startOf('day').valueOf()
const makeTask = (id, priority, projectId = 'project-1', sortIndex = 1) => ({
    id,
    projectId,
    name: `Task ${id}`,
    priority,
    sortIndex,
    dueDate: today,
    timesPostponed: 0,
    parentId: null,
    done: false,
    inDone: false,
    isObservedTask: false,
})

const buildState = () => ({
    currentUser: { uid: 'user-1' },
    openTasksMap: {
        'project-1': {
            later: makeTask('later', 'do_later'),
            must1: makeTask('must-1', 'must_do', 'project-1', 2),
            must2: makeTask('must-2', 'must_do', 'project-1', 3),
        },
        'project-2': {
            later2: makeTask('later-2', 'do_later', 'project-2'),
        },
    },
    loggedUserProjectsMap: {
        'project-1': { name: 'Project One', index: 0 },
        'project-2': { name: 'Project Two', index: 1 },
    },
    isMiddleScreen: false,
    smallScreenNavigation: false,
})

describe('AutoReminderTasksModal', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        useSelector.mockImplementation(selector => selector(buildState()))
    })

    test('supports automatic expansion, manual collapse, partial state, and individual Apply selection', async () => {
        let component
        const closePopover = jest.fn()
        act(() => {
            component = renderer.create(<AutoReminderTasksModal projectId="project-1" closePopover={closePopover} />)
        })
        const root = component.root

        expect(root.findByProps({ testID: 'auto-reminder-modal' }).props.style).toEqual(
            expect.arrayContaining([{ width: 758 }])
        )
        expect(root.findByProps({ testID: 'auto-reminder-task-project-1:later' })).toBeTruthy()
        expect(root.findAllByProps({ testID: 'auto-reminder-task-project-1:must-1' })).toHaveLength(0)

        act(() => root.findByProps({ testID: 'auto-reminder-priority-must_do-select' }).props.onPress())
        expect(root.findByProps({ testID: 'auto-reminder-task-project-1:must-1' })).toBeTruthy()
        expect(root.findByProps({ testID: 'auto-reminder-task-project-1:must-2' })).toBeTruthy()

        const mustOneTaskRow = root
            .findAllByProps({ testID: 'auto-reminder-task-project-1:must-1' })
            .find(node => typeof node.props.onPress === 'function')
        act(() => mustOneTaskRow.props.onPress())
        const mustPriorityCheckbox = root
            .findAllByProps({ testID: 'auto-reminder-priority-must_do-checkbox' })
            .find(node => node.props.accessibilityState)
        expect(mustPriorityCheckbox.props.accessibilityState.checked).toBe('mixed')

        act(() => root.findByProps({ testID: 'auto-reminder-priority-do_later-expand' }).props.onPress())
        expect(root.findAllByProps({ testID: 'auto-reminder-task-project-1:later' })).toHaveLength(0)

        let finishRequest
        const pendingRequest = new Promise(resolve => {
            finishRequest = resolve
        })
        mockAutoReminderMultipleTasks.mockReturnValueOnce(pendingRequest)
        const applyButton = root.findAll(node => node.props.title === 'Apply' && node.props.onPress)[0]
        act(() => applyButton.props.onPress())

        expect(mockAutoReminderMultipleTasks).toHaveBeenCalledWith(
            [expect.objectContaining({ id: 'must-2' }), expect.objectContaining({ id: 'later' })],
            'user-1',
            { background: true }
        )
        expect(closePopover).toHaveBeenCalled()

        await act(async () => {
            finishRequest({ updatedCount: 2 })
            await pendingRequest
        })
    })

    test('shows project context for expanded tasks in All Projects', () => {
        let component
        act(() => {
            component = renderer.create(<AutoReminderTasksModal projectId={null} closePopover={jest.fn()} />)
        })

        const renderedText = component.root
            .findAll(node => typeof node.props.children === 'string')
            .map(node => node.props.children)

        expect(renderedText).toContain('Project One')
        expect(renderedText).toContain('Project Two')
    })
})
