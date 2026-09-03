jest.mock('react-native', () => ({
    Platform: { OS: 'ios' },
    StatusBar: { currentHeight: 24 },
    StyleSheet: { create: styles => styles },
}))
jest.mock('../styles/global', () => ({
    colors: { Text01: '#04142F', UtilityBlue200: '#0000FF' },
    hexColorToRGBa: (hexColor, alpha) => {
        const [r, g, b] = hexColor
            .replace('#', '')
            .match(/.{2}/g)
            .map(channel => parseInt(channel, 16))
        return `rgba(${r},${g},${b},${alpha})`
    },
}))

import undoActionBarStyles from './undoActionBarStyles'

describe('UndoActionBar layout', () => {
    it('positions the undo banner at the safe top edge instead of the bottom', () => {
        expect(undoActionBarStyles.overlay.top).toBeDefined()
        expect(undoActionBarStyles.overlay.bottom).toBeUndefined()
        expect(undoActionBarStyles.container.marginTop).toBe(64)
    })

    it('adds extra horizontal viewport padding on mobile', () => {
        expect(undoActionBarStyles.mobileViewport.paddingHorizontal).toBe(24)
        expect(undoActionBarStyles.viewport.paddingHorizontal).toBe(16)
        expect(undoActionBarStyles.overlay.paddingHorizontal).toBeUndefined()
    })

    it('makes only the banner background 20% transparent', () => {
        expect(undoActionBarStyles.container.backgroundColor).toBe('rgba(4,20,47,0.8)')
        expect(undoActionBarStyles.container.opacity).toBeUndefined()
    })

    describe('the auto-hide countdown line (AT-2503)', () => {
        it('drains from the right edge leftwards rather than shrinking towards its own middle', () => {
            // Without this the line collapses symmetrically, which reads as a UI element being
            // removed rather than as time running out.
            expect(undoActionBarStyles.countdown.transformOrigin).toBe('left center')
        })

        it('sits on the bottom edge of the banner, spanning its full width', () => {
            expect(undoActionBarStyles.countdown.position).toBe('absolute')
            expect(undoActionBarStyles.countdown.bottom).toBe(0)
            expect(undoActionBarStyles.countdown.left).toBe(0)
            expect(undoActionBarStyles.countdown.right).toBe(0)
            expect(undoActionBarStyles.countdown.height).toBeLessThanOrEqual(3)
        })

        it('is a bare fill with no track behind it', () => {
            // A grey rail would announce a UI control in what is otherwise a sentence and a button,
            // and it would still be sitting there once the bar had emptied. Same call as AT-2404.
            const trackStyles = Object.keys(undoActionBarStyles).filter(name => /track|rail/i.test(name))
            expect(trackStyles).toEqual([])
        })

        it('is clipped to the banner corners without costing the banner its shadow', () => {
            expect(undoActionBarStyles.container.overflow).toBe('hidden')
            // `overflow` clips descendants; an element's own box-shadow is painted outside its
            // border box and is unaffected.
            expect(undoActionBarStyles.container.boxShadow).toBeDefined()
        })
    })
})
