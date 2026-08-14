import React from 'react'
import renderer, { act } from 'react-test-renderer'

import useResetDetailedViewScroll from './useResetDetailedViewScroll'
import { resetDetailedViewScroll } from '../utils/scrollUtils'

jest.mock('../utils/scrollUtils', () => ({
    resetDetailedViewScroll: jest.fn(),
}))

const Harness = ({ selectedTab, scrollRef }) => {
    useResetDetailedViewScroll(selectedTab, scrollRef)
    return null
}

describe('useResetDetailedViewScroll', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        jest.clearAllMocks()
    })

    afterEach(() => {
        jest.runOnlyPendingTimers()
        jest.useRealTimers()
    })

    it('resets immediately and after layout when the DV tab changes', () => {
        const scrollRef = { current: { scrollTo: jest.fn() } }
        let tree

        act(() => {
            tree = renderer.create(<Harness selectedTab="chat" scrollRef={scrollRef} />)
        })
        expect(resetDetailedViewScroll).toHaveBeenCalledTimes(1)

        act(() => jest.runOnlyPendingTimers())
        expect(resetDetailedViewScroll).toHaveBeenCalledTimes(2)

        act(() => {
            tree.update(<Harness selectedTab="properties" scrollRef={scrollRef} />)
        })
        expect(resetDetailedViewScroll).toHaveBeenCalledTimes(3)

        act(() => jest.runOnlyPendingTimers())
        expect(resetDetailedViewScroll).toHaveBeenCalledTimes(4)

        act(() => tree.unmount())
    })
})
