import React from 'react'
import renderer from 'react-test-renderer'

import MainTasksView from './MainTasksView'

const mockDispatch = jest.fn()

jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch }))
jest.mock('../../hooks/useDeferredStartupWork', () => () => true)
jest.mock('./WriteTasksUrl', () => 'WriteTasksUrl')
jest.mock('./TasksAmountContainers/TasksAmountContainers', () => 'TasksAmountContainers')
jest.mock('../HashtagFilters/HashtagFiltersView', () => 'HashtagFiltersView')
jest.mock('./TasksSections', () => 'TasksSections')
describe('MainTasksView (AT-2575)', () => {
    it('renders the task-board content inside the shared viewport scroller', () => {
        const tree = renderer.create(<MainTasksView />)

        expect(tree.root.findAllByType('TasksSections')).toHaveLength(1)
    })
})
