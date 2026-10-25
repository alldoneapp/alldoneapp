import { showConnectionChipBelowHeader } from './connectionChipPlacement'

/**
 * AT-2426. The rule the two call sites share: `TopBar` renders the chip only when this is
 * false, `MainViewsContainer` stacks it below the header only when it is true. Pinning it
 * here rather than through either component is what makes "the chip is in exactly one
 * place at every size" checkable — the two components live in different trees and neither
 * can see the other's decision.
 */
describe('showConnectionChipBelowHeader', () => {
    it.each([
        ['phone', { smallScreenNavigation: true, smallScreen: true }, true],
        // `smallScreenNavigation` implies `smallScreen` arithmetically, but the two are
        // written by SEPARATE store.dispatch calls in AppNavigator.onLayoutChange, so a
        // resize has a frame where the first is true and the second is not yet. Without
        // the OR the chip would be in neither placement for that frame.
        ['mid-resize, only the nav flag written', { smallScreenNavigation: true, smallScreen: false }, true],
        ['tablet', { smallScreenNavigation: false, smallScreen: true }, true],
        ['desktop', { smallScreenNavigation: false, smallScreen: false }, false],
    ])('%s resolves to %s', (_mode, state, expected) => {
        expect(showConnectionChipBelowHeader(state)).toBe(expected)
    })

    it('does not key on isMiddleScreen, which is correct only in English', () => {
        // The narrower `isMiddleScreen` (<= ~1052px) leaves iPad Air / Pro 11 landscape
        // (1180 / 1194px) with the chip in the header. Measured there: it fits in English
        // with 4.75px to spare and overflows in German. A viewport in that band is
        // `smallScreen` but NOT `isMiddleScreen`, and must still stack.
        expect(showConnectionChipBelowHeader({ smallScreen: true, isMiddleScreen: false })).toBe(true)
    })

    it('does not treat an unmeasured layout as tablet', () => {
        // Both flags default to false in the store, i.e. before the first onLayout. The
        // header is the safe default there: it is the placement that existed before this
        // change, and a wrongly-stacked chip is a visible layout shift on every desktop
        // boot.
        expect(showConnectionChipBelowHeader({})).toBeFalsy()
    })
})
