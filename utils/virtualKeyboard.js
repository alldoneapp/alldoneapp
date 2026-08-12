import { findScrollParent, revealRectInScrollParent } from './scrollUtils'

/**
 * Keep the focused input visible when the mobile virtual keyboard opens (AT-2248).
 *
 * The problem: on mobile web the keyboard does NOT resize the layout viewport on
 * iOS Safari (and, without `interactive-widget=resizes-content`, not on Android
 * either). It covers the bottom of the page instead. The app shell is bound to
 * the LAYOUT viewport (`html, body, #root { height: 100% }`, AT-2177), so every
 * inner `CustomScrollView` keeps its full-height geometry and happily believes a
 * composer sitting behind the keyboard is "visible". Tapping a field near the
 * bottom therefore left the user typing into something they could not see.
 *
 * The fix is two halves, and both are needed:
 *
 *  1. SHRINK THE SHELL. `visualViewport` reports how much of the layout viewport
 *     the keyboard covers; that number is published as the `--app-keyboard-inset`
 *     custom property plus an `app-keyboard-open` class on <html>, and the two
 *     web templates shrink the shell by it. This is what makes every inner
 *     scroller's `clientHeight` shrink to the ACTUALLY visible area, which in
 *     turn is what lets a normal, minimal scroll correction work at all — and it
 *     lifts fixed/bottom-anchored composers above the keyboard for free.
 *
 *  2. REVEAL THE FOCUSED INPUT. Shrinking alone does not move a field that is
 *     already below the fold, so after the geometry settles the focused input is
 *     revealed inside its own scroll container by the SMALLEST movement that
 *     makes it fit — never when it already fits, never past it, and never by
 *     scrolling the document (which would drag the top bar and sidebar away,
 *     AT-2177). For a tall multiline / contenteditable editor the CARET is
 *     followed rather than the box, because a Quill composer can be entirely
 *     visible while the line being typed on is behind the keyboard.
 *
 * Deliberately NOT `scrollIntoView()`: it walks every scrollable ancestor and
 * centres the target, which is exactly the disruptive jump AT-2220 removed from
 * Quill. Everything here goes through `revealRectInScrollParent`, which moves one
 * scroller by the minimum delta and does nothing when nothing is needed.
 */

// The reveal margin: enough that the field does not sit flush against the
// keyboard, small enough that the correction reads as "it just stayed visible"
// rather than a jump. Deliberately at the low end of the 8–16px band.
export const KEYBOARD_REVEAL_MARGIN_PX = 12

// Below this, the visual viewport shrank for some other reason — the collapsing
// URL bar on mobile Safari/Chrome is 40–90px — and must not be mistaken for a
// keyboard, or the shell would shrink while the user is only scrolling.
export const KEYBOARD_OPEN_MIN_INSET_PX = 120

export const KEYBOARD_INSET_CSS_VAR = '--app-keyboard-inset'
export const KEYBOARD_OPEN_CLASS = 'app-keyboard-open'

// The keyboard animates in over ~250ms and the visual viewport reports its size
// repeatedly while it does, so a single measurement lands mid-animation. Re-run
// the reveal across the animation instead; each pass is a no-op once the field
// fits, so the extra passes cost nothing and cannot over-scroll.
const SETTLE_DELAYS_MS = [0, 120, 300]

// One scroll container is usually enough, but a caret can live inside a nested
// scroller (Quill's own `.ql-editor` inside a `CustomScrollView`). Walk a couple
// of levels so both get the minimal correction; bounded so a pathological DOM
// cannot spin.
const MAX_SCROLLER_DEPTH = 3

const NON_TEXT_INPUT_TYPES = new Set([
    'button',
    'checkbox',
    'color',
    'file',
    'hidden',
    'image',
    'radio',
    'range',
    'reset',
    'submit',
])

/**
 * How many pixels of the layout viewport the virtual keyboard covers.
 *
 * Measured against `window.innerHeight` and NOT `documentElement.clientHeight`:
 * the shrink half of this feature changes the height of <html>, so measuring the
 * document would feed the correction back into its own input and oscillate the
 * shell open/closed. `window.innerHeight` is the layout viewport and is immune to
 * that. On a browser that resizes the layout viewport itself (Android Chrome with
 * `interactive-widget=resizes-content`) this correctly reports ~0 and the CSS
 * half stays out of the way.
 */
export const measureKeyboardInset = () => {
    if (typeof window === 'undefined') return 0
    const viewport = window.visualViewport
    if (!viewport) return 0

    const layoutHeight = window.innerHeight
    if (!layoutHeight) return 0

    const inset = layoutHeight - (viewport.height + viewport.offsetTop)
    return inset > 0 ? Math.round(inset) : 0
}

export const isKeyboardInsetOpen = inset => inset >= KEYBOARD_OPEN_MIN_INSET_PX

