import React from 'react'
import renderer, { act } from 'react-test-renderer'

import AllProjectsShowMoreAvailability, {
    SHOW_MORE_CHECK_INITIAL_DELAY_MS,
    SHOW_MORE_CHECK_STAGGER_MS,
} from './AllProjectsShowMoreAvailability'

let mockState

jest.mock('react-redux', () => ({
    useSelector: jest.fn(selector => selector(mockState)),
}))
jest.mock('./NeedShowMoreOpenTasksButton', () => 'NeedShowMoreOpenTasksButton')

describe('AllProjectsShowMoreAvailability', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        mockState = { isLoadingData: 1 }
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('waits for visible tasks, then staggers one-shot checks for every project', () => {
        let tree
        act(() => {
            tree = renderer.create(<AllProjectsShowMoreAvailability projectIds={['p1', 'p2']} />)
        })

        act(() => jest.advanceTimersByTime(SHOW_MORE_CHECK_INITIAL_DELAY_MS * 2))
        expect(tree.root.findAllByType('NeedShowMoreOpenTasksButton')).toHaveLength(0)

        mockState = { isLoadingData: 0 }
        act(() => tree.update(<AllProjectsShowMoreAvailability projectIds={['p1', 'p2']} />))

        act(() => jest.advanceTimersByTime(SHOW_MORE_CHECK_INITIAL_DELAY_MS))
        let checks = tree.root.findAllByType('NeedShowMoreOpenTasksButton')
        expect(checks).toHaveLength(1)
        expect(checks[0].props).toEqual({ projectId: 'p1', live: false })

        act(() => jest.advanceTimersByTime(SHOW_MORE_CHECK_STAGGER_MS))
        checks = tree.root.findAllByType('NeedShowMoreOpenTasksButton')
        expect(checks).toHaveLength(2)
        expect(checks[1].props).toEqual({ projectId: 'p2', live: false })
    })
})
