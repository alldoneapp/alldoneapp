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

export const getAssistantInputLayout = (contentHeight, previousLayout = INITIAL_ASSISTANT_INPUT_LAYOUT) => {
    if (!Number.isFinite(contentHeight) || contentHeight < 0) return previousLayout

    const roundedContentHeight = Math.ceil(contentHeight)
    const scrollEnabled = previousLayout.scrollEnabled
        ? roundedContentHeight > ASSISTANT_INPUT_MAX_HEIGHT - ASSISTANT_INPUT_SCROLL_HYSTERESIS
        : roundedContentHeight > ASSISTANT_INPUT_MAX_HEIGHT

    let height
    if (scrollEnabled) {
        height = ASSISTANT_INPUT_MAX_HEIGHT
    } else {
        const targetHeight = Math.min(
            Math.max(ASSISTANT_INPUT_MIN_HEIGHT, roundedContentHeight),
            ASSISTANT_INPUT_MAX_HEIGHT
        )
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