/**
 * The second way a keyboard shows up, and the reason the inset alone is not
 * enough: Android Chrome honours `interactive-widget=resizes-content` (set in
 * both web templates) and shrinks the LAYOUT viewport itself. The shell is then
 * already the right size — nothing to shrink, and `measureKeyboardInset()`
 * correctly reports ~0 — but the focused field still needs revealing, so the
 * keyboard has to be recognised as open all the same.
 *
 * The baseline is the layout height last seen with nothing editable focused, so
 * moving between two fields while the keyboard stays up keeps reporting open.
 */
export const isLayoutViewportShrunk = (baselineHeight, layoutHeight) =>
    !!baselineHeight && !!layoutHeight && baselineHeight - layoutHeight >= KEYBOARD_OPEN_MIN_INSET_PX

/**
 * Publish the inset to CSS. Returns whether the keyboard counts as open.
 */
export const applyKeyboardInset = inset => {
    if (typeof document === 'undefined' || !document.documentElement) return false

    const open = isKeyboardInsetOpen(inset)
    const root = document.documentElement
    root.style.setProperty(KEYBOARD_INSET_CSS_VAR, `${open ? inset : 0}px`)
    if (open) root.classList.add(KEYBOARD_OPEN_CLASS)
    else root.classList.remove(KEYBOARD_OPEN_CLASS)
    return open
}

/**
 * `isContentEditable` alone is not enough: it is the inherited, computed flag and
 * the attribute is the declared one. Quill's focus target (`.ql-editor`) carries
 * the attribute directly, and jsdom implements the attribute but not the
 * property — so both are checked, which also keeps this unit-testable.
 */
export const isContentEditableElement = element => {
    if (!element || element.nodeType !== 1) return false
    if (element.isContentEditable) return true
    if (typeof element.getAttribute !== 'function') return false

    const attribute = element.getAttribute('contenteditable')
    return attribute === '' || attribute === 'true' || attribute === 'plaintext-only'
}

export const isEditableElement = element => {
    if (!element || element.nodeType !== 1) return false
    if (isContentEditableElement(element)) return true

    const tagName = element.tagName
    if (tagName === 'TEXTAREA') return true
    if (tagName !== 'INPUT') return false

    const type = (element.getAttribute('type') || 'text').toLowerCase()
    return !NON_TEXT_INPUT_TYPES.has(type)
}

/**
 * The caret's client rect inside a contenteditable, or null when it cannot be
 * resolved (no selection, a selection in another element, or a browser that
 * returns nothing for a collapsed range). Native <input>/<textarea> expose no
 * caret geometry at all, so those always fall back to the element box.
 */
export const getCaretRect = element => {
    if (typeof window === 'undefined' || !isContentEditableElement(element)) return null
    if (typeof window.getSelection !== 'function') return null

    const selection = window.getSelection()
    if (!selection || !selection.rangeCount) return null

    const range = selection.getRangeAt(0)
    if (!range || !element.contains(range.startContainer)) return null

    const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : null
    let rect = rects && rects.length ? rects[rects.length - 1] : null
    if ((!rect || !rect.height) && typeof range.getBoundingClientRect === 'function') {
        rect = range.getBoundingClientRect()
    }
    return rect && rect.height ? rect : null
}

/**
 * What actually has to be on screen.
 *
 * A field that fits in the visible area is revealed whole — showing only the
 * caret of a two-line task input would leave its action bar hidden, which is the
 * AT-2220 complaint in miniature. Only when the editor is taller than the space
 * the keyboard left does it fall back to following the caret.
 */
export const resolveRevealRect = (element, scroller, margin = KEYBOARD_REVEAL_MARGIN_PX) => {
    const elementRect = element.getBoundingClientRect()
    const visibleHeight = (scroller ? scroller.clientHeight : 0) - margin * 2
    if (visibleHeight > 0 && elementRect.height <= visibleHeight) return elementRect

    return getCaretRect(element) || elementRect
}

/**
 * Reveal the focused input (or its caret) inside its scroll container(s).
 *
 * @returns total pixels scrolled — 0 when it was already visible, which is the
 *          common case and the reason this is safe to run on every keystroke.
 */
export const revealFocusedInput = (element, margin = KEYBOARD_REVEAL_MARGIN_PX) => {
    if (typeof window === 'undefined' || !isEditableElement(element)) return 0
    if (typeof element.getBoundingClientRect !== 'function') return 0

    let node = element
    let scrolled = 0
    for (let depth = 0; depth < MAX_SCROLLER_DEPTH; depth++) {
        const scroller = findScrollParent(node)
        if (!scroller) break

        // Recomputed per level: the previous level's scroll already moved the
        // rect, so a cached one would over-correct here.
        const rect = resolveRevealRect(element, scroller, margin)
        scrolled += revealRectInScrollParent(scroller, rect, margin)
        node = scroller
    }
    return scrolled
}

