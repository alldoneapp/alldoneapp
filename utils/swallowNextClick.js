/**
 * Swallows the ONE trailing `click` that a mouse/pen press leaves behind, if it arrives within
 * `windowMs` (AT-2823).
 *
 * Used where a press-and-hold gesture already acted on the press (opened a popup on pointerup or
 * mid-hold) and the browser's synthesized click would otherwise act on it a second time — most
 * importantly as an "outside click" that dismisses the popup the hold just opened. The listener is
 * on `window` in the CAPTURE phase, which runs before every bubble-phase listener in the page,
 * including the vendored popover's window `click` dismissal and react-dom's root listeners.
 *
 * Consume-once with a short cap (the same shape as the nested-popover dismiss guard in
 * CLAUDE.md): a click that never arrives cannot linger and eat a genuine later click.
 * Never install it for a touch press — touch presses here are `preventDefault`ed and produce no
 * click, so the guard would only ever swallow the user's NEXT tap.
 *
 * @returns {() => void} removes the guard early.
 */
export function swallowNextClick(windowMs) {
    if (typeof window === 'undefined') return () => {}
    let timer = null
    const remove = () => {
        window.removeEventListener('click', onClick, true)
        if (timer) clearTimeout(timer)
        timer = null
    }
    const onClick = event => {
        remove()
        event.stopPropagation()
        event.preventDefault()
    }
    window.addEventListener('click', onClick, true)
    timer = setTimeout(remove, windowMs)
    return remove
}
