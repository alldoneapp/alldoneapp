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

// Pin the send/voice control cluster to a stable width.
//
// The control cluster (voice + send buttons) is a sibling of the flex:1 message
// input in the same row. When the input expands it deliberately re-stacks those
// buttons from a row into a column, which makes the cluster *narrower*. Because
// the input is flex:1, a narrower cluster makes the input WIDER, the browser
// re-wraps the last line, the measured height drops back to one line, the field
// collapses, the cluster returns to a (wider) row, the input gets NARROWER, the
// text wraps again — and the field oscillates forever, "unable to decide" if it
// wants to expand. This width<->height feedback loop is the real cause of the
// wiggle; height-only hysteresis (see getAssistantInputLayout) cannot damp it
// because the content width, and therefore the content height, genuinely
// changes every cycle.
//
// The fix is to make the cluster's horizontal footprint invariant to the
// expanded state: measure the cluster once while it is collapsed (row layout)
// and keep that width when it stacks into a column. Only the collapsed
// measurement is authoritative — a measurement taken while expanded would
// capture the narrow column width and let the input widen again, re-arming the
// loop. Sub-pixel jitter is ignored so a stable layout returns the same value
// (no extra React state churn).
export const getStableControlsWidth = (measuredWidth, isExpanded, previousWidth = null) => {
    // While expanded the cluster is a column and reports its narrow width; never
    // trust it. Hold whatever width we captured in the row layout.
    if (isExpanded) return previousWidth
    if (!Number.isFinite(measuredWidth) || measuredWidth <= 0) return previousWidth

    // Compare the *raw* measurement (not the rounded one) against the pinned
    // width. Rounding first would treat 120.2px as 121px and flip the pin
    // 120<->121 on every sub-pixel layout jitter, re-arming exactly the kind of
    // micro-wiggle this helper exists to kill. Only a change of a full pixel or
    // more is a real resize worth adopting.
    if (previousWidth != null && Math.abs(measuredWidth - previousWidth) < 1) return previousWidth

    return Math.ceil(measuredWidth)
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
