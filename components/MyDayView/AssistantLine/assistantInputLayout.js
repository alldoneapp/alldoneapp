export const ASSISTANT_INPUT_MIN_HEIGHT = 40
export const ASSISTANT_INPUT_MAX_HEIGHT = 120

// Keep one line of tolerance when leaving scroll mode. Browser scrollbars can
// change the available text width and therefore report a slightly different
// content height after scrolling is enabled.
const ASSISTANT_INPUT_SCROLL_HYSTERESIS = 8

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
    const height = scrollEnabled
        ? ASSISTANT_INPUT_MAX_HEIGHT
        : Math.min(Math.max(ASSISTANT_INPUT_MIN_HEIGHT, roundedContentHeight), ASSISTANT_INPUT_MAX_HEIGHT)

    if (height === previousLayout.height && scrollEnabled === previousLayout.scrollEnabled) return previousLayout

    return { height, scrollEnabled }
}
