/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Text, View } from 'react-native'
import renderer, { act } from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'
import { removeModal, storeModal } from '../../ModalsManager/modalsManager'

const mockCollectTaskPriorityCounts = jest.fn()
const mockCollectTaskVmSessionRefs = jest.fn()
const mockCollectTaskVmStateCounts = jest.fn()
const mockWatchVmSessionStatus = jest.fn()

jest.mock('react-redux', () => ({
    useSelector: jest.fn(),
    useDispatch: jest.fn(),
    shallowEqual: (a, b) => a === b,
}))
jest.mock('../../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../../styles/global', () => {
    const actual = jest.requireActual('../../styles/global')
    return { __esModule: true, ...actual, windowTagStyle: () => ({}) }
})
jest.mock('./taskPriorityFilterHelper', () => ({
    collectTaskPriorityCounts: (...args) => mockCollectTaskPriorityCounts(...args),
    collectTaskVmSessionRefs: (...args) => mockCollectTaskVmSessionRefs(...args),
    collectTaskVmStateCounts: (...args) => mockCollectTaskVmStateCounts(...args),
}))
jest.mock('../../../utils/backends/Assistants/vmSessionStatus', () => ({
    VM_BADGE_STATE_IN_PROGRESS: 'in_progress',
    VM_BADGE_STATE_PAUSED: 'paused',
    VM_BADGE_STATE_FAILED: 'failed',
    getVmSessionBadgeState: session => session?.badgeState || null,
    watchVmSessionStatus: (...args) => mockWatchVmSessionStatus(...args),
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
    setTaskVmStateFilters: vmStates => ({ type: 'Set task VM state filters', vmStates }),
    clearTaskVmStateFilters: () => ({ type: 'Clear task VM state filters' }),
    updateTaskVmState: (taskKey, vmState) => ({ type: 'Update task VM state', taskKey, vmState }),
    showFloatPopup: () => ({ type: 'Show float popup' }),
    hideFloatPopup: () => ({ type: 'Hide float popup' }),
}))

import TaskFiltersLine from './TaskFiltersLine'

const buildState = overrides => ({
    currentUser: { uid: 'user-1' },
    selectedProjectIndex: 0,
    loggedUser: { projectIds: ['project-1'] },
    openTasksStore: {},
    subtaskByTaskStore: {},
    taskPriorityFilters: [],
    taskVmStateFilters: [],
    taskVmStatesByTask: {},
    smallScreenNavigation: false,
    ...overrides,
})

