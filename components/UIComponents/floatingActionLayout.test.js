import {
    FLOATING_ACTION_POPOVER_GAP,
    FLOATING_ACTION_SIZE,
    FLOATING_ACTION_VIEWPORT_GAP,
    getFloatingActionBottom,
    getLoadingDataBottom,
    LOADING_DATA_CONTAINER_SIZE,
} from './floatingActionLayout'

describe('floating action layout', () => {
    it('keeps the loader centered vertically with the task action', () => {
        const safeAreaBottom = 5

        expect(getFloatingActionBottom(safeAreaBottom)).toBe(29)
        expect(getLoadingDataBottom(safeAreaBottom)).toBe(33)
        expect(FLOATING_ACTION_SIZE).toBe(56)
        expect(LOADING_DATA_CONTAINER_SIZE).toBe(48)
    })

    it('reserves explicit viewport and popup gaps around the task action', () => {
        expect(FLOATING_ACTION_VIEWPORT_GAP).toBe(24)
        expect(FLOATING_ACTION_POPOVER_GAP).toBe(12)
    })
})
