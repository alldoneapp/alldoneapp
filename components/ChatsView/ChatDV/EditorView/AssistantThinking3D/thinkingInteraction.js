/**
 * What the user can do to a loading scene while they wait, as plain state + maths (no three.js, no
 * DOM), so the feel of it is unit-testable. The stage feeds it pointer events and one `step` per
 * frame, and applies what `step` returns to a wrapper group around the scene.
 *
 * Three things, from least to most deliberate:
 * - **Attention**: as the cursor approaches, the scene turns to look at it. Falls off with distance
 *   measured in stage sizes, so it notices you before you are on it.
 * - **Drag**: grab and fling it; it keeps spinning with momentum, then glides back to how it
 *   started (the nearest full turn), so no scene is left edge-on after a fling.
 * - **Poke** (a click or tap without dragging): a squash-and-stretch "boing", a burst of speed that
 *   stacks with rapid pokes, and each scene's own reaction via `fx.sincePoke`.
 */

// How far the scene may turn towards the cursor, in radians.
export const LOOK_MAX_YAW = 0.55
export const LOOK_MAX_PITCH = 0.4
// Attention is full within this many stage half-sizes of the centre and gone past the second.
const ATTENTION_NEAR = 1.2
const ATTENTION_FAR = 5
// Radians of spin per CSS pixel dragged.
export const DRAG_RADIANS_PER_PIXEL = 0.018
// A press that travels less than this is a poke, not a drag.
export const POKE_SLOP_PX = 5
// Every poke adds this much extra speed; rapid pokes stack up to the cap.
export const POKE_BOOST = 2.4
export const MAX_BOOST = 7
const BOOST_DECAY = 1.8
const SPIN_DECAY = 2.2
const PITCH_RETURN = 2
// Once a fling has nearly stopped, the scene turns home at this rate.
const YAW_RETURN = 1.1
const YAW_RETURN_BELOW_SPEED = 0.6
const TAU = Math.PI * 2
const LOOK_EASE = 7
const HOVER_EASE = 10
const MAX_PITCH = 1.1

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export function createInteraction() {
    return {
        lookYaw: 0,
        lookPitch: 0,
        hover: 0,
        hovering: false,
        spinYaw: 0,
        spinPitch: 0,
        velocityYaw: 0,
        velocityPitch: 0,
        dragging: false,
        pressX: 0,
        pressY: 0,
        lastX: 0,
        lastY: 0,
        lastMoveAt: 0,
        travelled: 0,
        boost: 0,
        boostTime: 0,
        pokeAt: -Infinity,
        pokes: 0,
        clock: 0,
    }
}

export function pressStart(state, x, y, now) {
    state.dragging = true
    state.pressX = state.lastX = x
    state.pressY = state.lastY = y
    state.lastMoveAt = now
    state.travelled = 0
    state.velocityYaw = 0
    state.velocityPitch = 0
}

export function pressMove(state, x, y, now) {
    if (!state.dragging) return
    const dx = x - state.lastX
    const dy = y - state.lastY
    state.travelled = Math.max(state.travelled, Math.hypot(x - state.pressX, y - state.pressY))
    state.spinYaw += dx * DRAG_RADIANS_PER_PIXEL
    state.spinPitch = clamp(state.spinPitch + dy * DRAG_RADIANS_PER_PIXEL, -MAX_PITCH, MAX_PITCH)
    const seconds = Math.max(0.008, (now - state.lastMoveAt) / 1000)
    // Smoothed, so the fling keeps the speed of the last few moves rather than of the last one.
    state.velocityYaw = state.velocityYaw * 0.4 + ((dx * DRAG_RADIANS_PER_PIXEL) / seconds) * 0.6
    state.velocityPitch = state.velocityPitch * 0.4 + ((dy * DRAG_RADIANS_PER_PIXEL) / seconds) * 0.6
    state.lastX = x
    state.lastY = y
    state.lastMoveAt = now
}

