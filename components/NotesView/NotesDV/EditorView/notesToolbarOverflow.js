import { useCallback, useLayoutEffect, useRef, useState } from 'react'

/**
 * Responsive overflow for the note editor toolbar (AT-2427).
 *
 * The toolbar is a single non-wrapping flex row, and its groups cannot shrink below their
 * content (a row of fixed-width buttons has a min-content width equal to the sum of those
 * buttons), so the moment the row is wider than the bar the surplus simply spills past the
 * right edge — under the floating editor avatars, which is what the AT-2427 screenshot shows.
 *
 * Collapsing itself is NOT new: `TextMorePopup` / `TextFormatPopup` in `EditorToolbar.js`
 * already fold toolbar actions into a `ql-custom-popup` behind a single button. What was wrong
 * is the TRIGGER. Those popups appear on a fixed redux breakpoint (`smallScreenNavigation` /
 * `smallScreenNavSidebarCollapsed`, i.e. 611/818px of window width), a number that has nothing
 * to do with how wide the toolbar actually is. Every button added to the bar since then moved
 * the real overflow point further right without moving that breakpoint, which opens a band of
 * widths — roughly 819px and up on the reporting account — where the bar is too narrow for its
 * contents and nothing collapses.
 *
 * So the trigger here is a measurement of the rendered bar, not a width constant: the toolbar
 * collapses exactly when it would overflow and expands again as soon as it fits. That is also
 * why it cannot go stale — a button added later, a longer translation, a larger browser zoom or
 * a bigger default font all move the measurement, and none of them needs a constant re-tuned.
 *
 * The collapse is staged rather than boolean so the row degrades in a fixed, predictable order
 * (see the stage constants). One stage is applied per measurement pass and the measurement runs
 * in a layout effect, so a two-stage collapse still settles before the browser paints.
 */

/** Nothing is folded away: every control sits on the bar. */
export const TOOLBAR_STAGE_FULL = 0

/**
 * Everything after the Link button — insert file, numbered list, bulleted list, and the two
 * indent controls — moves into the "more" popup. Link itself stays on the bar.
 */
export const TOOLBAR_STAGE_ACTIONS = 1

/** Link joins them in the popup. This is what the bar has always done on phone widths. */
export const TOOLBAR_STAGE_LINK = 2

export const MAX_TOOLBAR_STAGE = TOOLBAR_STAGE_LINK

/**
 * Sub-pixel slack. Widths are fractional (flex layout, browser zoom), and a bar that is
 * 0.4px too narrow is not something a user can see — collapsing for it would only make the
 * toolbar twitchy at particular zoom levels.
 */
export const OVERFLOW_TOLERANCE_PX = 1

/**
 * Re-expanding needs strictly more room than collapsing freed, otherwise the two decisions meet
 * at the same width and the bar oscillates between them on every resize frame (collapse frees
 * room -> it fits -> expand -> it overflows -> collapse). The gap is what makes the state
 * machine convergent rather than merely usually-stable.
 */
export const EXPAND_HYSTERESIS_PX = 12

export const createToolbarOverflowState = (stage = TOOLBAR_STAGE_FULL) => ({
    stage,
    // Content width observed at each stage we have actually rendered. The width of the stage
    // ABOVE the current one is the only way to know whether expanding would fit again, since a
    // hidden group cannot be measured.
    widths: {},
})

const isUsableNumber = value => typeof value === 'number' && isFinite(value) && value >= 0

/**
 * The state machine, kept pure and separate from the DOM so the interesting part — when the bar
 * collapses, when it comes back, and that it cannot flap — is testable without a layout engine.
 *
 * Returns the same object when nothing changes so callers can skip a re-render cheaply.
 */
export const nextToolbarOverflowState = (state, { availableWidth, contentWidth, minStage, maxStage } = {}) => {
    const floor = isUsableNumber(minStage) ? Math.min(minStage, MAX_TOOLBAR_STAGE) : TOOLBAR_STAGE_FULL
    const ceiling = isUsableNumber(maxStage) ? Math.min(maxStage, MAX_TOOLBAR_STAGE) : MAX_TOOLBAR_STAGE

    // A forced floor (today's phone breakpoints) always wins, and it applies even when the bar
    // has not been measured yet — that is what keeps the first paint on a phone from flashing an
    // overflowing toolbar before the measurement lands.
    if (state.stage < floor) return { stage: floor, widths: state.widths }

    // An unmeasurable bar (not laid out yet, display:none, jsdom) must never move the stage: a
    // zero-width reading would otherwise read as "everything overflows" and collapse the bar of
    // every user whose toolbar happens to be measured a frame too early.
    if (!isUsableNumber(availableWidth) || availableWidth <= 0 || !isUsableNumber(contentWidth) || contentWidth <= 0) {
        return state
    }

    const widths = { ...state.widths, [state.stage]: contentWidth }

    if (contentWidth > availableWidth + OVERFLOW_TOLERANCE_PX && state.stage < ceiling) {
        return { stage: state.stage + 1, widths }
    }

    if (state.stage > floor) {
        const previousWidth = widths[state.stage - 1]
        if (isUsableNumber(previousWidth) && previousWidth + EXPAND_HYSTERESIS_PX <= availableWidth) {
            return { stage: state.stage - 1, widths }
        }
    }

    return { ...state, widths }
}

