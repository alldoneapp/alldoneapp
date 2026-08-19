import useWindowSize from '../utils/useWindowSize'
import { getSafeAreaOverlayPadding } from '../utils/modalSafeArea'
import { FIXED_MODAL_BOTTOM_GAP, FIXED_MODAL_TOP_OFFSET } from '../utils/fixedModalPosition'

/**
 * Safe-area padding for a full-viewport `position: fixed` overlay (AT-2339).
 *
 * Spread the result onto the OVERLAY — the inset-0 centering parent — never
 * onto the card: padding the card shrinks its content instead of moving it out
 * from under the status bar. Because a percentage `max-height` resolves
 * against the containing block's CONTENT box, padding the overlay is what
 * makes the family's existing `maxHeight: '90%'` / `'94%'` caps safe with no
 * per-modal retuning.
 *
 * `minimum` is the fixed gap the overlay already had; each edge resolves to
 * `max(gap, inset)`, so an overlay that already cleared the system UI does not
 * move, and one with no gap gets the full inset. On a device with no insets
 * every value is byte-identical to before.
 *
 * The useWindowSize() subscription is the point of the hook rather than
 * calling getSafeAreaOverlayPadding() directly: these dialogs subscribe to
 * redux, not to the viewport, so without it a rotation would leave a landscape
 * overlay padded with the portrait insets until something else re-rendered it.
 * (getSafeAreaInsets caches per viewport size, so the extra render is what
 * triggers the re-measurement.)
 */
export default function useSafeAreaOverlayPadding(minimum) {
    useWindowSize()

    return getSafeAreaOverlayPadding(minimum)
}

/**
 * The same thing for the top-pinned dialog family (`fixedModalOverlayStyle`),
 * which already reserves a 80px top / 16px bottom gap.
 *
 * The 80px top gap already clears every current iPhone inset, so on those
 * devices this returns exactly today's numbers and the dialogs do not move;
 * what it adds is the left/right padding the style never had (the landscape
 * cutout) and a floor for any future device whose inset exceeds the gap.
 *
 * Spread AFTER fixedModalOverlayStyle so these values win over its static
 * paddingTop/paddingBottom.
 */
export function useFixedModalOverlayPadding() {
    return useSafeAreaOverlayPadding({ top: FIXED_MODAL_TOP_OFFSET, bottom: FIXED_MODAL_BOTTOM_GAP })
}
