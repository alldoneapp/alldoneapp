import {
    ASSISTANT_INPUT_MAX_HEIGHT,
    getAssistantInputLayout,
    ASSISTANT_CONTROLS_STACKED_HEIGHT,
    getAssistantControlsStacked,
    getAssistantInputDisplayHeight,
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

describe('assistant controls stacking', () => {
    it('stacks the voice and send buttons as soon as the field grows past one line', () => {
        expect(getAssistantControlsStacked({ inputHeight: 62, hasText: true, wasStacked: false })).toBe(true)
    })

    it('keeps the row layout while the field is a single line', () => {
        expect(getAssistantControlsStacked({ inputHeight: 40, hasText: true, wasStacked: false })).toBe(false)
    })

    it('holds the stack when the widened input re-wraps back to one line', () => {
        // Stacking narrows the cluster by ~48px, so the flex:1 input gets wider
        // and the text can re-wrap to a single line. Un-stacking here would
        // re-widen the cluster, re-wrap the text and oscillate forever.
        expect(getAssistantControlsStacked({ inputHeight: 40, hasText: true, wasStacked: true })).toBe(true)
    })

    it('returns to the compact row only once the field is empty', () => {
        expect(getAssistantControlsStacked({ inputHeight: 40, hasText: false, wasStacked: true })).toBe(false)
    })

    it('ignores invalid measurements without dropping the stack', () => {
        expect(getAssistantControlsStacked({ inputHeight: NaN, hasText: true, wasStacked: true })).toBe(true)
        expect(getAssistantControlsStacked({ inputHeight: NaN, hasText: false, wasStacked: true })).toBe(false)
    })
})

describe('assistant input display height', () => {
    it('leaves the collapsed height untouched', () => {
        expect(getAssistantInputDisplayHeight(40, false)).toBe(40)
        expect(getAssistantInputDisplayHeight(62, false)).toBe(62)
    })

    it('grows the field to the stacked cluster height so the buttons never overhang', () => {
        expect(ASSISTANT_CONTROLS_STACKED_HEIGHT).toBe(88)
        expect(getAssistantInputDisplayHeight(40, true)).toBe(88)
        expect(getAssistantInputDisplayHeight(62, true)).toBe(88)
    })

    it('keeps a taller field as measured and never exceeds the scroll ceiling', () => {
        expect(getAssistantInputDisplayHeight(106, true)).toBe(106)
        expect(getAssistantInputDisplayHeight(120, true)).toBe(120)
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
        expect(getAssistantInputLayout(40, expanded, ASSISTANT_INPUT_MAX_HEIGHT)).toEqual({
            height: 40,
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

    it('lets the stacked display height follow the raised cap too', () => {
        expect(getAssistantInputDisplayHeight(220, true, MEDIA_MAX)).toBe(220)
        expect(getAssistantInputDisplayHeight(300, true, MEDIA_MAX)).toBe(MEDIA_MAX)
        expect(getAssistantInputDisplayHeight(220, true)).toBe(ASSISTANT_INPUT_MAX_HEIGHT)
    })
})