/**
 * Read the bar's available width and the width its contents actually occupy.
 *
 * The content width is the right edge of the bar's own toolbar groups, NOT `scrollWidth`.
 * `scrollWidth` looks like the obvious reading and is the wrong one here for two independent
 * reasons: the toolbar container sets `overflow: visible !important`, where how much
 * right-overflow a box reports has historically varied between engines; and the scrollable
 * overflow region also counts absolutely positioned descendants, so simply OPENING the "more"
 * menu — a 180px card anchored near the right end of the bar — would read as the bar suddenly
 * overflowing and collapse the row the user is interacting with. The groups are in-flow flex
 * items that cannot shrink below their buttons, so their rects are both accurate and stable.
 *
 * `scrollWidth` stays as the fallback for an element that reports no children at all.
 */
export const measureToolbarWidths = element => {
    if (!element || typeof element.getBoundingClientRect !== 'function') return null

    const rect = element.getBoundingClientRect()
    const availableWidth =
        isUsableNumber(element.clientWidth) && element.clientWidth > 0 ? element.clientWidth : rect.width

    let contentWidth = 0
    let measuredAnyChild = false
    const children = element.children || []
    for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (!child || typeof child.getBoundingClientRect !== 'function') continue
        const childRect = child.getBoundingClientRect()
        // A folded-away group is `display: none` and reports an empty rect; it must not count,
        // or the collapsed bar would still measure as overflowing and never come back.
        if (!childRect || (childRect.width === 0 && childRect.height === 0)) continue
        measuredAnyChild = true
        contentWidth = Math.max(contentWidth, childRect.right - rect.left)
    }

    if (!measuredAnyChild && isUsableNumber(element.scrollWidth)) contentWidth = element.scrollWidth

    return { availableWidth, contentWidth }
}

/**
 * Drive the stage from the live bar.
 *
 * `signature` names the set of controls currently rendered (access, labels, the recording
 * banner, ...). When it changes the remembered widths describe a bar that no longer exists, so
 * they are dropped and the row is re-measured from fully expanded — the only way a bar that lost
 * a button can discover it has room again.
 */
export const useNotesToolbarOverflow = ({
    minStage = TOOLBAR_STAGE_FULL,
    maxStage = MAX_TOOLBAR_STAGE,
    signature = '',
} = {}) => {
    const elementRef = useRef(null)
    const stateRef = useRef(createToolbarOverflowState(minStage))
    const signatureRef = useRef(signature)
    const [stage, setStage] = useState(stateRef.current.stage)

    const measure = useCallback(() => {
        const measurement = measureToolbarWidths(elementRef.current) || {}
        const next = nextToolbarOverflowState(stateRef.current, { ...measurement, minStage, maxStage })
        stateRef.current = next
        setStage(current => (current === next.stage ? current : next.stage))
    }, [minStage, maxStage])

    useLayoutEffect(() => {
        if (signatureRef.current !== signature) {
            signatureRef.current = signature
            const resetStage = Math.max(minStage, TOOLBAR_STAGE_FULL)
            stateRef.current = createToolbarOverflowState(resetStage)
            if (resetStage !== stage) {
                // Re-render at the reset stage first; this effect runs again against the bar the
                // user will actually see and measures it there. Measuring the old stage now would
                // file that width under the new one.
                setStage(resetStage)
                return
            }
            // Already at the reset stage, so there is nothing to re-render and nothing would
            // bring us back here - measure right away rather than waiting for the next resize.
        }
        // Keep the machine's idea of the rendered stage in step with what React just rendered:
        // a floor/ceiling change can move the stage without a measurement.
        if (stateRef.current.stage !== stage) stateRef.current = { ...stateRef.current, stage }
        measure()
    }, [signature, stage, minStage, maxStage, measure])

    useLayoutEffect(() => {
        const element = elementRef.current
        if (!element || typeof window === 'undefined') return undefined

        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
        if (observer) observer.observe(element)
        // The bar can be resized by the sidebar collapsing rather than by the window, hence the
        // observer; the window listener is the fallback for browsers without one.
        window.addEventListener('resize', measure)

        return () => {
            if (observer) observer.disconnect()
            window.removeEventListener('resize', measure)
        }
    }, [measure])

    return {
        toolbarRef: elementRef,
        stage,
        collapseActions: stage >= TOOLBAR_STAGE_ACTIONS,
        collapseLink: stage >= TOOLBAR_STAGE_LINK,
    }
}
