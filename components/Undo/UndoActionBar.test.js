jest.mock('react-native', () => ({
    Platform: { OS: 'ios' },
    StatusBar: { currentHeight: 24 },
    StyleSheet: { create: styles => styles },
}))
jest.mock('../styles/global', () => ({ colors: { Text01: '#000000', UtilityBlue200: '#0000FF' } }))

import undoActionBarStyles from './undoActionBarStyles'

describe('UndoActionBar positioning', () => {
    it('positions the undo banner below the header instead of at the bottom', () => {
        expect(undoActionBarStyles.overlay.top).toBeDefined()
        expect(undoActionBarStyles.overlay.bottom).toBeUndefined()
        expect(undoActionBarStyles.container.marginTop).toBe(64)
    })
})
