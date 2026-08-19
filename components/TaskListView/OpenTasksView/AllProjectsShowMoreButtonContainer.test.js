import React from 'react'
import renderer, { act } from 'react-test-renderer'

import AllProjectsShowMoreButtonContainer from './AllProjectsShowMoreButtonContainer'
import { watchOpenTasks } from '../../../utils/backends/openTasks'

let mockState

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector(mockState),
}))
jest.mock('../../UIControls/ShowMoreButton', () => 'ShowMoreButton')
jest.mock('../TaskListSkeleton', () => 'TaskListSkeleton')
jest.mock('../../../utils/backends/openTasks', () => ({
    contractOpenTasks: jest.fn(),
    updateOpTasks: jest.fn(),
    watchOpenTasks: jest.fn(),
}))
jest.mock('../../../redux/store', () => ({ getState: jest.fn() }))

describe('AllProjectsShowMoreButtonContainer loading ghost', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockState = {
            loggedUser: { uid: 'user-1' },
            laterTasksExpandState: 0,
            openTasksShowMoreData: {
                hasTomorrowTasks: true,
                hasFutureTasks: false,
                hasSomedayTasks: false,
            },
        }
    })

    it('shows one shared row until every project has resolved', () => {
        let tree
        act(() => {
            tree = renderer.create(
                <AllProjectsShowMoreButtonContainer
                    projectIds={['project-1', 'project-2']}
                    setProjectsHaveTasksInFirstDay={jest.fn()}
                />
            )
        })

        act(() => {
            tree.root.findByType('ShowMoreButton').props.expand()
        })
        expect(tree.root.findByType('TaskListSkeleton').props.rowCount).toBe(1)

        act(() => {
            watchOpenTasks.mock.calls[0][1]([['0']], true)
        })
        expect(tree.root.findAllByType('TaskListSkeleton')).toHaveLength(1)

        act(() => {
            watchOpenTasks.mock.calls[1][1]([['0']], true)
        })
        expect(tree.root.findAllByType('TaskListSkeleton')).toHaveLength(0)
    })
})
