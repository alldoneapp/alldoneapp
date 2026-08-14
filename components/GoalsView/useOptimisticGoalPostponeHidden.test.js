/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'

import useOptimisticGoalPostponeHidden from './useOptimisticGoalPostponeHidden'
import { OPTIMISTIC_GOAL_POSTPONE_TTL_MS } from '../../utils/backends/Goals/optimisticGoalPostpone'

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
}))

const mockDispatch = jest.fn()

// Probe: renders the boolean the hook returns, so "hidden" is observable.
function Probe({ projectId, goalId }) {
    const hidden = useOptimisticGoalPostponeHidden(projectId, goalId)
    return <Text>{hidden ? 'hidden' : 'visible'}</Text>
}

const renderProbe = (optimisticGoalPostpones, props = { projectId: 'p1', goalId: 'g1' }) => {
    useSelector.mockImplementation(selector => selector({ optimisticGoalPostpones }))
    let component
    act(() => {
        component = renderer.create(<Probe {...props} />)
    })
    return component
}

const renderedText = component => component.root.findByType(Text).props.children

// AT-2160
describe('useOptimisticGoalPostponeHidden', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        jest.useFakeTimers()
        useDispatch.mockReturnValue(mockDispatch)
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('reports visible when nothing is in flight', () => {
        expect(renderedText(renderProbe({}))).toBe('visible')
        expect(mockDispatch).not.toHaveBeenCalled()
    })

    it('hides the goal while its postpone is in flight', () => {
        const component = renderProbe({ p1_g1: { date: 1, startedAt: Date.now() } })
        expect(renderedText(component)).toBe('hidden')
    })

    it('only hides the goal the entry belongs to', () => {
        const postpones = { p1_g1: { date: 1, startedAt: Date.now() } }
        expect(renderedText(renderProbe(postpones, { projectId: 'p1', goalId: 'g2' }))).toBe('visible')
        expect(renderedText(renderProbe(postpones, { projectId: 'p2', goalId: 'g1' }))).toBe('visible')
    })

    it('brings the goal back and drops the dead entry once the TTL expires', () => {
        const component = renderProbe({ p1_g1: { date: 1, startedAt: Date.now() } })
        expect(renderedText(component)).toBe('hidden')

        // Nothing re-renders just because a timestamp got old — the hook's timer is what
        // guarantees a goal cannot stay invisible after a request that never came back.
        useSelector.mockImplementation(selector => selector({ optimisticGoalPostpones: {} }))
        act(() => {
            jest.advanceTimersByTime(OPTIMISTIC_GOAL_POSTPONE_TTL_MS)
        })

        expect(mockDispatch).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'Clear optimistic goal postpone', projectId: 'p1', goalId: 'g1' })
        )
        expect(renderedText(component)).toBe('visible')
    })

    it('does not arm a timer when there is nothing pending', () => {
        renderProbe({})
        act(() => {
            jest.advanceTimersByTime(OPTIMISTIC_GOAL_POSTPONE_TTL_MS * 2)
        })
        expect(mockDispatch).not.toHaveBeenCalled()
    })

    it('treats an already-expired entry as visible', () => {
        const component = renderProbe({
            p1_g1: { date: 1, startedAt: Date.now() - OPTIMISTIC_GOAL_POSTPONE_TTL_MS - 1 },
        })
        expect(renderedText(component)).toBe('visible')
    })
})
