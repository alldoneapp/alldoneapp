/**
 * Input → intent for rage mode, kept free of DOM and three.js so the feel can be tuned and tested
 * on its own. Screen space throughout: pixels, y pointing down the viewport.
 */

export const MOVE_ACCELERATION = 3400
export const MAX_SPEED = 620
export const HOVER_DAMPING = 5.5
export const FIRE_INTERVAL = 0.12
export const BOLT_SPEED = 1500
// On touch the character flies itself: it hovers this far from the finger, on the side it came
// from, so the thumb never covers it and every shot has room to travel.
export const TOUCH_STANDOFF = 150

const MOVE_KEYS = {
    ArrowLeft: 'left',
    KeyA: 'left',
    ArrowRight: 'right',
    KeyD: 'right',
    ArrowUp: 'up',
    KeyW: 'up',
    ArrowDown: 'down',
    KeyS: 'down',
}

export const directionForKey = code => MOVE_KEYS[code] || null

/** The unit movement vector for the set of held directions (diagonals are not faster). */
export const moveVector = held => {
    const x = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0)
    const y = (held.has('down') ? 1 : 0) - (held.has('up') ? 1 : 0)
    const length = Math.hypot(x, y)
    return length ? { x: x / length, y: y / length } : { x: 0, y: 0 }
}

/**
 * Where a touch-driven character wants to be: `TOUCH_STANDOFF` px from the aim point, back along
 * the line it is currently on. A character sitting on the aim point itself backs off upward.
 */
export const touchHoverTarget = (character, aim, viewport) => {
    let dx = character.x - aim.x
    let dy = character.y - aim.y
    const distance = Math.hypot(dx, dy)
    if (distance < 1) {
        dx = 0
        dy = -1
    } else {
        dx /= distance
        dy /= distance
    }
    const margin = 40
    return {
        x: Math.max(margin, Math.min(viewport.width - margin, aim.x + dx * TOUCH_STANDOFF)),
        y: Math.max(margin + 20, Math.min(viewport.height - margin, aim.y + dy * TOUCH_STANDOFF)),
    }
}

/**
 * One physics step for the character. `thrust` is a unit-ish vector (keyboard) or null; `seek` is a
 * point to fly towards (touch) or null. Mutates and returns `character`, and keeps it on screen.
 */
export const stepCharacter = (character, { thrust, seek }, dt, viewport) => {
    let ax = 0
    let ay = 0
    if (seek) {
        // A critically-damped-ish spring towards the target: arrives briskly, does not orbit it.
        ax = (seek.x - character.x) * 26 - character.vx * 9
        ay = (seek.y - character.y) * 26 - character.vy * 9
    } else if (thrust && (thrust.x || thrust.y)) {
        ax = thrust.x * MOVE_ACCELERATION
        ay = thrust.y * MOVE_ACCELERATION
    } else {
        const damping = Math.max(0, 1 - HOVER_DAMPING * dt)
        character.vx *= damping
        character.vy *= damping
    }
    character.vx += ax * dt
    character.vy += ay * dt
    const speed = Math.hypot(character.vx, character.vy)
    if (speed > MAX_SPEED) {
        character.vx = (character.vx / speed) * MAX_SPEED
        character.vy = (character.vy / speed) * MAX_SPEED
    }
    character.x += character.vx * dt
    character.y += character.vy * dt

    const margin = 24
    if (character.x < margin) {
        character.x = margin
        character.vx = Math.max(0, character.vx)
    }
    if (character.x > viewport.width - margin) {
        character.x = viewport.width - margin
        character.vx = Math.min(0, character.vx)
    }
    if (character.y < margin + 16) {
        character.y = margin + 16
        character.vy = Math.max(0, character.vy)
    }
    if (character.y > viewport.height - margin) {
        character.y = viewport.height - margin
        character.vy = Math.min(0, character.vy)
    }
    return character
}

/** The angle (radians, screen space) from the muzzle to the aim point. */
export const aimAngle = (from, to) => Math.atan2(to.y - from.y, to.x - from.x)

/** True when a key event should reach the browser rather than be swallowed (Cmd+R, Ctrl+W, …). */
export const isBrowserShortcut = event => !!(event.metaKey || event.ctrlKey || event.altKey)