/**
 * Undo the browser's own keyboard avoidance.
 *
 * iOS Safari scrolls the LAYOUT viewport to bring a focused field above the
 * keyboard. Once the shell is shrunk that is both unnecessary and harmful: the
 * app already fits, so the only thing the document scroll does is push the top
 * bar and the sidebar off screen (AT-2177). Only ever scrolls back to 0, never
 * further down, and only while the keyboard is open.
 *
 * Assignment rather than `scrollTo()` on purpose — `html { scroll-behavior:
 * smooth }` would animate the correction and show the very jump being suppressed.
 */
export const resetDocumentScrollForKeyboard = () => {
    if (typeof document === 'undefined') return
    const holders = new Set([document.scrollingElement, document.documentElement, document.body])
    holders.forEach(holder => {
        if (holder && holder.scrollTop > 0) holder.scrollTop = 0
    })
}

/**
 * Install the whole thing. Returns a teardown function.
 *
 * A no-op without `visualViewport` — every desktop browser the app supports has
 * it, and the ones that do not (or have no keyboard) are left exactly as they
 * were rather than guessing at keyboard geometry from resize events.
 */
export const startVirtualKeyboardViewport = ({ margin = KEYBOARD_REVEAL_MARGIN_PX } = {}) => {
    const noop = () => {}
    if (typeof window === 'undefined' || typeof document === 'undefined') return noop

    const viewport = window.visualViewport
    if (!viewport || typeof viewport.addEventListener !== 'function') return noop

    let disposed = false
    let keyboardOpen = false
    let revealFrame = null
    let baselineLayoutHeight = window.innerHeight
    const timers = new Set()

    const revealNow = () => {
        revealFrame = null
        if (disposed || !keyboardOpen) return
        const active = document.activeElement
        if (isEditableElement(active)) revealFocusedInput(active, margin)
    }

    // Coalesced to one pass per frame: `selectionchange` and `input` both fire on
    // a single keystroke, and the reveal is idempotent anyway.
    const scheduleReveal = () => {
        if (disposed || revealFrame !== null) return
        revealFrame =
            typeof window.requestAnimationFrame === 'function'
                ? window.requestAnimationFrame(revealNow)
                : setTimeout(revealNow, 16)
    }

    const scheduleSettlingReveals = () => {
        SETTLE_DELAYS_MS.forEach(delay => {
            const timer = setTimeout(() => {
                timers.delete(timer)
                scheduleReveal()
            }, delay)
            timers.add(timer)
        })
    }

    const syncViewport = () => {
        if (disposed) return

        const editing = isEditableElement(document.activeElement)
        // With nothing focused there is no keyboard, so this is the honest
        // full-height reading to compare later shrinks against.
        if (!editing) baselineLayoutHeight = window.innerHeight

        const wasOpen = keyboardOpen
        const insetOpen = applyKeyboardInset(measureKeyboardInset())
        keyboardOpen = insetOpen || (editing && isLayoutViewportShrunk(baselineLayoutHeight, window.innerHeight))
        if (!keyboardOpen) return

        // Once per opening, and only when the shell itself was shrunk. Both
        // limits matter: the visual viewport also reports resizes and scrolls
        // WHILE the keyboard is up, and zeroing the document on each of those
        // would fight a user scrolling a screen that has no inner scroller (the
        // `body { overflow-y: auto }` safety valve). If the browser resized the
        // layout viewport itself it is managing that scroll, so leave it alone.
        if (insetOpen && !wasOpen) resetDocumentScrollForKeyboard()
        scheduleSettlingReveals()
    }

    const onFocusIn = event => {
        if (!isEditableElement(event.target)) return
        // Focus can precede the keyboard (first tap) or follow it (moving between
        // fields while it is already up). The settling passes cover both, and the
        // keyboard-open guard in `revealNow` discards the pointless ones.
        scheduleSettlingReveals()
    }

    const onCaretMoved = () => {
        if (!keyboardOpen) return
        scheduleReveal()
    }

    viewport.addEventListener('resize', syncViewport)
    viewport.addEventListener('scroll', syncViewport)
    document.addEventListener('focusin', onFocusIn, true)
    // Follow the caret while typing. Both are needed: Safari/Chrome fire
    // `selectionchange` for contenteditable, while `input` is the dependable one
    // for <textarea>. Each ends in the same no-op-when-visible reveal.
    document.addEventListener('selectionchange', onCaretMoved)
    document.addEventListener('input', onCaretMoved, true)

    syncViewport()

    return () => {
        if (disposed) return
        disposed = true
        viewport.removeEventListener('resize', syncViewport)
        viewport.removeEventListener('scroll', syncViewport)
        document.removeEventListener('focusin', onFocusIn, true)
        document.removeEventListener('selectionchange', onCaretMoved)
        document.removeEventListener('input', onCaretMoved, true)
        timers.forEach(clearTimeout)
        timers.clear()
        if (revealFrame !== null && typeof window.cancelAnimationFrame === 'function') {
            window.cancelAnimationFrame(revealFrame)
        }
        revealFrame = null
        applyKeyboardInset(0)
    }
}
