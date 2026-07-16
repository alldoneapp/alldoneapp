/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'

const mockCollectTaskVmSessionRefs = jest.fn()
const mockCollectTaskVmStateCounts = jest.fn()
const mockWatchVmSessionStatus = jest.fn()

jest.mock('react-redux', () => ({
    useSelector: jest.fn(),
    useDispatch: jest.fn(),
    shallowEqual: (a, b) => a === b,
}))

jest.mock('../../../i18n/TranslationService', () => ({
    translate: text => text,
}))

jest.mock('./taskPriorityFilterHelper', () => ({
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

jest.mock('../../../redux/actions', () => ({
    clearTaskVmStateFilters: () => ({ type: 'Clear task VM state filters' }),
    setTaskVmStateFilters: vmStates => ({ type: 'Set task VM state filters', vmStates }),
    updateTaskVmState: (taskKey, vmState) => ({ type: 'Update task VM state', taskKey, vmState }),
}))

import TaskVmStateFiltersLine from './TaskVmStateFiltersLine'

const buildState = overrides => ({
    currentUser: { uid: 'user-1' },
    selectedProjectIndex: 0,
    loggedUser: { projectIds: ['project-1'] },
    openTasksStore: {},
    subtaskByTaskStore: {},
    taskVmStateFilters: [],
    taskVmStatesByTask: {},
    ...overrides,
})

describe('TaskVmStateFiltersLine', () => {
    let dispatch

    beforeEach(() => {
        jest.clearAllMocks()
        dispatch = jest.fn()
        useDispatch.mockReturnValue(dispatch)
        mockCollectTaskVmSessionRefs.mockReturnValue([])
    })

    const setState = overrides => {
        const state = buildState(overrides)
        useSelector.mockImplementation(selector => selector(state))
    }

    test('renders nothing when no listed task has a VM state', () => {
        mockCollectTaskVmStateCounts.mockReturnValue({ counts: {}, total: 3, available: 0 })
        setState()
        let component
        act(() => {
            component = renderer.create(<TaskVmStateFiltersLine projectId="project-1" />)
        })
        expect(component.toJSON()).toBeNull()
    })

    test('shows only available states plus All', () => {
        mockCollectTaskVmStateCounts.mockReturnValue({
            counts: { in_progress: 2, failed: 1 },
            total: 6,
            available: 3,
        })
        setState()
        let component
        act(() => {
            component = renderer.create(<TaskVmStateFiltersLine projectId="project-1" />)
        })
        const root = component.root

        expect(root.findByProps({ testID: 'task-vm-state-filter-all' })).toBeTruthy()
        expect(root.findByProps({ testID: 'task-vm-state-filter-in_progress' })).toBeTruthy()
        expect(root.findByProps({ testID: 'task-vm-state-filter-failed' })).toBeTruthy()
        expect(root.findAllByProps({ testID: 'task-vm-state-filter-paused' })).toHaveLength(0)
    })

    test('toggles multiple VM states and clears via All', () => {
        mockCollectTaskVmStateCounts.mockReturnValue({
            counts: { in_progress: 2, paused: 1 },
            total: 3,
            available: 3,
        })
        setState({ taskVmStateFilters: ['in_progress'] })
        let component
        act(() => {
            component = renderer.create(<TaskVmStateFiltersLine projectId="project-1" />)
        })
        const root = component.root

        act(() => root.findByProps({ testID: 'task-vm-state-filter-paused' }).props.onPress())
        expect(dispatch).toHaveBeenCalledWith({
            type: 'Set task VM state filters',
            vmStates: ['in_progress', 'paused'],
        })

        act(() => root.findByProps({ testID: 'task-vm-state-filter-in_progress' }).props.onPress())
        expect(dispatch).toHaveBeenCalledWith({ type: 'Set task VM state filters', vmStates: [] })

        act(() => root.findByProps({ testID: 'task-vm-state-filter-all' }).props.onPress())
        expect(dispatch).toHaveBeenCalledWith({ type: 'Clear task VM state filters' })
    })

    test('watches listed task sessions and removes their state on unmount', () => {
        const unsubscribe = jest.fn()
        mockCollectTaskVmSessionRefs.mockReturnValue([
            { key: 'project-1__task-1', projectId: 'project-1', taskId: 'task-1' },
        ])
        mockCollectTaskVmStateCounts.mockReturnValue({ counts: {}, total: 1, available: 0 })
        mockWatchVmSessionStatus.mockImplementation((projectId, taskId, callback) => {
            callback({ badgeState: 'failed' })
            return unsubscribe
        })
        setState()
        let component
        act(() => {
            component = renderer.create(<TaskVmStateFiltersLine projectId="project-1" />)
        })

        expect(mockWatchVmSessionStatus).toHaveBeenCalledWith('project-1', 'task-1', expect.any(Function))
        expect(dispatch).toHaveBeenCalledWith({
            type: 'Update task VM state',
            taskKey: 'project-1__task-1',
            vmState: 'failed',
        })

        act(() => component.unmount())
        expect(unsubscribe).toHaveBeenCalledTimes(1)
        expect(dispatch).toHaveBeenCalledWith({
            type: 'Update task VM state',
            taskKey: 'project-1__task-1',
            vmState: null,
        })
    })
})
