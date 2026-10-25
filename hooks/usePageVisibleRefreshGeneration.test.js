import React, { useEffect } from 'react'
import renderer, { act } from 'react-test-renderer'

import usePageVisibleRefreshGeneration, { PAGE_VISIBLE_REFRESH_AFTER_MS } from './usePageVisibleRefreshGeneration'

const mockSubscribePageVisible = jest.fn()
let mockPageVisibleCallback

jest.mock('../utils/appResume', () => ({
    RESUME_INTEGRITY_MS: 5 * 60 * 1000,
    subscribePageVisible: callback => {
        mockPageVisibleCallback = callback
        return mockSubscribePageVisible(callback)
    },
}))

function Harness({ enabled = true, onGeneration }) {
    const generation = usePageVisibleRefreshGeneration({ enabled })

    useEffect(() => onGeneration(generation), [generation, onGeneration])
    return null
}

describe('usePageVisibleRefreshGeneration', () => {
    let clock
    let nowSpy
    let unsubscribe

    beforeEach(() => {
        clock = 1000
        nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock)
        unsubscribe = jest.fn()
        mockPageVisibleCallback = null
        mockSubscribePageVisible.mockReset().mockReturnValue(unsubscribe)
    })

    afterEach(() => nowSpy.mockRestore())

    it('requests one refresh after a long gap and coalesces duplicate return signals', () => {
        const onGeneration = jest.fn()
        let tree

        act(() => {
            tree = renderer.create(<Harness onGeneration={onGeneration} />)
        })
        expect(onGeneration).toHaveBeenLastCalledWith(0)

        clock += PAGE_VISIBLE_REFRESH_AFTER_MS
        act(() => mockPageVisibleCallback())
        expect(onGeneration).toHaveBeenLastCalledWith(1)

        // Android commonly emits visibilitychange, pageshow and focus together. The first signal
        // consumes the gap, so the remaining signals must not rebuild the watchers again.
        act(() => mockPageVisibleCallback())
        expect(onGeneration).toHaveBeenCalledTimes(2)

        act(() => tree.unmount())
        expect(unsubscribe).toHaveBeenCalledTimes(1)
    })

    it('does not refresh for a short absence or while disabled', () => {
        const onGeneration = jest.fn()
        let tree

        act(() => {
            tree = renderer.create(<Harness enabled={false} onGeneration={onGeneration} />)
        })

        clock += PAGE_VISIBLE_REFRESH_AFTER_MS * 2
        act(() => mockPageVisibleCallback())
        expect(onGeneration).toHaveBeenLastCalledWith(0)

        act(() => {
            tree.update(<Harness onGeneration={onGeneration} />)
        })
        clock += PAGE_VISIBLE_REFRESH_AFTER_MS - 1
        act(() => mockPageVisibleCallback())
        expect(onGeneration).toHaveBeenLastCalledWith(0)

        act(() => tree.unmount())
    })

    it('uses the measured hidden duration instead of time spent actively using the page', () => {
        const onGeneration = jest.fn()
        let tree

        act(() => {
            tree = renderer.create(<Harness onGeneration={onGeneration} />)
        })

        // The user worked in the visible app for a long time and only switched away briefly.
        // The long wall-clock gap must not be mistaken for a long suspension.
        clock += PAGE_VISIBLE_REFRESH_AFTER_MS * 2
        act(() => mockPageVisibleCallback({ hiddenMs: 5000 }))
        expect(onGeneration).toHaveBeenLastCalledWith(0)

        // Conversely, the lifecycle owner's measured absence is authoritative even if this hook
        // subscribed shortly before the return signal.
        act(() => mockPageVisibleCallback({ hiddenMs: PAGE_VISIBLE_REFRESH_AFTER_MS }))
        expect(onGeneration).toHaveBeenLastCalledWith(1)

        act(() => tree.unmount())
    })
})
