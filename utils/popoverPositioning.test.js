/**
 * @jest-environment jsdom
 */
import { Dimensions } from 'react-native'

import {
    POPOVER_VIEWPORT_PADDING,
    centerPopoverInViewport,
    centerPopoverInWindow,
    clampToRange,
} from './popoverPositioning'

const PADDING = POPOVER_VIEWPORT_PADDING

describe('clampToRange', () => {
    it('keeps a value inside the range', () => {
        expect(clampToRange(5, 0, 10)).toBe(5)
        expect(clampToRange(-5, 0, 10)).toBe(0)
        expect(clampToRange(50, 0, 10)).toBe(10)
    })

    it('collapses to the minimum when the range is inverted', () => {
        expect(clampToRange(-100, 8, -20)).toBe(8)
    })
})

describe('centerPopoverInViewport', () => {
    it('centres a popover that fits', () => {
        expect(
            centerPopoverInViewport({
                viewportWidth: 1440,
                viewportHeight: 900,
                popoverWidth: 432,
                popoverHeight: 500,
            })
        ).toEqual({ top: 200, left: 504 })
    })

    it('applies the horizontal offset while it still fits', () => {
        const { left } = centerPopoverInViewport({
            viewportWidth: 1440,
            viewportHeight: 900,
            popoverWidth: 432,
            popoverHeight: 500,
            horizontalOffset: 131.5,
        })

        expect(left).toBe(635.5)
    })

    // AT-2189: the swipe postpone popup centred against its own unclamped height
    // and rendered above the top edge of short phone viewports.
    it('never returns a negative top for a popover taller than the viewport', () => {
        const { top } = centerPopoverInViewport({
            viewportWidth: 390,
            viewportHeight: 664,
            popoverWidth: 304,
            popoverHeight: 900,
        })

        expect(top).toBe(PADDING)
    })

    it('never returns a negative left for a popover wider than the viewport', () => {
        const { left } = centerPopoverInViewport({
            viewportWidth: 320,
            viewportHeight: 600,
            popoverWidth: 400,
            popoverHeight: 300,
        })

        expect(left).toBe(PADDING)
    })

    // AT-2189: on a narrow viewport the desktop sidebar compensation used to push
    // the popover past the right edge, where the container's `overflow: hidden`
    // clipped it.
    it('drops a horizontal offset that would push the popover past the right edge', () => {
        const { left } = centerPopoverInViewport({
            viewportWidth: 390,
            viewportHeight: 664,
            popoverWidth: 304,
            popoverHeight: 400,
            horizontalOffset: 131.5,
        })

        expect(left).toBe(390 - 304 - PADDING)
        expect(left + 304).toBeLessThanOrEqual(390)
    })

    it('keeps the whole popover on screen for a range of phone viewports', () => {
        const viewports = [
            [320, 454],
            [360, 560],
            [375, 553],
            [390, 664],
            [414, 715],
        ]
        const popoverHeights = [200, 400, 600, 900]

        viewports.forEach(([viewportWidth, viewportHeight]) => {
            popoverHeights.forEach(popoverHeight => {
                const popoverWidth = 304
                const { top, left } = centerPopoverInViewport({
                    viewportWidth,
                    viewportHeight,
                    popoverWidth,
                    popoverHeight,
                })

                expect(top).toBeGreaterThanOrEqual(0)
                expect(left).toBeGreaterThanOrEqual(0)
                // The top-left corner is always visible, so the modal header and
                // its close button can always be reached.
                expect(top).toBeLessThan(viewportHeight)
                expect(left).toBeLessThan(viewportWidth)
            })
        })
    })

    // AT-2339: ~10 call sites pass disableReposition, which skips the library's
    // own safe-area nudge — for those this clamp is the only protection.
    describe('safe-area insets', () => {
        const IPHONE = { top: 47, right: 0, bottom: 34, left: 0 }
        const IPHONE_LANDSCAPE = { top: 0, right: 0, bottom: 21, left: 59 }

        it('keeps an oversized popover below the Dynamic Island', () => {
            const { top } = centerPopoverInViewport({
                viewportWidth: 390,
                viewportHeight: 844,
                popoverWidth: 304,
                popoverHeight: 1200,
                insets: IPHONE,
            })

            expect(top).toBe(47 + PADDING)
        })

        it('centres within the safe rectangle, not the hardware one', () => {
            const { top } = centerPopoverInViewport({
                viewportWidth: 390,
                viewportHeight: 844,
                popoverWidth: 304,
                popoverHeight: 400,
                insets: IPHONE,
            })

            // Safe band is 47..810, so its centre is 428.5 and the card starts
            // 200 above that — visually centred between the system bars.
            expect(top).toBe(228.5)
            expect(top).toBeGreaterThanOrEqual(47)
            expect(top + 400).toBeLessThanOrEqual(844 - 34)
        })

        it('keeps a wide popover clear of the landscape cutout', () => {
            const { left } = centerPopoverInViewport({
                viewportWidth: 844,
                viewportHeight: 390,
                popoverWidth: 900,
                popoverHeight: 200,
                insets: IPHONE_LANDSCAPE,
            })

            expect(left).toBe(59 + PADDING)
        })

        it('is identical to the pre-AT-2339 result when the insets are zero', () => {
            const zero = { top: 0, right: 0, bottom: 0, left: 0 }
            const args = { viewportWidth: 1440, viewportHeight: 900, popoverWidth: 432, popoverHeight: 500 }

            expect(centerPopoverInViewport({ ...args, insets: zero })).toEqual(centerPopoverInViewport(args))
            expect(centerPopoverInViewport({ ...args, insets: zero })).toEqual({ top: 200, left: 504 })
        })
    })

    it('treats a missing popover size as zero instead of producing NaN', () => {
        expect(centerPopoverInViewport({ viewportWidth: 400, viewportHeight: 600 })).toEqual({ top: 300, left: 200 })
    })
})

describe('centerPopoverInWindow', () => {
    const setViewport = (width, height) => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
        Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width })
        Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: height })
        window.dispatchEvent(new Event('resize'))
    }

    it('measures against the live window dimensions', () => {
        setViewport(390, 664)
        expect(Dimensions.get('window').height).toBe(664)

        expect(centerPopoverInWindow({ popoverRect: { width: 304, height: 400 } })).toEqual({ top: 132, left: 43 })
    })

    it('clamps an oversized popover to the viewport padding', () => {
        setViewport(390, 664)

        expect(centerPopoverInWindow({ popoverRect: { width: 304, height: 900 } })).toEqual({
            top: PADDING,
            left: 43,
        })
    })

    it('tolerates being called without positioning data', () => {
        setViewport(1440, 900)

        expect(centerPopoverInWindow()).toEqual({ top: 450, left: 720 })
    })
})
