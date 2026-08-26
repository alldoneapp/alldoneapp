// Chat fullscreen is driven by scroll position: sitting at either edge of the thread keeps the
// normal layout, and scrolling into the middle hands the chrome's space (tag list + navigation
// bar) to the messages. This mirrors the note editor's scroll-driven fullscreen
// (`updateScreenMode` in NotesEditorView) with one difference that matters: a note is anchored
// at its top, so a single "how far down have we scrolled" threshold describes it, while a chat
// is anchored at its BOTTOM and therefore has two resting positions — newest message and
// beginning of the thread — both of which must show the normal layout.
//
// Enter and exit use different thresholds on purpose. Entering fullscreen removes chrome, which
// makes the scroll viewport taller and so moves the current position closer to the bottom by the
// chrome's height; without that gap the freshly-entered state would immediately satisfy the exit
// condition and the layout would oscillate. The gap is comfortably larger than the chrome the DV
// headers drop (tag list + navigation bar, minus the bot line they add back).

export const CHAT_FULLSCREEN_TOLERANCE_MOBILE = 120
export const CHAT_FULLSCREEN_TOLERANCE_TABLET = 160
export const CHAT_FULLSCREEN_TOLERANCE_DESKTOP = 200

export const CHAT_NORMAL_TOLERANCE_MOBILE = 32
export const CHAT_NORMAL_TOLERANCE_TABLET = 40
export const CHAT_NORMAL_TOLERANCE_DESKTOP = 48

// Same cooldown the note editor uses: a layout change re-fires onScroll, and momentum scrolling
// delivers events every frame, so a switch is never allowed to chase its own consequences.
export const CHAT_FULLSCREEN_COOLDOWN_MS = 300

export const CHAT_EDGE_TOP = 'top'
export const CHAT_EDGE_BOTTOM = 'bottom'

export const getChatFullscreenTolerances = ({ mobile, tablet } = {}) => ({
    enter: mobile
        ? CHAT_FULLSCREEN_TOLERANCE_MOBILE
        : tablet
          ? CHAT_FULLSCREEN_TOLERANCE_TABLET
          : CHAT_FULLSCREEN_TOLERANCE_DESKTOP,
    exit: mobile ? CHAT_NORMAL_TOLERANCE_MOBILE : tablet ? CHAT_NORMAL_TOLERANCE_TABLET : CHAT_NORMAL_TOLERANCE_DESKTOP,
})

/**
 * Shared by the fullscreen switch and the auto-scroll pin (`chatAutoScroll.js`) so both read the
 * same geometry from one clamped source — they answer different questions about the same two
 * distances, and a second copy of the overscroll clamp below is exactly how they would drift.
 */
export const getChatScrollDistances = ({ scrollY, contentHeight, viewportHeight }) => {
    const maxScroll = Math.max(0, (contentHeight || 0) - (viewportHeight || 0))
    // Web overscroll (rubber banding) reports positions outside the range; clamp so a bounce at
    // the bottom cannot read as "somewhere in the middle".
    const distanceFromTop = Math.min(Math.max(scrollY || 0, 0), maxScroll)
    return { distanceFromTop, distanceFromBottom: maxScroll - distanceFromTop }
}

/**
 * Names the resting position the reader is sitting at, or `null` in the middle of the thread.
 */
export const getChatEdgeAtPosition = ({ scrollY, contentHeight, viewportHeight, exit }) => {
    const { distanceFromTop, distanceFromBottom } = getChatScrollDistances({ scrollY, contentHeight, viewportHeight })

    // Bottom first: with a thread too short to scroll both distances are 0, and the newest
    // message is the resting position a chat belongs at.
    if (distanceFromBottom <= exit) return CHAT_EDGE_BOTTOM
    if (distanceFromTop <= exit) return CHAT_EDGE_TOP
    return null
}

/**
 * Decides whether a scroll position should switch the chat layout.
 *
 * Returns `null` when nothing should change, or `{ fullscreen, edge }` where `edge` names the
 * thread edge that caused an exit, so the caller can re-anchor to it once the chrome is back.
 */
export const resolveChatFullscreenChange = ({ scrollY, contentHeight, viewportHeight, isFullscreen, enter, exit }) => {
    if (isFullscreen) {
        const edge = getChatEdgeAtPosition({ scrollY, contentHeight, viewportHeight, exit })
        return edge ? { fullscreen: false, edge } : null
    }

    const { distanceFromTop, distanceFromBottom } = getChatScrollDistances({ scrollY, contentHeight, viewportHeight })
    // Requiring both distances implicitly requires a thread longer than 2x the tolerance, so a
    // barely-scrollable chat never expands.
    if (distanceFromTop > enter && distanceFromBottom > enter) return { fullscreen: true, edge: null }
    return null
}
