import { useEffect } from 'react'

import { revealElementInScrollParent } from '../utils/scrollUtils'

// Long enough for the editor to finish settling (initial text layout, the action
// bar, a title that wraps), short enough that it can never be mistaken for the
// app scrolling on its own later on.
const SETTLE_WINDOW_MS = 600

/**
 * Keep a just-opened inline editor fully visible in its scroll container.
 *
 * An inline task editor is several times taller than the line it replaces (a
 * ~34px title becomes a ~59px input plus a 55px action bar), so a line opened
 * near the bottom edge pushes its own input and buttons past the fold. Quill's
 * caret-level scroll-into-view does not help: the caret is at the TOP of the new
 * editor and is already visible, so nothing moves (AT-2220).
 *
 * This is deliberately the ONLY thing allowed to scroll the list when an editor
 * opens — Quill's own ancestor-walking scroll is confined to the editor in
 * `quill2Setup.js`. It moves by the smallest amount that makes the editor fit,
 * never when it already fits, and never past it.
 *
 * Two subtleties it has to survive:
 *  - the editor's height is not final on the first frame, so the correction is
 *    repeated while the element resizes, for a bounded window;
 *  - the user may start scrolling in that window, and must win — the first
 *    wheel/touch gesture ends it for good.
 */
export default function useRevealEditorOnOpen(elementRef, padding = 8) {
    useEffect(() => {
        const node = elementRef && elementRef.current
        if (!node || typeof window === 'undefined') return undefined

        let stopped = false
        const reveal = () => {
            if (!stopped) revealElementInScrollParent(node, padding)
        }

        const frame = window.requestAnimationFrame(reveal)
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(reveal) : null
        if (observer) observer.observe(node)

        const stop = () => {
            stopped = true
            if (observer) observer.disconnect()
        }
        const timer = setTimeout(stop, SETTLE_WINDOW_MS)
        window.addEventListener('wheel', stop, { passive: true })
        window.addEventListener('touchmove', stop, { passive: true })

        return () => {
            stop()
            clearTimeout(timer)
            window.cancelAnimationFrame(frame)
            window.removeEventListener('wheel', stop)
            window.removeEventListener('touchmove', stop)
        }
    }, [])
}
