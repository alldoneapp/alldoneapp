/**
 * @jest-environment jsdom
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'

import useWindowSize from './useWindowSize'

const setViewport = (width, height) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}

const renders = []

function Probe() {
    const size = useWindowSize()
    renders.push(size)
    return null
}

describe('useWindowSize', () => {
    beforeEach(() => {
        renders.length = 0
    })

    // AT-2189: modals cap themselves with `maxHeight: windowSize[1] - GAP`.
    // With the old [0, 0] seed the first render resolved that to a negative
    // (therefore ignored) max-height, so the modal was laid out at its full
    // natural height — and react-tiny-popover measures exactly then.
    it('reports the real viewport on the very first render', () => {
        setViewport(390, 664)

        let tree
        act(() => {
            tree = renderer.create(<Probe />)
        })

        expect(renders[0]).toEqual([390, 664])

        act(() => {
            tree.unmount()
        })
    })

    it('keeps tracking resizes', () => {
        setViewport(390, 664)

        let tree
        act(() => {
            tree = renderer.create(<Probe />)
        })

        act(() => {
            setViewport(800, 600)
            window.dispatchEvent(new Event('resize'))
        })

        expect(renders[renders.length - 1]).toEqual([800, 600])

        act(() => {
            tree.unmount()
        })
    })
})
