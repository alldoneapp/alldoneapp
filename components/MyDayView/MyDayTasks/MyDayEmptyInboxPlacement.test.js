import React from 'react'
import renderer from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'

import MyDayOpenTasks from './MyDayOpenTasks/MyDayOpenTasks'
import MyDayDoneTasks from './MyDayDoneTasks/MyDayDoneTasks'
import MyDayWorkflowTasks from './MyDayWorkflowTasks/MyDayWorkflowTasks'

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
}))
jest.mock('@hello-pangea/dnd', () => ({ DragDropContext: 'DragDropContext' }))
jest.mock('../../TaskListView/OpenTasksView/AllProjectsEmptyInbox', () => 'AllProjectsEmptyInbox')
jest.mock('../../TaskListView/Header/AllProjectsLine/AllProjectsLine', () => 'AllProjectsLine')
jest.mock('../AssistantLine/AllProjectsAssistantLine', () => 'AllProjectsAssistantLine')
jest.mock('./MyDayOpenTasks/MyDaySelectedTasks', () => 'MyDaySelectedTasks')
jest.mock('./MyDayOpenTasks/MoreTasksLine', () => 'MoreTasksLine')
jest.mock('./MyDayOpenTasks/MyDayOtherTasks', () => 'MyDayOtherTasks')
jest.mock('./MyDayDoneTasks/MyDayDoneTasksList', () => 'MyDayDoneTasksList')
jest.mock('./MyDayWorkflowTasks/MyDayWorkflowTasksList', () => 'MyDayWorkflowTasksList')
jest.mock('../../DragSystem/MyDayDragHelper', () => ({ onBeforeCapture: jest.fn(), onDragEnd: jest.fn() }))
jest.mock('../../../redux/actions', () => ({
    setActiveDragTaskModeInMyDay: jest.fn(active => ({ type: 'Set active drag task mode in my day', active })),
}))

const EMPTY_STATE = {
    myDaySelectedTasks: [],
    myDayOtherTasks: [],
    myDayDoneTasks: [],
    myDayWorkflowTasks: [],
    myDaySortingOtherTasks: [],
    myDayShowAllTasks: false,
    activeDragTaskModeInMyDay: false,
    myDayAllTodayTasks: { loaded: true },
    myDayDoneTasksByProject: { loaded: true },
    myDayWorkflowTasksByProject: { loaded: true },
}

const FILLED_STATE = {
    ...EMPTY_STATE,
    myDaySelectedTasks: [{ id: 'task-1' }],
    myDayDoneTasks: [{ id: 'task-1' }],
    myDayWorkflowTasks: [{ id: 'task-1' }],
}

const renderChildTypes = (Component, state) => {
    useSelector.mockImplementation(selector => selector(state))
    const tree = renderer.create(<Component />)
    // Each view renders a fragment, so read the order off the AllProjectsLine's parent.
    return tree.root.findByType('AllProjectsLine').parent.children.map(child => child.type)
}

describe.each([
    ['MyDayOpenTasks', MyDayOpenTasks],
    ['MyDayDoneTasks', MyDayDoneTasks],
    ['MyDayWorkflowTasks', MyDayWorkflowTasks],
])('%s empty-inbox placement', (name, Component) => {
    beforeEach(() => {
        jest.clearAllMocks()
        useDispatch.mockReturnValue(jest.fn())
    })

    it('AT-2262: renders the congrats directly below the assistant line, never above it', () => {
        const childTypes = renderChildTypes(Component, EMPTY_STATE)

        // Assistant line (incl. the latest comment) stays at the top, under the All
        // Projects line; the congrats follows immediately after it.
        expect(childTypes.indexOf('AllProjectsAssistantLine')).toBe(childTypes.indexOf('AllProjectsLine') + 1)
        expect(childTypes.indexOf('AllProjectsEmptyInbox')).toBe(childTypes.indexOf('AllProjectsAssistantLine') + 1)
        expect(childTypes.indexOf('AllProjectsEmptyInbox')).toBeGreaterThan(childTypes.indexOf('AllProjectsLine'))
    })

    it('keeps the assistant composer mounted and hides the congrats when there are tasks', () => {
        const childTypes = renderChildTypes(Component, FILLED_STATE)

        expect(childTypes).not.toContain('AllProjectsEmptyInbox')
        expect(childTypes).toContain('AllProjectsAssistantLine')
    })

    it('waits for the tasks to load before congratulating', () => {
        const notLoaded = {
            ...EMPTY_STATE,
            myDayAllTodayTasks: { loaded: false },
            myDayDoneTasksByProject: { loaded: false },
            myDayWorkflowTasksByProject: { loaded: false },
        }

        expect(renderChildTypes(Component, notLoaded)).not.toContain('AllProjectsEmptyInbox')
    })
})
