export const scrollDocumentToTop = () => {
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
        window.scrollTo(0, 0)
    }

    if (typeof document === 'undefined') return

    const scrollContainers = new Set([document.scrollingElement, document.documentElement, document.body])
    scrollContainers.forEach(container => {
        if (container) {
            container.scrollTop = 0
            container.scrollLeft = 0
        }
    })
}

export const scrollRefToTop = scrollRef => {
    const scrollTarget = scrollRef?.current
    if (!scrollTarget) return

    if (typeof Element !== 'undefined' && scrollTarget instanceof Element) {
        scrollTarget.scrollTop = 0
        scrollTarget.scrollLeft = 0
    } else if (typeof scrollTarget.scrollTo === 'function') {
        scrollTarget.scrollTo({ x: 0, y: 0, animated: false })
    }
}

export const resetDetailedViewScroll = scrollRef => {
    scrollDocumentToTop()
    scrollRefToTop(scrollRef)
}

const isScrollableElement = element => {
    if (typeof window === 'undefined' || !element || !element.ownerDocument) return false
    const overflowY = window.getComputedStyle(element).overflowY
    return (overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight - element.clientHeight > 1
}

/**
 * Nearest ancestor that actually scrolls, or null. Deliberately stops at
 * `document.body`: the app shell binds itself to the viewport (AT-2177), so a
 * pane that wants revealing always has an inner scroller, and moving the
 * document instead would drag the top bar and the sidebar off screen.
 */
export const findScrollParent = element => {
    if (typeof document === 'undefined' || !element) return null
    for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
        if (isScrollableElement(node)) return node
    }
    return null
}

/**
 * Scroll `element`'s nearest scroll container by the SMALLEST amount that makes
 * the element fully visible — and not at all when it already is.
 *
 * This is the deliberate counterpart to the scroll suppression in
 * `quill2Setup.js` (AT-2220). An inline task editor is several times taller than
 * the row it replaces (a ~34px title line becomes a ~59px input plus a 55px
 * action bar), so a row opened near the bottom edge pushes its own input and
 * buttons past the fold. Quill's caret-level scroll-into-view does not help
 * there: the caret is at the TOP of the new editor and is already visible, so
 * nothing moves and the user is left typing into a field hanging off the screen.
 *
 * Only ever moves toward the element, never past it, and never at all when the
 * element already fits — so it cannot produce the over-scroll it exists to
 * avoid. Applied by assignment rather than `scrollTo`, so `scroll-behavior:
 * smooth` cannot turn a 40px correction into a visible glide.
 *
 * @returns the number of pixels actually scrolled (0 when nothing was needed).
 */
export const revealElementInScrollParent = (element, padding = 0) => {
    if (typeof window === 'undefined' || !element || typeof element.getBoundingClientRect !== 'function') return 0

    const scroller = findScrollParent(element)
    if (!scroller) return 0

    return revealRectInScrollParent(scroller, element.getBoundingClientRect(), padding)
}

/**
 * The rect-level half of `revealElementInScrollParent`, split out so a caller can
 * reveal something that is not an element: the CARET of a multiline or
 * contenteditable input (AT-2248). A tall Quill composer can be fully visible
 * while the line being typed on is under the virtual keyboard, so the mobile
 * keyboard handler follows the caret rect instead of the input's box.
 *
 * Same guarantees as the element version, which are the whole point of not using
 * `scrollIntoView`: it moves by the smallest amount that makes `rect` fit, only
 * ever toward it, never past it, never at all when it already fits, and never
 * walks up beyond the one scroller it was given. Applied by assignment rather
 * than `scrollTo`, so `scroll-behavior: smooth` cannot animate the correction.
 *
 * @returns the number of pixels actually scrolled (0 when nothing was needed).
 */
export const revealRectInScrollParent = (scroller, rect, padding = 0) => {
    if (typeof window === 'undefined' || !scroller || !rect) return 0
    if (typeof scroller.getBoundingClientRect !== 'function') return 0
    if (!rect.height && !rect.width) return 0

    const scrollerRect = scroller.getBoundingClientRect()
    const visibleTop = scrollerRect.top + padding
    const visibleBottom = scrollerRect.top + scroller.clientHeight - padding

    let delta = 0
    if (rect.bottom > visibleBottom) {
        // Never push the top out of view in order to reveal the bottom: a rect
        // taller than the visible area is aligned to the top instead.
        delta = Math.min(rect.bottom - visibleBottom, Math.max(0, rect.top - visibleTop))
    } else if (rect.top < visibleTop) {
        delta = rect.top - visibleTop
    }
    if (!delta) return 0

    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    const target = Math.max(0, Math.min(scroller.scrollTop + delta, maxScrollTop))
    const applied = target - scroller.scrollTop
    if (!applied) return 0

    scroller.scrollTop = target
    return applied
}
