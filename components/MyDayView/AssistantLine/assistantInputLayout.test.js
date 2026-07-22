import {
    ASSISTANT_INPUT_MAX_HEIGHT,
    getAssistantInputLayout,
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
