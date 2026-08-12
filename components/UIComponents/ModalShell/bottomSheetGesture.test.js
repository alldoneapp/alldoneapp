import {
    BOTTOM_SHEET_UPWARD_DRAG_LIMIT,
    clampBottomSheetDrag,
    getBottomSheetReleaseVelocity,
    shouldDismissBottomSheet,
} from './bottomSheetGesture'

describe('bottom-sheet handle gestures', () => {
    it('follows the handle in both directions within the sheet bounds', () => {
        expect(clampBottomSheetDrag(-20, 400)).toBe(-20)
        expect(clampBottomSheetDrag(-200, 400)).toBe(-BOTTOM_SHEET_UPWARD_DRAG_LIMIT)
        expect(clampBottomSheetDrag(240, 400)).toBe(240)
        expect(clampBottomSheetDrag(600, 400)).toBe(400)
    })

    it('dismisses for a deliberate long drag, but not a nearby short drag', () => {
        expect(shouldDismissBottomSheet(96, 0.1)).toBe(true)
        expect(shouldDismissBottomSheet(95, 0.1)).toBe(false)
    })

    it('requires both speed and a minimum distance for flick dismissal', () => {
        expect(shouldDismissBottomSheet(40, 0.9)).toBe(true)
        expect(shouldDismissBottomSheet(40, 0.7)).toBe(false)
        expect(shouldDismissBottomSheet(8, 4)).toBe(false)
        expect(shouldDismissBottomSheet(-40, 4)).toBe(false)
    })

    it('measures release velocity from recent movement instead of total gesture time', () => {
        const samples = [
            { time: 0, y: 100 },
            { time: 400, y: 110 },
            { time: 460, y: 150 },
        ]

        expect(getBottomSheetReleaseVelocity(samples, 500, 190)).toBe(0.8)
        expect(getBottomSheetReleaseVelocity(samples, 700, 190)).toBe(0)
    })
})
