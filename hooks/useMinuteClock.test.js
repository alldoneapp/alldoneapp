import React from 'react'
import renderer, { act } from 'react-test-renderer'

import useMinuteClock, { msUntilNextMinute } from './useMinuteClock'

const mockSubscribers = new Set()
jest.mock('../utils/appResume', () => ({
    subscribePageVisible: callback => {
        mockSubscribers.add(callback)
        return () => mockSubscribers.delete(callback)
    },
}))

const START = new Date(2026, 10, 23, 14, 5, 40, 0).getTime()

let latest
let renders
function Probe() {
    latest = useMinuteClock()
    renders += 1
    return null
}

describe('useMinuteClock', () => {
    let tree
    beforeEach(() => {
        jest.useFakeTimers({ now: START })
        mockSubscribers.clear()
        renders = 0
        act(() => {
            tree = renderer.create(<Probe />)
        })
    })
    afterEach(() => {
        if (tree) act(() => tree.unmount())
        tree = null
        jest.useRealTimers()
    })

    it('waits until just after the next full minute', () => {
        expect(msUntilNextMinute(START)).toBe(20 * 1000 + 250)
        expect(msUntilNextMinute(new Date(2026, 10, 23, 14, 6, 0, 0).getTime())).toBe(60 * 1000 + 250)
    })

    it('ticks at every minute boundary, aligned to the wall clock', () => {
        expect(latest).toBe(START)
        const rendersBefore = renders
        act(() => jest.advanceTimersByTime(20 * 1000 + 249))
        expect(latest).toBe(START)
        act(() => jest.advanceTimersByTime(1))
        expect(new Date(latest).getMinutes()).toBe(6)
        act(() => jest.advanceTimersByTime(60 * 1000))
        expect(new Date(latest).getMinutes()).toBe(7)
        act(() => jest.advanceTimersByTime(60 * 1000))
        expect(new Date(latest).getMinutes()).toBe(8)
        // One render per minute, nothing in between.
        expect(renders - rendersBefore).toBe(3)
        expect(jest.getTimerCount()).toBe(1)
    })

    it('re-reads the clock when the page is visible again and re-aligns its timer', () => {
        jest.setSystemTime(START + 3 * 60 * 60 * 1000 + 10 * 1000) // 17:05:50, timers were frozen
        act(() => mockSubscribers.forEach(callback => callback({ hiddenMs: 3 * 60 * 60 * 1000 })))
        expect(new Date(latest).getHours()).toBe(17)
        expect(jest.getTimerCount()).toBe(1)
        act(() => jest.advanceTimersByTime(10 * 1000 + 250))
        expect(new Date(latest).getMinutes()).toBe(6)
    })

    it('leaves no timer and no subscription behind on unmount', () => {
        expect(jest.getTimerCount()).toBe(1)
        expect(mockSubscribers.size).toBe(1)
        act(() => tree.unmount())
        tree = null
        expect(jest.getTimerCount()).toBe(0)
        expect(mockSubscribers.size).toBe(0)
    })
})
