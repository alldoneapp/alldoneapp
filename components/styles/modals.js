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
