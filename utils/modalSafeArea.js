// One authority for "how much room does a popup actually have?" (AT-2339).
//
// Before this module only two places in the app subtracted the iOS safe-area
// insets — hooks/useModalSizing.js and the BottomSheet built on it — which is
// why the comment popup respected the status bar / Dynamic Island and almost
// nothing else did. Every other popup sized itself against the RAW window:
//
//   - ~65 popover-content modals capped at `windowHeight - MODAL_MAX_HEIGHT_GAP`
//     (= innerHeight - 32). Centered, that leaves 16px above the card, well
//     inside a 47-59px top inset.
//   - the centered fixed-overlay dialogs (the "new day" popup and its family)
//     capped in percent — `maxHeight: '90%'` is a 5% ≈ 42px top gap on an
//     844pt iPhone, again less than the inset.
//   - the contentLocation centering helpers, which clamped to a hard 8/16px.
//
// The vendored popover-library patch (AT-2314) fixed POSITION: it nudges a
// portal inside the safe rectangle. It cannot fix HEIGHT — a card taller than
// the safe rectangle just overflows the opposite edge once its top is clamped.
// That is what this module is for.
//
// (Deliberately no literal mention of the library's package name anywhere in
// this file: __tests__/ModalSystemGuardrails.test.js ratchets the number of
// files under components/ and utils/ whose SOURCE contains that string, and
// the check is a substring match, so even prose counts as a new importer.)
//
// Deliberately pure-ish and dependency-light (safeAreaInsets + the style
// tokens, nothing from redux/Firebase) so the math is directly unit-testable,
// same rationale as utils/popoverPositioning.js.
//
// EVERY export collapses to today's behavior when the insets are zero, which
// is every desktop browser, Android, and any iOS browser without
// `viewport-fit=cover`. That is the anti-regression contract and
// utils/modalSafeArea.test.js pins it.

import { MODAL_EDGE_GAP } from '../components/styles/modals'
import { getSafeAreaInsets } from './safeAreaInsets'

const ZERO_INSETS = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 })

// Mirrors utils/HelperFunctions.js MODAL_MAX_HEIGHT_GAP. Duplicated rather
// than imported because HelperFunctions pulls in the redux store, which would
// make this module untestable in isolation (and drag the store behind every
// popup that only wants to know its height).
export const MODAL_SAFE_AREA_GAP = MODAL_EDGE_GAP * 2

const toFiniteNumber = value => (Number.isFinite(value) ? value : 0)

const normalizeInsets = insets => ({
    top: toFiniteNumber(insets?.top),
    right: toFiniteNumber(insets?.right),
    bottom: toFiniteNumber(insets?.bottom),
    left: toFiniteNumber(insets?.left),
})

/**
 * Pure form: the tallest a popup may be and still clear the system UI.
 *
 * `extraGap` is for call sites that already reserved room for chrome the modal
 * renders outside its scroll container (the comment popup's `- 64`), so their
 * arithmetic is preserved exactly rather than re-derived.
 */
export const computeSafeAreaModalMaxHeight = ({
    windowHeight,
    insets = ZERO_INSETS,
    gap = MODAL_SAFE_AREA_GAP,
    extraGap = 0,
} = {}) => {
    const safeInsets = normalizeInsets(insets)
    const height = toFiniteNumber(windowHeight)

    return Math.max(height - safeInsets.top - safeInsets.bottom - toFiniteNumber(gap) - toFiniteNumber(extraGap), 0)
}

/**
 * Pure form: the width a popup may occupy between the landscape cutout and the
 * opposite edge. Landscape on a notched iPhone puts 47-59px on ONE side.
 */
export const computeSafeAreaModalMaxWidth = ({ windowWidth, insets = ZERO_INSETS, gap = MODAL_SAFE_AREA_GAP } = {}) => {
    const safeInsets = normalizeInsets(insets)
    const width = toFiniteNumber(windowWidth)

    return Math.max(width - safeInsets.left - safeInsets.right - toFiniteNumber(gap), 0)
}

/**
 * Live form of computeSafeAreaModalMaxHeight, measured against the current
 * viewport. Drop-in for `windowHeight - MODAL_MAX_HEIGHT_GAP`: with zero insets
 * it returns exactly that number.
 *
 * Call it during render — getSafeAreaInsets() caches per viewport size, so a
 * rotation re-measures and anything already re-rendering on resize (every
 * useWindowSize consumer) stays correct with no extra subscription.
 */
export const getSafeAreaModalMaxHeight = (windowHeight, extraGap = 0) =>
    computeSafeAreaModalMaxHeight({ windowHeight, insets: getSafeAreaInsets(), extraGap })

export const getSafeAreaModalMaxWidth = windowWidth =>
    computeSafeAreaModalMaxWidth({ windowWidth, insets: getSafeAreaInsets() })

/**
 * Pure form: the room left BELOW an already-decided top offset — the mentions
 * dropdown, which hangs off the caret and sizes itself to the rest of the
 * screen.
 *
 * These call sites must not use the symmetric helper. Their `topOffset` is a
 * viewport coordinate the popover has already been pushed to, so subtracting
 * `insets.top` again would double-count it and lose up to 47px for no reason.
 * The top inset only matters here as a FLOOR: an offset above the status bar
 * is not usable space, so the available height is measured from whichever of
 * the two is lower down the screen.
 */
