import {
    ASSISTANT_INPUT_MAX_HEIGHT,
    getAssistantInputLayout,
    getStableControlsWidth,
    INITIAL_ASSISTANT_INPUT_LAYOUT,
} from './assistantInputLayout'

describe('assistant input layout', () => {
    it('expands to the measured content height and caps at the maximum', () => {
        expect(getAssistantInputLayout(79.2, INITIAL_ASSISTANT_INPUT_LAYOUT)).toEqual({
            height: 80,
            scrollEnabled: false,
        })
        expect(getAssistantInputLayout(121, INITIAL_ASSISTANT_INPUT_LAYOUT)).toEqual({
            height: ASSISTANT_INPUT_MAX_HEIGHT,
            scrollEnabled: true,
        })
    })

    it('keeps a stable maximum height for measurements oscillating around the scrollbar boundary', () => {
        const overflowingLayout = getAssistantInputLayout(121, INITIAL_ASSISTANT_INPUT_LAYOUT)
        const narrowerMeasurement = getAssistantInputLayout(119, overflowingLayout)
        const widerMeasurement = getAssistantInputLayout(121, narrowerMeasurement)

        expect(narrowerMeasurement).toEqual(overflowingLayout)
        expect(widerMeasurement).toBe(narrowerMeasurement)
    })

    it('holds a stable height when the content flaps by less than a line at a wrap boundary', () => {
        // Typing near a line-wrap boundary can make the browser report a
        // natural height that oscillates by a couple of pixels between frames.
        const expanded = getAssistantInputLayout(74, INITIAL_ASSISTANT_INPUT_LAYOUT)
        expect(expanded).toEqual({ height: 74, scrollEnabled: false })

        // A slightly smaller re-measurement must NOT shrink the field...
        const afterReWrap = getAssistantInputLayout(70, expanded)
        expect(afterReWrap).toBe(expanded)

        // ...and bouncing back up must not report a change either (no wiggle).
        const afterBounceBack = getAssistantInputLayout(74, afterReWrap)
        expect(afterBounceBack).toBe(afterReWrap)
    })

    it('grows immediately so a newly typed line is never clipped', () => {
        const oneLine = getAssistantInputLayout(40, INITIAL_ASSISTANT_INPUT_LAYOUT)
        const twoLines = getAssistantInputLayout(62, oneLine)

        expect(twoLines).toEqual({ height: 62, scrollEnabled: false })
    })

    it('collapses once a full line of content is removed', () => {
        const twoLines = getAssistantInputLayout(62, INITIAL_ASSISTANT_INPUT_LAYOUT)
        const backToOneLine = getAssistantInputLayout(40, twoLines)

        expect(backToOneLine).toEqual({ height: 40, scrollEnabled: false })
    })

    it('leaves scroll mode after content shrinks clearly below the maximum', () => {
        const overflowingLayout = getAssistantInputLayout(140, INITIAL_ASSISTANT_INPUT_LAYOUT)

        expect(getAssistantInputLayout(100, overflowingLayout)).toEqual({ height: 100, scrollEnabled: false })
    })

    it('ignores invalid browser measurements', () => {
        expect(getAssistantInputLayout(NaN, INITIAL_ASSISTANT_INPUT_LAYOUT)).toBe(INITIAL_ASSISTANT_INPUT_LAYOUT)
    })
})

describe('stable send-controls width', () => {
    it('captures the collapsed (row) width so the input width can stay fixed', () => {
        expect(getStableControlsWidth(120.4, false, null)).toBe(121)
    })

    it('never adopts a narrower measurement taken while the cluster is stacked/expanded', () => {
        // The row layout measured 120; once the input expands the cluster becomes
        // a column and reports ~72. Trusting that would widen the flex:1 input and
        // restart the wrap/height oscillation, so the pinned width must not move.
        expect(getStableControlsWidth(72, true, 120)).toBe(120)
    })

    it('holds the pinned width against sub-pixel jitter to avoid needless re-renders', () => {
        expect(getStableControlsWidth(120.2, false, 120)).toBe(120)
    })

    it('re-measures a genuinely different collapsed width (e.g. after a resize)', () => {
        expect(getStableControlsWidth(96, false, 120)).toBe(96)
    })

    it('ignores zero / invalid measurements and keeps the previous width', () => {
        expect(getStableControlsWidth(0, false, 120)).toBe(120)
        expect(getStableControlsWidth(NaN, false, 120)).toBe(120)
        expect(getStableControlsWidth(-5, false, 120)).toBe(120)
        expect(getStableControlsWidth(undefined, false, null)).toBe(null)
    })
})
