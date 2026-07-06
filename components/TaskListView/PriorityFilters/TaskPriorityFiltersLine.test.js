/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useSelector, useDispatch } from 'react-redux'

const mockCollectTaskPriorityCounts = jest.fn()

jest.mock('react-redux', () => ({
    useSelector: jest.fn(),
    useDispatch: jest.fn(),
    shallowEqual: (a, b) => a === b,
}))

jest.mock('../../../i18n/TranslationService', () => ({
    translate: text => text,
}))

// windowTagStyle() reads navigator.userAgent via MyPlatform, which jsdom doesn't
// populate — stub it while keeping the real styles/colors.
jest.mock('../../styles/global', () => {
    const actual = jest.requireActual('../../styles/global')
    return {
        __esModule: true,
        ...actual,
        windowTagStyle: () => ({}),
    }
})

jest.mock('./taskPriorityFilterHelper', () => ({
    collectTaskPriorityCounts: (...args) => mockCollectTaskPriorityCounts(...args),
}))

jest.mock('../AutoPostpone/AutoPostponeTasksModal', () => {
    const React = require('react')
    return props => React.createElement('AutoPostponeTasksModal', props)
})

jest.mock('react-tiny-popover', () => {
    const React = require('react')
    return {
        __esModule: true,
        default: ({ children, content }) => React.createElement('Popover', null, children, content),
    }
})

jest.mock('../../ModalsManager/modalsManager', () => ({
    AUTO_POSTPONE_TASKS_MODAL_ID: 'auto-postpone-modal-id',
    storeModal: jest.fn(),
    removeModal: jest.fn(),
}))

jest.mock('../../../redux/actions', () => ({
    setTaskPriorityFilters: priorities => ({ type: 'Set task priority filters', priorities }),
    clearTaskPriorityFilters: () => ({ type: 'Clear task priority filters' }),
    showFloatPopup: () => ({ type: 'Show float popup' }),
    hideFloatPopup: () => ({ type: 'Hide float popup' }),
}))

import TaskPriorityFiltersLine from './TaskPriorityFiltersLine'

const buildState = overrides => ({
    currentUser: { uid: 'user-1' },
    selectedProjectIndex: 0,
    loggedUser: { projectIds: ['project-1'] },
    openTasksStore: {},
    subtaskByTaskStore: {},
    taskPriorityFilters: [],
    smallScreenNavigation: false,
    ...overrides,
})

describe('TaskPriorityFiltersLine', () => {
    let dispatch

    beforeEach(() => {
        jest.clearAllMocks()
        dispatch = jest.fn()
        useDispatch.mockReturnValue(dispatch)
    })

    const setState = overrides => {
        useSelector.mockImplementation(selector => selector(buildState(overrides)))
    }

    test('renders nothing when no visible task has a priority', () => {
        mockCollectTaskPriorityCounts.mockReturnValue({ counts: { none: 3 }, total: 3, prioritized: 0 })
        setState()
        let component
        act(() => {
            component = renderer.create(<TaskPriorityFiltersLine projectId="project-1" />)
        })
        expect(component.toJSON()).toBeNull()
    })

    test('shows chips with counts for used priorities plus All and No priority', () => {
        mockCollectTaskPriorityCounts.mockReturnValue({
            counts: { must_do: 2, do_later: 1, none: 3 },
            total: 6,
            prioritized: 3,
        })
        setState()
        let component
        act(() => {
            component = renderer.create(<TaskPriorityFiltersLine projectId="project-1" />)
        })
        const root = component.root

        expect(root.findByProps({ testID: 'task-priority-filter-all' })).toBeTruthy()
        expect(root.findByProps({ testID: 'task-priority-filter-must_do' })).toBeTruthy()
        expect(root.findByProps({ testID: 'task-priority-filter-do_later' })).toBeTruthy()
        expect(root.findByProps({ testID: 'task-priority-filter-none' })).toBeTruthy()
        expect(root.findAllByProps({ testID: 'task-priority-filter-should_do' })).toHaveLength(0)
        expect(root.findByProps({ testID: 'task-priority-auto-postpone' })).toBeTruthy()
    })

    test('toggling a chip dispatches the multi-select filter update', () => {
        mockCollectTaskPriorityCounts.mockReturnValue({
            counts: { must_do: 2, should_do: 1 },
            total: 3,
            prioritized: 3,
        })
        setState({ taskPriorityFilters: ['must_do'] })
        let component
        act(() => {
            component = renderer.create(<TaskPriorityFiltersLine projectId="project-1" />)
        })
        const root = component.root

        act(() => root.findByProps({ testID: 'task-priority-filter-should_do' }).props.onPress())
        expect(dispatch).toHaveBeenCalledWith({
            type: 'Set task priority filters',
            priorities: ['must_do', 'should_do'],
        })

        act(() => root.findByProps({ testID: 'task-priority-filter-must_do' }).props.onPress())
        expect(dispatch).toHaveBeenCalledWith({ type: 'Set task priority filters', priorities: [] })

        act(() => root.findByProps({ testID: 'task-priority-filter-all' }).props.onPress())
        expect(dispatch).toHaveBeenCalledWith({ type: 'Clear task priority filters' })
    })

    test('opening the auto-postpone popover passes the active filters to the modal', () => {
        mockCollectTaskPriorityCounts.mockReturnValue({
            counts: { do_later: 2 },
            total: 2,
            prioritized: 2,
        })
        setState({ taskPriorityFilters: ['do_later'] })
        let component
        act(() => {
            component = renderer.create(<TaskPriorityFiltersLine projectId="project-1" />)
        })
        const root = component.root

        act(() => root.findByProps({ testID: 'task-priority-auto-postpone' }).props.onPress())
        const modal = root.find(node => node.type === 'AutoPostponeTasksModal')
        expect(modal.props.initialSelectedPriorities).toEqual(['do_later'])
        expect(modal.props.projectId).toBe('project-1')
        expect(dispatch).toHaveBeenCalledWith({ type: 'Show float popup' })
    })
})
