/** @jest-environment jsdom */

import {
    MODAL_SAFE_AREA_GAP,
    computeSafeAreaModalMaxHeight,
    computeSafeAreaModalMaxHeightBelow,
    computeSafeAreaModalMaxWidth,
    computeSafeAreaOverlayPadding,
    getSafeAreaEdgeOffsets,
    getSafeAreaModalMaxHeight,
    getSafeAreaModalMaxHeightBelow,
    getSafeAreaModalMaxWidth,
    getSafeAreaOverlayPadding,
} from './modalSafeArea'

// iPhone 14 Pro portrait: 47px Dynamic Island, 34px home indicator.
const IPHONE_INSETS = { top: 47, right: 0, bottom: 34, left: 0 }
// The same device rotated: the cutout moves to one side, the top inset goes.
const IPHONE_LANDSCAPE_INSETS = { top: 0, right: 0, bottom: 21, left: 59 }

const mockMeasuredInsets = insets => {
    jest.spyOn(window, 'getComputedStyle').mockImplementation(element => {
        if (element.hasAttribute && element.hasAttribute('data-safe-area-inset-probe')) {
            return {
                paddingTop: `${insets.top}px`,
                paddingRight: `${insets.right}px`,
                paddingBottom: `${insets.bottom}px`,
                paddingLeft: `${insets.left}px`,
            }
        }
        return { paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' }
    })
    // getSafeAreaInsets caches by window size; vary it so each case re-measures.
    window.innerWidth = window.innerWidth + 1
}

describe('modalSafeArea', () => {
    afterEach(() => jest.restoreAllMocks())

    describe('the anti-regression contract: zero insets change nothing', () => {
        // Desktop, Android and any iOS browser without viewport-fit=cover
        // resolve every env() to zero. Each helper must then reproduce the
        // exact arithmetic the call sites used before AT-2339.
        it('reproduces `windowHeight - MODAL_MAX_HEIGHT_GAP` exactly', () => {
            expect(MODAL_SAFE_AREA_GAP).toBe(32)
            expect(computeSafeAreaModalMaxHeight({ windowHeight: 900 })).toBe(900 - 32)
            expect(computeSafeAreaModalMaxHeight({ windowHeight: 900, extraGap: 64 })).toBe(900 - 32 - 64)
            expect(computeSafeAreaModalMaxWidth({ windowWidth: 1440 })).toBe(1440 - 32)
        })

        it('adds no overlay padding and no edge offsets', () => {
            expect(computeSafeAreaOverlayPadding({})).toEqual({
                paddingTop: 0,
                paddingRight: 0,
                paddingBottom: 0,
                paddingLeft: 0,
            })
            expect(computeSafeAreaOverlayPadding({ minimum: { top: 80, bottom: 16 } })).toEqual({
                paddingTop: 80,
                paddingRight: 0,
                paddingBottom: 16,
                paddingLeft: 0,
            })
            expect(computeSafeAreaModalMaxHeightBelow({ windowHeight: 900, topOffset: 120 })).toBe(900 - 120 - 32)
        })
    })

    describe('notched iOS', () => {
        it('gives back only the height between the status bar and the home indicator', () => {
            expect(computeSafeAreaModalMaxHeight({ windowHeight: 844, insets: IPHONE_INSETS })).toBe(844 - 47 - 34 - 32)
        })

        it('keeps the caller-reserved chrome gap on top of the insets', () => {
            expect(computeSafeAreaModalMaxHeight({ windowHeight: 844, insets: IPHONE_INSETS, extraGap: 64 })).toBe(
                844 - 47 - 34 - 32 - 64
            )
        })

        it('subtracts the landscape cutout from the available width', () => {
            expect(computeSafeAreaModalMaxWidth({ windowWidth: 844, insets: IPHONE_LANDSCAPE_INSETS })).toBe(
                844 - 59 - 32
            )
        })

        it('pads a gapless overlay by the full inset on all four edges', () => {
            expect(computeSafeAreaOverlayPadding({ insets: IPHONE_INSETS })).toEqual({
                paddingTop: 47,
                paddingRight: 0,
                paddingBottom: 34,
                paddingLeft: 0,
            })

            expect(computeSafeAreaOverlayPadding({ insets: IPHONE_LANDSCAPE_INSETS })).toEqual({
                paddingTop: 0,
                paddingRight: 0,
                paddingBottom: 21,
                paddingLeft: 59,
            })
        })

        // The load-bearing anti-regression property of the whole change set:
        // an existing gap that already clears the inset is left alone, so the
        // dialogs Karsten already signed off on do not move a pixel. Only the
        // edges that had NO gap (left/right here) gain padding.
        it('never moves a dialog whose gap already clears the system UI', () => {
            expect(computeSafeAreaOverlayPadding({ insets: IPHONE_INSETS, minimum: { top: 80, bottom: 16 } })).toEqual({
                paddingTop: 80,
                paddingRight: 0,
                paddingBottom: 34,
                paddingLeft: 0,
            })

            expect(
                computeSafeAreaOverlayPadding({ insets: IPHONE_LANDSCAPE_INSETS, minimum: { top: 80, bottom: 16 } })
            ).toEqual({ paddingTop: 80, paddingRight: 0, paddingBottom: 21, paddingLeft: 59 })
        })

        it('measures the mentions dropdown from its own offset, not from the inset twice', () => {
            // topOffset 120 is already below the 47px island: the top inset
            // must NOT be subtracted again, only the bottom one.
            expect(
                computeSafeAreaModalMaxHeightBelow({ windowHeight: 844, topOffset: 120, insets: IPHONE_INSETS })
            ).toBe(844 - 120 - 34 - 32)

            // An offset ABOVE the island is not usable space: the inset floors it.
            expect(
                computeSafeAreaModalMaxHeightBelow({ windowHeight: 844, topOffset: 10, insets: IPHONE_INSETS })
            ).toBe(844 - 47 - 34 - 32)
        })
    })

    describe('degenerate input', () => {
        it('never returns a negative or NaN size', () => {
            expect(computeSafeAreaModalMaxHeight({ windowHeight: 40, insets: IPHONE_INSETS })).toBe(0)
            expect(computeSafeAreaModalMaxHeight({ windowHeight: undefined })).toBe(0)
            expect(computeSafeAreaModalMaxHeight({ windowHeight: NaN })).toBe(0)
            expect(computeSafeAreaModalMaxHeight()).toBe(0)
            expect(computeSafeAreaModalMaxWidth({ windowWidth: null })).toBe(0)
        })

        it('treats missing or non-numeric insets as zero', () => {
            expect(computeSafeAreaModalMaxHeight({ windowHeight: 900, insets: { top: 'x', bottom: null } })).toBe(868)
            expect(computeSafeAreaModalMaxHeightBelow()).toBe(0)
            expect(computeSafeAreaOverlayPadding({ insets: null, minimum: null })).toEqual({
                paddingTop: 0,
                paddingRight: 0,
                paddingBottom: 0,
                paddingLeft: 0,
            })
        })
    })

    describe('live measurement', () => {
        it('reads the resolved env() values through the shared probe', () => {
            mockMeasuredInsets(IPHONE_INSETS)

            expect(getSafeAreaModalMaxHeight(844)).toBe(844 - 47 - 34 - 32)
            expect(getSafeAreaModalMaxHeight(844, 64)).toBe(844 - 47 - 34 - 32 - 64)
            expect(getSafeAreaModalMaxWidth(390)).toBe(390 - 32)
            expect(getSafeAreaModalMaxHeightBelow(844, 120)).toBe(844 - 120 - 34 - 32)
            expect(getSafeAreaOverlayPadding()).toEqual({
                paddingTop: 47,
                paddingRight: 0,
                paddingBottom: 34,
                paddingLeft: 0,
            })
            expect(getSafeAreaOverlayPadding({ top: 80, bottom: 16 })).toEqual({
                paddingTop: 80,
                paddingRight: 0,
                paddingBottom: 34,
                paddingLeft: 0,
            })
            expect(getSafeAreaEdgeOffsets()).toEqual(IPHONE_INSETS)
        })

        it('falls back to the pre-AT-2339 numbers when env() is unsupported', () => {
            mockMeasuredInsets({ top: 0, right: 0, bottom: 0, left: 0 })

            expect(getSafeAreaModalMaxHeight(900)).toBe(868)
            expect(getSafeAreaOverlayPadding({ top: 80, bottom: 16 })).toEqual({
                paddingTop: 80,
                paddingRight: 0,
                paddingBottom: 16,
                paddingLeft: 0,
            })
        })
    })
})