describe('TaskFiltersLine', () => {
    let dispatch

    beforeEach(() => {
        jest.clearAllMocks()
        dispatch = jest.fn()
        useDispatch.mockReturnValue(dispatch)
        mockCollectTaskPriorityCounts.mockReturnValue({ counts: {}, total: 0, prioritized: 0 })
        mockCollectTaskVmSessionRefs.mockReturnValue([])
        mockCollectTaskVmStateCounts.mockReturnValue({ counts: {}, total: 0, available: 0 })
    })

    const setState = overrides => {
        const state = buildState(overrides)
        useSelector.mockImplementation(selector => selector(state))
    }

    test('renders one control without visible priority or VM-state group headings', () => {
        mockCollectTaskPriorityCounts.mockReturnValue({ counts: { must_do: 2, none: 1 }, total: 3, prioritized: 2 })
        mockCollectTaskVmStateCounts.mockReturnValue({ counts: { paused: 1, failed: 1 }, total: 3, available: 2 })
        setState({ taskPriorityFilters: ['must_do'], taskVmStateFilters: ['paused'] })

        let component
        act(() => {
            component = renderer.create(<TaskFiltersLine projectId="project-1" />)
        })

        expect(component.root.findAll(node => node.type === View && node.props.testID === 'task-filters')).toHaveLength(
            1
        )
        expect(component.root.findByProps({ testID: 'task-filter-priority-group' })).toBeTruthy()
        expect(component.root.findByProps({ testID: 'task-filter-vm-state-group' })).toBeTruthy()
        expect(component.root.findAll(node => node.props.children === 'Priority')).toHaveLength(0)
        expect(component.root.findAll(node => node.props.children === 'VM States')).toHaveLength(0)
    })

    // AT-2264: the header used to carry a badge with the number of selected filters. It read
    // like an item count next to the per-chip counts, so it is gone -- the highlighted chips
    // already say what is selected. The per-chip counts stay: those are item counts.
    test('does not show how many filters are selected', () => {
        mockCollectTaskPriorityCounts.mockReturnValue({ counts: { must_do: 2, none: 1 }, total: 3, prioritized: 2 })
        mockCollectTaskVmStateCounts.mockReturnValue({ counts: { paused: 1, failed: 1 }, total: 3, available: 2 })
        setState({ taskPriorityFilters: ['must_do'], taskVmStateFilters: ['paused'] })

        let component
        act(() => {
            component = renderer.create(<TaskFiltersLine projectId="project-1" />)
        })

        expect(component.root.findAll(node => node.props.testID === 'task-filter-active-count')).toHaveLength(0)
        expect(
            component.root.findByProps({ testID: 'task-priority-filter-must_do' }).findAllByType(Text).slice(-1)[0]
                .props.children
        ).toBe(2)
    })

    test('keeps all available filter options in one horizontally scrollable line', () => {
        mockCollectTaskPriorityCounts.mockReturnValue({
            counts: { must_do: 1, should_do: 1, could_do: 1, do_later: 1, none: 1 },
            total: 5,
            prioritized: 4,
        })
        mockCollectTaskVmStateCounts.mockReturnValue({
            counts: { in_progress: 1, paused: 1, failed: 1 },
            total: 5,
            available: 3,
        })
        setState({ smallScreenNavigation: true })

        let component
        act(() => {
            component = renderer.create(<TaskFiltersLine projectId="project-1" />)
        })

        const horizontalScroll = component.root.find(
            node => node.props.testID === 'task-filters-horizontal-scroll' && node.props.horizontal === true
        )
        expect(horizontalScroll.props.showsHorizontalScrollIndicator).toBe(false)
        expect(horizontalScroll.props.contentContainerStyle).toMatchObject({
            flexDirection: 'row',
            flexWrap: 'nowrap',
        })
        expect(horizontalScroll.findByProps({ testID: 'task-filter-priority-group' })).toBeTruthy()
        expect(horizontalScroll.findByProps({ testID: 'task-filter-vm-state-group' })).toBeTruthy()
        const expectedFilterTestIds = [
            'task-filter-all',
            'task-priority-filter-must_do',
            'task-priority-filter-should_do',
            'task-priority-filter-could_do',
            'task-priority-filter-do_later',
            'task-priority-filter-none',
            'task-vm-state-filter-in_progress',
            'task-vm-state-filter-paused',
            'task-vm-state-filter-failed',
        ]
        expectedFilterTestIds.forEach(testID => expect(horizontalScroll.findByProps({ testID })).toBeTruthy())
    })

    test('multi-selects priority and VM state in the same control and clears both via All', () => {
        mockCollectTaskPriorityCounts.mockReturnValue({
            counts: { must_do: 1, should_do: 1 },
            total: 2,
            prioritized: 2,
        })
        mockCollectTaskVmStateCounts.mockReturnValue({
            counts: { in_progress: 1, paused: 1 },
            total: 2,
            available: 2,
        })
        setState({ taskPriorityFilters: ['must_do'], taskVmStateFilters: ['in_progress'] })

        let component
        act(() => {
            component = renderer.create(<TaskFiltersLine projectId="project-1" />)
        })

        act(() => component.root.findByProps({ testID: 'task-priority-filter-should_do' }).props.onPress())
        expect(dispatch).toHaveBeenCalledWith({
            type: 'Set task priority filters',
            priorities: ['must_do', 'should_do'],
        })
        act(() => component.root.findByProps({ testID: 'task-vm-state-filter-paused' }).props.onPress())
        expect(dispatch).toHaveBeenCalledWith({
            type: 'Set task VM state filters',
            vmStates: ['in_progress', 'paused'],
        })
        act(() => component.root.findByProps({ testID: 'task-filter-all' }).props.onPress())
        expect(dispatch).toHaveBeenCalledWith({ type: 'Clear task priority filters' })
        expect(dispatch).toHaveBeenCalledWith({ type: 'Clear task VM state filters' })
    })

    test('shows only the applicable group when no listed task has a VM state', () => {
        mockCollectTaskPriorityCounts.mockReturnValue({ counts: { do_later: 2 }, total: 2, prioritized: 2 })
        setState()

        let component
        act(() => {
            component = renderer.create(<TaskFiltersLine projectId="project-1" />)
        })

        expect(component.root.findByProps({ testID: 'task-filter-priority-group' })).toBeTruthy()
        expect(component.root.findAllByProps({ testID: 'task-filter-vm-state-group' })).toHaveLength(0)
    })

    test('keeps the unified control available for VM states when there are no prioritized tasks', () => {
        mockCollectTaskPriorityCounts.mockReturnValue({ counts: { none: 2 }, total: 2, prioritized: 0 })
        mockCollectTaskVmStateCounts.mockReturnValue({ counts: { in_progress: 1 }, total: 2, available: 1 })
        setState()

        let component
        act(() => {
            component = renderer.create(<TaskFiltersLine projectId="project-1" />)
        })

        expect(component.root.findAllByProps({ testID: 'task-filter-priority-group' })).toHaveLength(0)
        expect(component.root.findByProps({ testID: 'task-filter-vm-state-group' })).toBeTruthy()
        expect(component.root.findByProps({ testID: 'task-vm-state-filter-in_progress' })).toBeTruthy()
    })

    test('uses the project context for VM sessions and releases its watcher on unmount', () => {
        const unsubscribe = jest.fn()
        const sections = [{ taskWithoutEmbeddedProjectId: true }]
        const subtasksByParentId = { parent: [{ id: 'subtask' }] }
        mockCollectTaskVmSessionRefs.mockReturnValue([
            { key: 'project-1__task-1', projectId: 'project-1', taskId: 'task-1' },
        ])
        mockCollectTaskVmStateCounts.mockReturnValue({ counts: { failed: 1 }, total: 1, available: 1 })
        mockWatchVmSessionStatus.mockImplementation((projectId, taskId, callback) => {
            callback({ badgeState: 'failed' })
            return unsubscribe
        })
        setState({
            openTasksStore: { 'project-1user-1': sections },
            subtaskByTaskStore: { 'project-1user-1': subtasksByParentId },
        })

        let component
        act(() => {
            component = renderer.create(<TaskFiltersLine projectId="project-1" />)
        })

        const instances = [{ projectId: 'project-1', sections, subtasksByParentId }]
        expect(mockCollectTaskVmSessionRefs).toHaveBeenCalledWith(instances)
        expect(mockWatchVmSessionStatus).toHaveBeenCalledWith('project-1', 'task-1', expect.any(Function))
        act(() => component.unmount())
        expect(unsubscribe).toHaveBeenCalledTimes(1)
    })

    test('acquires the Auto-postpone popup once and releases it on unmount', () => {
        mockCollectTaskPriorityCounts.mockReturnValue({ counts: { must_do: 1 }, total: 1, prioritized: 1 })
        setState()
        let component

        act(() => {
            component = renderer.create(<TaskFiltersLine projectId="project-1" />)
        })
        const button = component.root.findByProps({ testID: 'task-filter-auto-postpone' })

        act(() => {
            button.props.onPress()
            button.props.onPress()
        })

        expect(storeModal).toHaveBeenCalledTimes(1)
        expect(dispatch.mock.calls.filter(([action]) => action.type === 'Show float popup')).toHaveLength(1)

        act(() => component.unmount())

        expect(removeModal).toHaveBeenCalledWith('auto-postpone-modal-id')
        expect(dispatch.mock.calls.filter(([action]) => action.type === 'Hide float popup')).toHaveLength(1)
    })

    test('releases Auto-postpone when the filter line disappears while it is open', () => {
        mockCollectTaskPriorityCounts.mockReturnValue({ counts: { must_do: 1 }, total: 1, prioritized: 1 })
        setState()
        let component

        act(() => {
            component = renderer.create(<TaskFiltersLine projectId="project-1" />)
        })
        act(() => component.root.findByProps({ testID: 'task-filter-auto-postpone' }).props.onPress())

        mockCollectTaskPriorityCounts.mockReturnValue({ counts: {}, total: 0, prioritized: 0 })
        setState({ openTasksStore: { refreshed: true } })
        act(() => component.update(<TaskFiltersLine projectId="project-1" />))

        expect(component.toJSON()).toBeNull()
        expect(removeModal).toHaveBeenCalledWith('auto-postpone-modal-id')
        expect(dispatch.mock.calls.filter(([action]) => action.type === 'Hide float popup')).toHaveLength(1)
    })
})
