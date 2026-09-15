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
jest.mock('./FloatingAddTaskButton', () => 'FloatingAddTaskButton')

describe('MainTasksView (AT-2575)', () => {
    it('owns exactly one floating add-task action alongside every board section', () => {
        const tree = renderer.create(<MainTasksView />)

        expect(tree.root.findAllByType('TasksSections')).toHaveLength(1)
        expect(tree.root.findAllByType('FloatingAddTaskButton')).toHaveLength(1)
    })
})
