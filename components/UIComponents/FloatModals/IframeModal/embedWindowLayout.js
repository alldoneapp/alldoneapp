import { useRef } from 'react'
import { StyleSheet } from 'react-native'

import { MODAL_EDGE_GAP, MODAL_SHEET_BREAKPOINT } from '../../../styles/modals'
import { colors, hexColorToRGBa } from '../../../styles/global'

/**
 * Shared layout of the two embed windows (IframeModal for pre-configured iframe apps, McpAppModal for
 * MCP Apps views), AT-2953.
 *
 * On a desktop/tablet viewport the app is a card that fills the viewport except for one uniform
 * MODAL_EDGE_GAP on every edge: no percentage size, no max size, so it never gains extra margin on a
 * tall or wide screen. Below MODAL_SHEET_BREAKPOINT (phones) the gap is 0 and the app fills the
 * screen, inside the safe area.
 *
 * A click on the backdrop next to the card closes the window. On phones there is no backdrop left to
 * click (the only uncovered strips are the safe-area insets around the notch and the home indicator,
 * where a stray tap must not close the app), so the X and Escape are the only ways to close there.
 */

export const isEmbedWindowFullscreen = windowWidth => windowWidth > 0 && windowWidth < MODAL_SHEET_BREAKPOINT

export const getEmbedWindowGap = fullscreen => {
    const gap = fullscreen ? 0 : MODAL_EDGE_GAP
    return { top: gap, right: gap, bottom: gap, left: gap }
}

/**
 * Props for the overlay element that close the window on a click on the backdrop itself.
 *
 * The press has to START on the backdrop as well as end there. That keeps two clicks from closing it:
 * a drag (e.g. a text selection in the header) released outside the card, and the click that opened
 * the window when it lands on the backdrop mounted under the pointer — its pointerdown happened
 * before the backdrop existed. Clicks inside the card bubble with a different target, and clicks
 * inside the embedded app never reach this document at all (the frame is cross-origin).
 */
export function useBackdropDismiss(onDismiss, { enabled = true } = {}) {
    const pressStartedOnBackdrop = useRef(false)
    if (!enabled) return {}
    return {
        onPointerDown: event => {
            pressStartedOnBackdrop.current = event.target === event.currentTarget
        },
        onClick: event => {
            const startedOnBackdrop = pressStartedOnBackdrop.current
            pressStartedOnBackdrop.current = false
            if (startedOnBackdrop && event.target === event.currentTarget) onDismiss()
        },
    }
}

export const embedWindowStyles = StyleSheet.create({
    overlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        flexDirection: 'column',
        alignItems: 'stretch',
        backgroundColor: hexColorToRGBa(colors.Text03, 0.24),
    },
    container: {
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        borderRadius: 12,
        boxShadow: '0px 8px 24px rgba(0,0,0,0.40)',
    },
    containerFullscreen: {
        borderRadius: 0,
        boxShadow: 'none',
    },
})
