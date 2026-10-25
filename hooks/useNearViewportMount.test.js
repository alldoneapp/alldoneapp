/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import useNearViewportMount, { NEAR_VIEWPORT_ROOT_MARGIN } from './useNearViewportMount'

function Harness({ eager = false, enabled = true, trackVisibility = false, activateWhenPassed = false }) {
    const { placeholderRef, shouldMount, hasPassedViewport } = useNearViewportMount({
        eager,
        enabled,
        trackVisibility,
        activateWhenPassed,
    })
    return (
        <div ref={placeholderRef} data-passed={hasPassedViewport}>
            {shouldMount ? 'mounted' : 'placeholder'}
        </div>
    )
}

describe('useNearViewportMount', () => {
    const observedNode = {}
    let intersectionCallback
    let disconnect

    beforeEach(() => {
        disconnect = jest.fn()
        global.IntersectionObserver = jest.fn((callback, options) => {
            intersectionCallback = callback
            return { observe: jest.fn(), disconnect, options }
        })
    })

    afterEach(() => {
        delete global.IntersectionObserver
    })

    it('mounts the eager project immediately', () => {
        const tree = renderer.create(<Harness eager />, { createNodeMock: () => observedNode })
        expect(tree.toJSON().children).toEqual(['mounted'])
        expect(global.IntersectionObserver).not.toHaveBeenCalled()
    })

    it('keeps an offscreen project dormant until it nears the viewport', () => {
        let tree
        act(() => {
            tree = renderer.create(<Harness />, { createNodeMock: () => observedNode })
        })

        expect(tree.toJSON().children).toEqual(['placeholder'])
        expect(global.IntersectionObserver).toHaveBeenCalledWith(expect.any(Function), {
            rootMargin: NEAR_VIEWPORT_ROOT_MARGIN,
        })

        act(() => intersectionCallback([{ isIntersecting: true }]))

        expect(tree.toJSON().children).toEqual(['mounted'])
        expect(disconnect).toHaveBeenCalled()
    })

    it('does not create an observer until the central queue selects the block', () => {
        let tree
        act(() => {
            tree = renderer.create(<Harness enabled={false} />, { createNodeMock: () => observedNode })
        })

        expect(tree.toJSON().children).toEqual(['placeholder'])
        expect(global.IntersectionObserver).not.toHaveBeenCalled()

        act(() => tree.update(<Harness enabled />))
        expect(global.IntersectionObserver).toHaveBeenCalledTimes(1)
    })

    it('can revoke a transient intersection when layout pushes the placeholder away', () => {
        let tree
        act(() => {
            tree = renderer.create(<Harness trackVisibility />, { createNodeMock: () => observedNode })
        })

        act(() => intersectionCallback([{ isIntersecting: true }]))
        expect(tree.toJSON().children).toEqual(['mounted'])

        act(() => intersectionCallback([{ isIntersecting: false }]))
        expect(tree.toJSON().children).toEqual(['placeholder'])
    })

    it('activates a sentinel that a fast scroll moved completely above the viewport', () => {
        observedNode.getBoundingClientRect = jest.fn(() => ({ bottom: 200 }))
        let tree
        act(() => {
            tree = renderer.create(<Harness trackVisibility activateWhenPassed />, {
                createNodeMock: () => observedNode,
            })
        })

        expect(tree.toJSON().children).toEqual(['placeholder'])

        observedNode.getBoundingClientRect.mockReturnValue({ bottom: -20 })
        const scrollContainer = document.createElement('div')
        document.body.appendChild(scrollContainer)
        act(() => scrollContainer.dispatchEvent(new Event('scroll')))

        expect(tree.toJSON().children).toEqual(['mounted'])
        expect(tree.toJSON().props['data-passed']).toBe(true)
        scrollContainer.remove()
    })
})
