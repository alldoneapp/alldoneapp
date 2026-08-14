import { FIXED_MODAL_BOTTOM_GAP, FIXED_MODAL_TOP_OFFSET, fixedModalOverlayStyle } from './fixedModalPosition'

describe('fixedModalPosition', () => {
    it('anchors modal content to the viewport with the shared top gap', () => {
        expect(fixedModalOverlayStyle).toEqual({
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            justifyContent: 'flex-start',
            paddingTop: FIXED_MODAL_TOP_OFFSET,
            paddingBottom: FIXED_MODAL_BOTTOM_GAP,
        })
        expect(FIXED_MODAL_TOP_OFFSET).toBe(80)
        expect(FIXED_MODAL_BOTTOM_GAP).toBe(16)
    })
})
