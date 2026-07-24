jest.mock('react-native', () => ({
    Platform: { OS: 'ios' },
    StatusBar: { currentHeight: 24 },
    StyleSheet: { create: styles => styles },
}))
jest.mock('../styles/global', () => ({ colors: { Text01: '#000000', UtilityBlue200: '#0000FF' } }))

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
})
