/**
 * Which 3D "the assistant is working" scene a loading card plays. Deliberately free of three.js:
 * the card decides this on the main bundle, the scenes themselves live in the lazily loaded chunk.
 */

export const THINKING_ANIMATIONS = [
    'atom',
    'cube',
    'helix',
    'network',
    'gears',
    'book',
    'blob',
    'tower',
    'crystal',
    'dots',
]

// A run is shown by two cards in a row: the placeholder while the request is in flight, then the
// assistant message's own card once it exists. Both unmount/mount in one commit, so a card that
// is released and a card that is acquired within this window are the same run and keep the scene.
export const THINKING_ANIMATION_HANDOFF_MS = 1500

let lastPick = null
let heldPick = null
let releasedAt = -Infinity

/** Picks a scene, never the same as the previous pick, unless a run is being handed over. */
export function acquireThinkingAnimation({ now = Date.now(), random = Math.random } = {}) {
    if (heldPick && now - releasedAt <= THINKING_ANIMATION_HANDOFF_MS) {
        const handedOver = heldPick
        heldPick = null
        return handedOver
    }
    heldPick = null
    const candidates = THINKING_ANIMATIONS.filter(name => name !== lastPick)
    const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length))
    lastPick = candidates[index]
    return lastPick
}

/** Called when a card stops showing its scene, so a card taking over the same run can reuse it. */
export function releaseThinkingAnimation(name, now = Date.now()) {
    if (!THINKING_ANIMATIONS.includes(name)) return
    heldPick = name
    releasedAt = now
}

export const __resetThinkingAnimationChoiceForTests = () => {
    lastPick = null
    heldPick = null
    releasedAt = -Infinity
}
