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

    it('leaves scroll mode after content shrinks clearly below the maximum', () => {
        const overflowingLayout = getAssistantInputLayout(140, INITIAL_ASSISTANT_INPUT_LAYOUT)

        expect(getAssistantInputLayout(100, overflowingLayout)).toEqual({ height: 100, scrollEnabled: false })
    })

    it('ignores invalid browser measurements', () => {
        expect(getAssistantInputLayout(NaN, INITIAL_ASSISTANT_INPUT_LAYOUT)).toBe(INITIAL_ASSISTANT_INPUT_LAYOUT)
    })
})