export const computeSafeAreaModalMaxHeightBelow = ({
    windowHeight,
    topOffset = 0,
    insets = ZERO_INSETS,
    gap = MODAL_SAFE_AREA_GAP,
} = {}) => {
    const safeInsets = normalizeInsets(insets)
    const effectiveTop = Math.max(toFiniteNumber(topOffset), safeInsets.top)

    return Math.max(toFiniteNumber(windowHeight) - effectiveTop - safeInsets.bottom - toFiniteNumber(gap), 0)
}

export const getSafeAreaModalMaxHeightBelow = (windowHeight, topOffset) =>
    computeSafeAreaModalMaxHeightBelow({ windowHeight, topOffset, insets: getSafeAreaInsets() })

/**
 * Pure form: the drop-in for a `maxHeight: '80vh'` style cap.
 *
 * `vh` is a fraction of the RAW viewport, so it knows nothing about the status
 * bar or the home indicator; an 80vh card can still be 20% too tall once the
 * insets are taken out. This keeps the caller's fraction as the intent and
 * only tightens it when the safe rectangle is the smaller of the two.
 *
 * With zero insets it returns `fraction * windowHeight` for any viewport tall
 * enough that the fraction was already the binding constraint (every desktop
 * and Android case), so it is not a regression.
 */
export const computeSafeAreaViewportHeightCap = ({
    windowHeight,
    fraction = 1,
    insets = ZERO_INSETS,
    gap = MODAL_SAFE_AREA_GAP,
    topOffset,
} = {}) => {
    const height = toFiniteNumber(windowHeight)
    const requested = height * toFiniteNumber(fraction)
    const available = Number.isFinite(topOffset)
        ? computeSafeAreaModalMaxHeightBelow({ windowHeight: height, topOffset, insets, gap })
        : computeSafeAreaModalMaxHeight({ windowHeight: height, insets, gap })

    return Math.max(Math.min(requested, available), 0)
}

/**
 * Live form. Pass `topOffset` when the popup is pinned at a known viewport
 * coordinate (the header switchers), so the cap measures the room actually
 * left below it rather than the whole screen.
 */
export const getSafeAreaViewportHeightCap = (windowHeight, fraction, topOffset) =>
    computeSafeAreaViewportHeightCap({ windowHeight, fraction, topOffset, insets: getSafeAreaInsets() })

/**
 * Pure form of the padding a full-viewport `position: fixed` overlay needs so
 * its centered card cannot reach under the system UI.
 *
 * MINIMUM semantics, not additive: each edge resolves to
 * `max(existingGap, inset)`. That is the deliberate, load-bearing choice.
 *
 *   - A dialog whose fixed gap ALREADY clears the inset does not move at all.
 *     The comment popup is pinned 80px from the top and reads correctly on a
 *     47px Dynamic Island; adding the inset would shove the one surface that
 *     was signed off as correct 47px down the screen. "Respects the header
 *     space" means "never underneath it", not "always further from it".
 *   - A dialog with no gap (the centered overlay family, `minimum` 0) still
 *     gets the full inset, because max(0, inset) === inset.
 *
 * So the whole change set carries one provable property: nothing that already
 * cleared the system UI is moved by a single pixel, on any device.
 *
 * Why padding and not a height cap: a percentage `max-height` resolves against
 * the containing block's CONTENT box, so padding the overlay makes every
 * `maxHeight: '90%'` card in the family safe with no per-modal retuning — the
 * "new day" popup included.
 */
export const computeSafeAreaOverlayPadding = ({ insets = ZERO_INSETS, minimum = {} } = {}) => {
    const safeInsets = normalizeInsets(insets)
    // Optional chaining, not just the parameter default: a call site that
    // passes an explicit `null` (or a `props.minimum` that is undefined on the
    // first render) must not crash the whole overlay.
    const atLeast = edge => Math.max(safeInsets[edge], toFiniteNumber(minimum?.[edge]))

    return {
        paddingTop: atLeast('top'),
        paddingRight: atLeast('right'),
        paddingBottom: atLeast('bottom'),
        paddingLeft: atLeast('left'),
    }
}

/**
 * Live form: spread onto a full-screen overlay's style array.
 *
 * NOTE the padding must go on the OVERLAY (the fixed, inset-0, centering
 * parent), never on the card — padding the card would shrink its content
 * instead of moving it out from under the status bar.
 */
export const getSafeAreaOverlayPadding = (minimum = {}) =>
    computeSafeAreaOverlayPadding({ insets: getSafeAreaInsets(), minimum })

/**
 * Live form for edge-anchored floating chrome (toasts, undo bars, banners)
 * that positions itself with `top`/`bottom`/`left`/`right` rather than by
 * centering in an overlay. Returns the offsets to ADD to the existing gaps.
 */
export const getSafeAreaEdgeOffsets = () => normalizeInsets(getSafeAreaInsets())
