// Modal & popup design tokens — the single source for popup sizing, spacing,
// backdrop, radius, motion and z-order (MODAL_IMPROVEMENT_PLAN.md, Phase 1).
// New popup code should size itself through hooks/useModalSizing.js and these
// tokens rather than applyPopoverWidth()/MODAL_MAX_HEIGHT_GAP, which remain
// only for the not-yet-migrated call sites.

import { colors, hexColorToRGBa } from './global'

// Desktop width scale. Mobile ignores it — below MODAL_SHEET_BREAKPOINT every
// popup takes the full window width minus the edge gap.
export const MODAL_WIDTH_S = 320 // anchored pickers and menus
export const MODAL_WIDTH_M = 480 // forms
export const MODAL_WIDTH_L = 640 // large content
export const MODAL_WIDTH_XL = 800 // rich editors / widest surfaces

export const MODAL_WIDTHS = {
    S: MODAL_WIDTH_S,
    M: MODAL_WIDTH_M,
    L: MODAL_WIDTH_L,
    XL: MODAL_WIDTH_XL,
}

// Per-side gap between a popup and the viewport edge.
export const MODAL_EDGE_GAP = 16

// Where the two header project switchers pin their popover on mobile: far
// enough down to clear the app header, one edge gap in from the left. Measured
// from the top-left of the CONTENT area, so the safe-area insets are ADDED to
// it (see offsetPopoverInsideSafeArea in utils/popoverPositioning.js) rather
// than max()'d against it like the overlay padding.
export const HEADER_POPOVER_OFFSET = { top: 60, left: MODAL_EDGE_GAP }

// The fraction of the viewport those anchored header popovers may occupy.
// Previously expressed as a raw viewport-height unit, which is blind to the
// safe-area insets; resolve it through getSafeAreaViewportHeightCap instead.
export const HEADER_POPOVER_HEIGHT_FRACTION = 0.8

// Presentation breakpoint for the modal system: below this window width popups
// take the mobile presentation (full width now; bottom sheet from Phase 2).
// Deliberately a pure window-width check — `smallScreenNavigation` flips at
// 818px or 611px depending on `loggedUser.sidebarExpanded`, so a "mobile"
// decision based on it changes with user state, not viewport size.
export const MODAL_SHEET_BREAKPOINT = 640

export const MODAL_RADIUS = 4 // the dominant FloatModals container radius
export const MODAL_SHEET_RADIUS = 16 // top corners of the Phase 2 bottom sheet

export const MODAL_BACKDROP_COLOR = hexColorToRGBa(colors.Text03, 0.24)

export const MODAL_ENTER_MS = 180
export const MODAL_EXIT_MS = 120

export const MODAL_Z_BACKDROP = 9990
export const MODAL_Z_CONTENT = 10000

// The layer for a typeahead spawned from INSIDE a popup — today only the
// caret-anchored @-mention list (AT-2397). It must sit above MODAL_Z_CONTENT
// rather than beside it: the vendored popover library portals every popover to
// `document.body`, so the mention list and its host popup are SIBLINGS in the
// root stacking context, and DOM order does not decide the winner. A host that
// sets any z-index at all (the "Add task" popup uses 9999, the mobile
// BottomSheet MODAL_Z_CONTENT) paints over a sibling left at `z-index: auto` —
// which is what the mention portal got, because the vendored `createContainer`
// only ever sets overflow/position/top/left. Being nested in the React tree
// buys the popup nothing here.
export const MODAL_Z_AUTOCOMPLETE = 10500
