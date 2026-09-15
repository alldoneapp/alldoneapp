/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'
import { useDispatch } from 'react-redux'

import MainTasksView from '../../components/TaskListView/MainTasksView'
import { setNavigationRoute, setSelectedSidebarTab } from '../../redux/actions'
import { DV_TAB_ROOT_TASKS } from '../../utils/TabNavigationConstants'

let mockDeferredStartupWorkReady = true

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
    shallowEqual: jest.fn(),
}))
jest.mock('../../components/HashtagFilters/HashtagFiltersView', () => 'HashtagFiltersView')
jest.mock('../../components/TaskListView/TasksAmountContainers/TasksAmountContainers', () => 'TasksAmountContainers')
jest.mock('../../components/TaskListView/WriteTasksUrl', () => 'WriteTasksUrl')
jest.mock('../../components/TaskListView/TasksSections', () => 'TasksSections')
jest.mock('../../hooks/useDeferredStartupWork', () => ({
    __esModule: true,
    default: () => mockDeferredStartupWorkReady,
}))
jest.mock('../../redux/actions', () => ({
    setNavigationRoute: jest.fn(route => ({ type: 'Set navigation route', route })),
    setSelectedSidebarTab: jest.fn(tab => ({ type: 'Set selected sidebar tab', tab })),
}))

const dispatch = jest.fn()

const renderMainTasksView = () => {
    let tree
    renderer.act(() => {
        tree = renderer.create(<MainTasksView />)
    })
    return tree
}

describe('MainTasksView component', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        useDispatch.mockReturnValue(dispatch)
        mockDeferredStartupWorkReady = true
    })

    it('renders the task sections and their surrounding controls', () => {
        const tree = renderMainTasksView()

        expect(tree.root.findAllByType('WriteTasksUrl')).toHaveLength(1)
        expect(tree.root.findAllByType('TasksAmountContainers')).toHaveLength(1)
        expect(tree.root.findAllByType('HashtagFiltersView')).toHaveLength(1)
        expect(tree.root.findAllByType('TasksSections')).toHaveLength(1)
    })

    it('lets the hashtag filters handle spaces', () => {
        const tree = renderMainTasksView()

        expect(tree.root.findAllByType('HashtagFiltersView')[0].props.handleSpaces).toBe(true)
    })

    it('keeps project-wide counters off the critical task-stream window', () => {
        mockDeferredStartupWorkReady = false
        const tree = renderMainTasksView()

        expect(tree.root.findAllByType('TasksAmountContainers')).toHaveLength(0)
        expect(tree.root.findAllByType('TasksSections')).toHaveLength(1)
    })

    it('selects the tasks tab on mount', () => {
        renderMainTasksView()

        expect(dispatch).toHaveBeenCalledWith([
            setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
            setNavigationRoute(DV_TAB_ROOT_TASKS),
        ])
    })

    it('unmounts without errors', () => {
        const tree = renderMainTasksView()

        expect(() =>
            renderer.act(() => {
                tree.unmount()
            })
        ).not.toThrow()
    })
})
