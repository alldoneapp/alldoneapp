import { useEffect, useState } from 'react'

import useWindowSize from '../utils/useWindowSize'
import { isKeyboardInsetOpen, measureKeyboardInset } from '../utils/virtualKeyboard'
import { getSafeAreaInsets } from '../utils/safeAreaInsets'
import { MODAL_EDGE_GAP, MODAL_SHEET_BREAKPOINT, MODAL_WIDTHS } from '../components/styles/modals'

const getOpenKeyboardInset = () => {
    const inset = measureKeyboardInset()
    return isKeyboardInsetOpen(inset) ? inset : 0
}

/**
 * Reactive, keyboard-aware popup sizing (MODAL_IMPROVEMENT_PLAN.md, Phase 1).
 *
 * Returns popup dimensions plus keyboard and safe-area insets.
 * - `isSheet`: window is below MODAL_SHEET_BREAKPOINT — mobile presentation.
 * - `width`: full window width minus the edge gap when `isSheet`, otherwise the
 *   requested size from the MODAL_WIDTHS scale, always clamped to the window.
 * - `maxHeight` fits inside the safe area and subtracts the *visual*-viewport keyboard inset: the app shell's
 *   `--app-keyboard-inset` shrink (utils/virtualKeyboard.js) cannot move a
 *   popup — popover portals are position:fixed against the viewport, and iOS
 *   never resizes the layout viewport for the keyboard — so popups must
 *   subtract the inset themselves. Android with
 *   `interactive-widget=resizes-content` shrinks window.innerHeight instead;
 *   there the inset measures ~0 and useWindowSize already reflects the shrink.
 *
 * Unlike applyPopoverWidth() this subscribes to resize and visualViewport
 * changes, so an open popup follows rotation and the keyboard.
 */
export default function useModalSizing({ size = 'M' } = {}) {
    const [windowWidth, windowHeight] = useWindowSize()
    const [keyboardInset, setKeyboardInset] = useState(getOpenKeyboardInset)

    useEffect(() => {
        const viewport = typeof window !== 'undefined' ? window.visualViewport : null
        if (!viewport) return
        const update = () => setKeyboardInset(getOpenKeyboardInset())
        viewport.addEventListener('resize', update)
        viewport.addEventListener('scroll', update)
        update()
        return () => {
            viewport.removeEventListener('resize', update)
            viewport.removeEventListener('scroll', update)
        }
    }, [])

    const isSheet = windowWidth < MODAL_SHEET_BREAKPOINT
    const safeAreaInsets = getSafeAreaInsets()
    // An open software keyboard already covers the bottom safe area; counting
    // both would leave an unnecessary gap above it.
    const bottomInset = keyboardInset > 0 ? keyboardInset : safeAreaInsets.bottom
    const availableWidth = windowWidth - safeAreaInsets.left - safeAreaInsets.right - MODAL_EDGE_GAP * 2
    const desiredWidth = isSheet ? availableWidth : MODAL_WIDTHS[size] || MODAL_WIDTHS.M
    const width = availableWidth > 0 ? Math.min(desiredWidth, availableWidth) : desiredWidth
    const maxHeight = Math.max(windowHeight - safeAreaInsets.top - bottomInset - MODAL_EDGE_GAP * 2, 0)

    return { width, maxHeight, isSheet, windowWidth, windowHeight, keyboardInset, safeAreaInsets }
}
