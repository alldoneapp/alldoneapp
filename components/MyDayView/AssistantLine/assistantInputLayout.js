// The assistant line's text field: two 24px lines plus 4px padding above and below at rest, six
// lines before it scrolls. The + / mic / call / send controls live in a toolbar below the text, so
// the field's height never depends on them and nothing beside it has to stack.
export const ASSISTANT_INPUT_LINE_HEIGHT = 24
export const ASSISTANT_INPUT_VERTICAL_PADDING = 8
export const ASSISTANT_INPUT_MIN_HEIGHT = ASSISTANT_INPUT_LINE_HEIGHT * 2 + ASSISTANT_INPUT_VERTICAL_PADDING
export const ASSISTANT_INPUT_MAX_HEIGHT = ASSISTANT_INPUT_LINE_HEIGHT * 6 + ASSISTANT_INPUT_VERTICAL_PADDING

// The composer box around the field: the toolbar's 36px controls, the gaps and the box's own
// padding and border. The skeleton reserves exactly this so the line does not jump on load.
export const ASSISTANT_TOOLBAR_CONTROL_SIZE = 36
export const ASSISTANT_COMPOSER_BOX_PADDING_TOP = 8
export const ASSISTANT_COMPOSER_BOX_PADDING_BOTTOM = 6
export const ASSISTANT_COMPOSER_TOOLBAR_GAP = 4
export const ASSISTANT_COMPOSER_BOX_RESTING_HEIGHT =
    1 +
    ASSISTANT_COMPOSER_BOX_PADDING_TOP +
    ASSISTANT_INPUT_MIN_HEIGHT +
    ASSISTANT_COMPOSER_TOOLBAR_GAP +
    ASSISTANT_TOOLBAR_CONTROL_SIZE +
    ASSISTANT_COMPOSER_BOX_PADDING_BOTTOM +
    1

// The compact header: a 32px avatar on one line with the name and greeting.
export const ASSISTANT_HEADER_HEIGHT = 32
export const ASSISTANT_HEADER_GAP = 12

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
// (lineHeight 24) so deleting a real line still collapses the field normally.
const ASSISTANT_INPUT_HEIGHT_HYSTERESIS = 8

export const INITIAL_ASSISTANT_INPUT_LAYOUT = {
    height: ASSISTANT_INPUT_MIN_HEIGHT,
    scrollEnabled: false,
}

// `maxHeight` is a parameter rather than the constant because a composer holding a dropped or
// pasted attachment is allowed to grow taller than a text-only one (AT-2444, see
// assistantComposerMedia.js). It defaults to the text cap.
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
