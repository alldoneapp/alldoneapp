/**
 * Where Anna takes off from and lands again: the assistant's avatar in the same assistant line as
 * the crosshair. The avatar's wrapper carries this DOM id (react-native-web renders `nativeID` as
 * `id`). It is looked up from the button OUTWARDS — the nearest ancestor that contains an avatar —
 * so with two assistant lines on screen each crosshair launches from its own avatar. Kept in a
 * module of its own so `AssistantOptions` can import the id without importing the button.
 */
export const RAGE_LAUNCH_ANCHOR_ID = 'rage-mode-launch-anchor'

const centreOf = element => {
    const rect = element && element.getBoundingClientRect ? element.getBoundingClientRect() : null
    if (!rect || (!rect.width && !rect.height)) return null
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, size: Math.max(rect.width, rect.height) }
}

/** The launch point for a crosshair button: its own avatar if one is in reach, else the button. */
export const findLaunchPoint = button => {
    for (let node = button && button.parentElement; node && node !== document.body; node = node.parentElement) {
        const avatar = node.querySelector ? node.querySelector(`[id="${RAGE_LAUNCH_ANCHOR_ID}"]`) : null
        if (avatar) return centreOf(avatar) || centreOf(button)
    }
    return centreOf(button)
}
