import {
    ASSISTANT_INPUT_MAX_HEIGHT,
    ASSISTANT_INPUT_MIN_HEIGHT,
    getAssistantInputLayout,
    INITIAL_ASSISTANT_INPUT_LAYOUT,
} from './assistantInputLayout'

describe('assistant input layout', () => {
    it('rests at two lines and scrolls after six', () => {
        expect(ASSISTANT_INPUT_MIN_HEIGHT).toBe(56)
        expect(ASSISTANT_INPUT_MAX_HEIGHT).toBe(152)
        expect(INITIAL_ASSISTANT_INPUT_LAYOUT).toEqual({ height: 56, scrollEnabled: false })
    })

    it('expands to the measured content height and caps at the maximum', () => {
        expect(getAssistantInputLayout(79.2, INITIAL_ASSISTANT_INPUT_LAYOUT)).toEqual({
            height: 80,
            scrollEnabled: false,
        })
        expect(getAssistantInputLayout(160, INITIAL_ASSISTANT_INPUT_LAYOUT)).toEqual({
            height: ASSISTANT_INPUT_MAX_HEIGHT,
            scrollEnabled: true,
        })
    })

    it('keeps a stable maximum height for measurements oscillating around the scrollbar boundary', () => {
        const overflowingLayout = getAssistantInputLayout(153, INITIAL_ASSISTANT_INPUT_LAYOUT)
        const narrowerMeasurement = getAssistantInputLayout(151, overflowingLayout)
        const widerMeasurement = getAssistantInputLayout(153, narrowerMeasurement)

        expect(narrowerMeasurement).toEqual(overflowingLayout)
        expect(widerMeasurement).toBe(narrowerMeasurement)
    })

    it('holds a stable height when the content flaps by less than a line at a wrap boundary', () => {
        // Typing near a line-wrap boundary can make the browser report a
        // natural height that oscillates by a couple of pixels between frames.
        const expanded = getAssistantInputLayout(98, INITIAL_ASSISTANT_INPUT_LAYOUT)
        expect(expanded).toEqual({ height: 98, scrollEnabled: false })

        // A slightly smaller re-measurement must NOT shrink the field...
        const afterReWrap = getAssistantInputLayout(94, expanded)
        expect(afterReWrap).toBe(expanded)

        // ...and bouncing back up must not report a change either (no wiggle).
        const afterBounceBack = getAssistantInputLayout(98, afterReWrap)
        expect(afterBounceBack).toBe(afterReWrap)
    })

    it('grows immediately so a newly typed line is never clipped', () => {
        const twoLines = getAssistantInputLayout(56, INITIAL_ASSISTANT_INPUT_LAYOUT)
        const threeLines = getAssistantInputLayout(80, twoLines)

        expect(threeLines).toEqual({ height: 80, scrollEnabled: false })
    })

    it('collapses once a full line of content is removed', () => {
        const threeLines = getAssistantInputLayout(80, INITIAL_ASSISTANT_INPUT_LAYOUT)
        const backToTwoLines = getAssistantInputLayout(56, threeLines)

        expect(backToTwoLines).toEqual({ height: 56, scrollEnabled: false })
    })

    it('leaves scroll mode after content shrinks clearly below the maximum', () => {
        const overflowingLayout = getAssistantInputLayout(180, INITIAL_ASSISTANT_INPUT_LAYOUT)

        expect(getAssistantInputLayout(120, overflowingLayout)).toEqual({ height: 120, scrollEnabled: false })
    })

    it('ignores invalid browser measurements', () => {
        expect(getAssistantInputLayout(NaN, INITIAL_ASSISTANT_INPUT_LAYOUT)).toBe(INITIAL_ASSISTANT_INPUT_LAYOUT)
    })
})

// AT-2444 — a composer holding a dropped/pasted attachment is allowed past the text cap so the
// image preview is visible instead of half-shown inside a scroller. The cap is a parameter, so
// every assertion above (which passes none) is also the proof that the text path is unchanged.
describe('assistant input layout with a raised cap for attachments', () => {
    const MEDIA_MAX = 260

    it('grows past the text cap when a taller cap is passed', () => {
        expect(getAssistantInputLayout(220, INITIAL_ASSISTANT_INPUT_LAYOUT, MEDIA_MAX)).toEqual({
            height: 220,
            scrollEnabled: false,
        })
        // The same measurement against the default cap still clamps and scrolls.
        expect(getAssistantInputLayout(220, INITIAL_ASSISTANT_INPUT_LAYOUT)).toEqual({
            height: ASSISTANT_INPUT_MAX_HEIGHT,
            scrollEnabled: true,
        })
    })

    it('moves the scroll threshold and the clamp with the cap', () => {
        expect(getAssistantInputLayout(300, INITIAL_ASSISTANT_INPUT_LAYOUT, MEDIA_MAX)).toEqual({
            height: MEDIA_MAX,
            scrollEnabled: true,
        })
    })

    it('collapses back below the text cap when the attachment is removed', () => {
        const expanded = { height: MEDIA_MAX, scrollEnabled: false }
        expect(getAssistantInputLayout(56, expanded, ASSISTANT_INPUT_MAX_HEIGHT)).toEqual({
            height: 56,
            scrollEnabled: false,
        })
    })

    it('falls back to the text cap for a missing or nonsensical cap', () => {
        expect(getAssistantInputLayout(220, INITIAL_ASSISTANT_INPUT_LAYOUT, undefined)).toEqual({
            height: ASSISTANT_INPUT_MAX_HEIGHT,
            scrollEnabled: true,
        })
        expect(getAssistantInputLayout(220, INITIAL_ASSISTANT_INPUT_LAYOUT, NaN)).toEqual({
            height: ASSISTANT_INPUT_MAX_HEIGHT,
            scrollEnabled: true,
        })
        expect(getAssistantInputLayout(220, INITIAL_ASSISTANT_INPUT_LAYOUT, 5)).toEqual({
            height: ASSISTANT_INPUT_MAX_HEIGHT,
            scrollEnabled: true,
        })
    })
})
