import shouldAutoFocusChatInput from './shouldAutoFocusChatInput'

describe('thread input auto focus', () => {
    it('never focuses automatically on mobile', () => {
        expect(shouldAutoFocusChatInput(true)).toBe(false)
    })

    it('always focuses automatically on desktop', () => {
        expect(shouldAutoFocusChatInput(false)).toBe(true)
    })
})
