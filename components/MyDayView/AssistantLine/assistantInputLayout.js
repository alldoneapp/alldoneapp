export const ASSISTANT_INPUT_MIN_HEIGHT = 40
export const ASSISTANT_INPUT_MAX_HEIGHT = 120

// Keep one line of tolerance when leaving scroll mode. Browser scrollbars can
// change the available text width and therefore report a slightly different
// content height after scrolling is enabled.
const ASSISTANT_INPUT_SCROLL_HYSTERESIS = 8

// Resist sub-line-height *shrinking* while the field is expanded. When the
// content sits right on a line-wrap boundary, applying a new height can nudge
// the editor's available text width by a pixel or two (reflow, an appearing
// gutter, rounding), which makes the browser re-wrap the last line and report a
// slightly smaller natural height on the next frame. Feeding that back shrinks
// the box, which re-wraps again, and the field "can't decide" — it wiggles.
// Growth is always applied immediately so a newly typed line is never clipped;
// only shrinking is damped, so any flap smaller than a line settles on the
// larger height instead of oscillating. The band is well under one line
// (lineHeight 22) so deleting a real line still collapses the field normally.
const ASSISTANT_INPUT_HEIGHT_HYSTERESIS = 8

export const INITIAL_ASSISTANT_INPUT_LAYOUT = {
    height: ASSISTANT_INPUT_MIN_HEIGHT,
    scrollEnabled: false,
}

// Geometry of the send/voice control cluster when it is stacked into a column:
// two 40px controls with an 8px gap between them.
export const ASSISTANT_CONTROL_BUTTON_SIZE = 40
export const ASSISTANT_CONTROL_STACK_GAP = 8
export const ASSISTANT_CONTROLS_STACKED_HEIGHT = ASSISTANT_CONTROL_BUTTON_SIZE * 2 + ASSISTANT_CONTROL_STACK_GAP

// Decide whether the voice + send cluster renders as a row (collapsed) or as a
// column with the two buttons directly below each other (expanded).
//
// Why this is a latch and not a plain `height > MIN` check:
//
// The cluster is a sibling of the flex:1 message input in the same row. When it
// stacks into a column it becomes ~48px NARROWER, which is exactly what we want
// — the input reclaims that space and expands accordingly. But a wider input
// re-wraps the text, so the measured content height can drop straight back to a
// single line. A naive `height > MIN` check would then un-stack, the cluster
// would widen, the input would narrow, the text would wrap again — and the
// field oscillates forever, "unable to decide" whether it wants to expand.
// Height-only hysteresis (see getAssistantInputLayout) cannot damp that,
// because the content *width*, and therefore the content height, genuinely
// changes every cycle.
//
// The loop is broken by making the un-stack condition independent of any
// width-sensitive measurement: once stacked, the cluster stays stacked until
// the field is EMPTY. An empty field is a single line at every width, so the
// release can never feed back into the wrapping. The cost is that deleting text
// down to one line keeps the taller composer until the last character is gone —
// deliberate, and far less jarring than a flapping layout.
export const getAssistantControlsStacked = ({ inputHeight, hasText, wasStacked = false }) => {
    // Grew past a single line: stack immediately so the buttons line up.
    if (Number.isFinite(inputHeight) && inputHeight > ASSISTANT_INPUT_MIN_HEIGHT) return true
    // Nothing typed: always return to the compact single-row layout.
    if (!hasText) return false
    // One line but text present: hold whatever we had, never flap.
    return wasStacked
}

// While stacked, the cluster is ASSISTANT_CONTROLS_STACKED_HEIGHT tall. Grow the
// input to at least that height so the two layouts are exactly the same height
// and the button column cannot overhang the field it belongs to.
//
// `maxHeight` is a parameter rather than the constant because a composer holding a dropped or
// pasted attachment is allowed to grow taller than a text-only one (AT-2444, see
// assistantComposerMedia.js). It defaults to the text cap, so every existing caller and every
// text-only render is unchanged.
export const getAssistantInputDisplayHeight = (inputHeight, isStacked, maxHeight = ASSISTANT_INPUT_MAX_HEIGHT) => {
    if (!Number.isFinite(inputHeight)) return ASSISTANT_INPUT_MIN_HEIGHT
    if (!isStacked) return inputHeight
    return Math.min(Math.max(inputHeight, ASSISTANT_CONTROLS_STACKED_HEIGHT), resolveMaxHeight(maxHeight))
}

const resolveMaxHeight = maxHeight =>
    Number.isFinite(maxHeight) && maxHeight >= ASSISTANT_INPUT_MIN_HEIGHT ? maxHeight : ASSISTANT_INPUT_MAX_HEIGHT

export const getAssistantInputLayout = (
    contentHeight,
    previousLayout = INITIAL_ASSISTANT_INPUT_LAYOUT,
    maxHeight = ASSISTANT_INPUT_MAX_HEIGHT
) => {
    if (!Number.isFinite(contentHeight) || contentHeight < 0) return previousLayout

    const effectiveMaxHeight = resolveMaxHeight(maxHeight)
    const roundedContentHeight = Math.ceil(contentHeight)
    const scrollEnabled = previousLayout.scrollEnabled
        ? roundedContentHeight > effectiveMaxHeight - ASSISTANT_INPUT_SCROLL_HYSTERESIS
        : roundedContentHeight > effectiveMaxHeight

    let height
    if (scrollEnabled) {
        height = effectiveMaxHeight
    } else {
        const targetHeight = Math.min(Math.max(ASSISTANT_INPUT_MIN_HEIGHT, roundedContentHeight), effectiveMaxHeight)
        const previousHeight = previousLayout.height

        if (targetHeight > previousHeight) {
            // Grow immediately — never clip freshly typed content.
            height = targetHeight
        } else if (targetHeight <= previousHeight - ASSISTANT_INPUT_HEIGHT_HYSTERESIS) {
            // Content clearly dropped below the current size (a whole line was
            // removed), so it is safe to collapse.
            height = targetHeight
        } else {
            // Within the hysteresis band: hold the current height so a
            // sub-line-height re-wrap can't start an expand/shrink oscillation.
            height = previousHeight
        }
    }

    if (height === previousLayout.height && scrollEnabled === previousLayout.scrollEnabled) return previousLayout

    return { height, scrollEnabled }
}