/** Ends a press; returns true when it was a poke rather than a drag. */
export function pressEnd(state, now) {
    if (!state.dragging) return false
    state.dragging = false
    // A fling that stopped before letting go should not keep spinning.
    if (now - state.lastMoveAt > 120) {
        state.velocityYaw = 0
        state.velocityPitch = 0
    }
    if (state.travelled >= POKE_SLOP_PX) return false
    poke(state)
    return true
}

export function pressCancel(state) {
    state.dragging = false
}

export function poke(state) {
    state.pokeAt = state.clock
    state.pokes += 1
    state.boost = Math.min(MAX_BOOST, state.boost + POKE_BOOST)
}

export function setHovering(state, hovering) {
    state.hovering = hovering
}

/**
 * How strongly the scene attends to a cursor at `(dx, dy)` CSS px from its centre, for a stage of
 * `size` px: 1 close by, fading to 0 a few stage sizes away. `null` = no cursor on the page.
 */
export function attentionFor(dx, dy, size) {
    if (dx === null || dy === null || !(size > 0)) return 0
    const distance = Math.hypot(dx, dy) / (size / 2)
    return clamp(1 - (distance - ATTENTION_NEAR) / (ATTENTION_FAR - ATTENTION_NEAR), 0, 1)
}

/**
 * Advances the interaction by `dt` seconds. `pointer` is the cursor's offset from the stage centre
 * in CSS px (`{ dx, dy }`, or null), `size` the stage's size in CSS px. Returns the wrapper's
 * rotation and scale, the extra scene time earned by pokes, and the `fx` handed to the scene.
 */
export function stepInteraction(state, dt, pointer, size) {
    const step = clamp(dt, 0, 0.05)
    state.clock += step
    const dx = pointer ? pointer.dx : null
    const dy = pointer ? pointer.dy : null
    const attention = attentionFor(dx, dy, size)
    const half = size > 0 ? size / 2 : 1
    const targetYaw = attention > 0 ? clamp((dx / half) * 0.5, -1, 1) * LOOK_MAX_YAW * attention : 0
    const targetPitch = attention > 0 ? clamp((dy / half) * 0.5, -1, 1) * LOOK_MAX_PITCH * attention : 0
    const lookEase = 1 - Math.exp(-step * LOOK_EASE)
    state.lookYaw += (targetYaw - state.lookYaw) * lookEase
    state.lookPitch += (targetPitch - state.lookPitch) * lookEase
    state.hover += ((state.hovering || state.dragging ? 1 : 0) - state.hover) * (1 - Math.exp(-step * HOVER_EASE))

    if (!state.dragging) {
        state.spinYaw += state.velocityYaw * step
        state.spinPitch = clamp(state.spinPitch + state.velocityPitch * step, -MAX_PITCH, MAX_PITCH)
        const spinDecay = Math.exp(-step * SPIN_DECAY)
        state.velocityYaw *= spinDecay
        state.velocityPitch *= spinDecay
        // Upright again after a fling, and back to its own front once the spin has run out.
        state.spinPitch *= Math.exp(-step * PITCH_RETURN)
        if (Math.abs(state.velocityYaw) < YAW_RETURN_BELOW_SPEED) {
            const home = Math.round(state.spinYaw / TAU) * TAU
            state.spinYaw += (home - state.spinYaw) * (1 - Math.exp(-step * YAW_RETURN))
        }
    }

    state.boostTime += state.boost * step
    state.boost *= Math.exp(-step * BOOST_DECAY)
    if (state.boost < 0.001) state.boost = 0

    const sincePoke = state.clock - state.pokeAt
    // A damped wobble: squash down, stretch up, settle within about half a second.
    const boing = Number.isFinite(sincePoke) ? Math.exp(-sincePoke * 7) * Math.sin(sincePoke * 26) * 0.16 : 0
    const grow = 1 + 0.07 * state.hover
    return {
        yaw: state.lookYaw + state.spinYaw,
        pitch: state.lookPitch + state.spinPitch,
        scaleX: grow * (1 + boing * 0.6),
        scaleY: grow * (1 - boing),
        timeBoost: state.boostTime,
        fx: { sincePoke, energy: state.boost / MAX_BOOST, attention, pokes: state.pokes },
    }
}
