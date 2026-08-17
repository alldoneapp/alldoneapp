// Pure viewport math for react-tiny-popover `contentLocation` helpers.
//
// Passing a contentLocation switches react-tiny-popover into "the caller places
// it" mode: the library skips its own nudge/reposition pass (see renderPopover
// in replacement_node_modules/react-tiny-popover/dist/Popover.js), so whatever
// a helper returns is applied verbatim to a `position: fixed` container that
// also has `overflow: hidden`. Any coordinate outside the viewport therefore
// renders the popover clipped or completely off-screen.
//
// This module deliberately depends on nothing but react-native and the
// safe-area probe (no redux store, no Firebase) so it can be unit-tested
// directly — utils/HelperFunctions.js cannot be imported from a test because
// it pulls in the store and react-native-dotenv. Same rationale as
// utils/popupDismissGuard.js.

import { Dimensions } from 'react-native'

import { getSafeAreaInsets } from './safeAreaInsets'

export const POPOVER_VIEWPORT_PADDING = 8

// The named form of the `contentLocation={mobile ? null : undefined}` idiom
// (~136 call sites). react-tiny-popover distinguishes the two values inside
// renderPopover (replacement_node_modules/react-tiny-popover/dist/Popover.js):
// `null` — being `typeof 'object'` — disables the position-flip search, so the
// popover keeps the first candidate position and is only nudged into the
// viewport; being falsy, it also skips the caller-placed-coordinates branch.
// `undefined` keeps the library's full positioning behavior. On small screens
// the flip search thrashes (every candidate violates), so "nudge only" is the
// deliberate mobile mode. Guarded by __tests__/ModalSystemGuardrails.test.js.
export const nudgeIntoViewportWhen = condition => (condition ? null : undefined)

export const clampToRange = (value, min, max) => {
    if (max < min) {
        return min
    }
    if (value < min) {
        return min
    }
    if (value > max) {
        return max
    }
    return value
}

// Centers a popover of the given size in the viewport and guarantees the result
// stays inside it. `horizontalOffset` shifts the centre (used on desktop to
// centre against the content area rather than the whole window, i.e. to
// compensate for the sidebar) but is dropped as soon as it would push the
// popover past the right edge.
//
// When the popover is larger than the viewport, clampToRange collapses to
// `padding`: an oversized modal is pinned to the top/left edge so its header and
// close button stay reachable, instead of being centred with a negative top —
// which is exactly how the swipe postpone popup disappeared above the top edge
// on short phone viewports (AT-2189).
// AT-2339: the clamp is against the SAFE viewport, not the raw one. The
// patched library nudges an anchored popover into the safe rectangle itself,
// but ~10 of these call sites pass `disableReposition` (the comment popup
// among them), which skips that pass entirely — so for those this clamp is the
// only thing standing between the popover and the Dynamic Island. Centring
// also happens within the safe rectangle, so a centred card looks centred to
// the user rather than centred on the hardware and then shoved down.
//
// `insets` defaults to zero, which is every desktop browser and Android, and
// reproduces the pre-AT-2339 numbers exactly.
export const centerPopoverInViewport = ({
    viewportWidth,
    viewportHeight,
    popoverWidth = 0,
    popoverHeight = 0,
    horizontalOffset = 0,
    padding = POPOVER_VIEWPORT_PADDING,
    insets,
}) => {
    const width = Number.isFinite(popoverWidth) ? popoverWidth : 0
    const height = Number.isFinite(popoverHeight) ? popoverHeight : 0
    const inset = edge => (Number.isFinite(insets?.[edge]) ? insets[edge] : 0)

    const minTop = inset('top') + padding
    const maxTop = viewportHeight - inset('bottom') - height - padding
    const minLeft = inset('left') + padding
    const maxLeft = viewportWidth - inset('right') - width - padding

    const safeCenterTop = (inset('top') + (viewportHeight - inset('bottom'))) / 2 - height / 2
    const safeCenterLeft = (inset('left') + (viewportWidth - inset('right'))) / 2 - width / 2

    const top = clampToRange(safeCenterTop, minTop, maxTop)
    const left = clampToRange(safeCenterLeft + horizontalOffset, minLeft, maxLeft)

    return { top, left }
}

// react-tiny-popover contentLocation adapter: same math, measured against the
// live window. `horizontalOffset` is how callers compensate for the desktop
// sidebar so the popover looks centred over the content area.
export const centerPopoverInWindow = ({ popoverRect } = {}, horizontalOffset = 0) => {
    const dim = Dimensions.get('window')

    return centerPopoverInViewport({
        viewportWidth: dim.width,
        viewportHeight: dim.height,
        popoverWidth: popoverRect?.width,
        popoverHeight: popoverRect?.height,
        horizontalOffset,
        insets: getSafeAreaInsets(),
    })
}
