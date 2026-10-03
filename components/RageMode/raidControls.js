/**
 * Input → movement for the raid, free of DOM and three.js so the feel can be tuned and tested on its
 * own. Screen space throughout: pixels, y pointing down the viewport.
 *
 * Three ways to fly, as in the classic vertical shooters:
 *   - mouse: Anna follows the cursor (the gun fires on its own, so the mouse only steers);
 *   - keyboard: arrows / WASD push her around, and override the mouse until it moves again;
 *   - touch: RELATIVE drag — she moves by however far the finger moves, so the thumb never covers
 *     her and you can steer from anywhere on the screen.
 */

export const SHIP_MAX_SPEED = 950
export const KEY_SPEED = 520
// How briskly she catches up with the cursor: higher is snappier.
export const FOLLOW_GAIN = 12
// She may not fly into the top band: enemies need room to enter, and the HUD lives there.
export const TOP_BAND = 0.18
export const EDGE_MARGIN = 26

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

export const shipBounds = viewport => ({
    left: EDGE_MARGIN,
    right: viewport.width - EDGE_MARGIN,
    top: Math.max(70, viewport.height * TOP_BAND),
    bottom: viewport.height - EDGE_MARGIN - 10,
})

export const clampToBounds = (point, bounds) => ({
    x: Math.max(bounds.left, Math.min(bounds.right, point.x)),
    y: Math.max(bounds.top, Math.min(bounds.bottom, point.y)),
})

/**
 * One step. `input.target` is a point to follow (mouse) or null; `input.thrust` a unit vector
 * (keyboard). Records the horizontal velocity in `ship.vx` so the arena can bank her into turns.
 * Mutates and returns `ship`.
 */
export const stepShip = (ship, input, dt, viewport) => {
    const bounds = shipBounds(viewport)
    const before = ship.x
    if (input.thrust && (input.thrust.x || input.thrust.y)) {
        ship.x += input.thrust.x * KEY_SPEED * dt
        ship.y += input.thrust.y * KEY_SPEED * dt
    } else if (input.target) {
        const goal = clampToBounds(input.target, bounds)
        let dx = (goal.x - ship.x) * Math.min(1, FOLLOW_GAIN * dt)
        let dy = (goal.y - ship.y) * Math.min(1, FOLLOW_GAIN * dt)
        const step = Math.hypot(dx, dy)
        const max = SHIP_MAX_SPEED * dt
        if (step > max) {
            dx = (dx / step) * max
            dy = (dy / step) * max
        }
        ship.x += dx
        ship.y += dy
    }
    const clamped = clampToBounds(ship, bounds)
    ship.x = clamped.x
    ship.y = clamped.y
    ship.vx = dt > 0 ? (ship.x - before) / dt : 0
    return ship
}

/** A touch drag moved by (dx, dy): she moves by the same amount, within bounds. */
export const dragShip = (ship, dx, dy, viewport) => {
    const clamped = clampToBounds({ x: ship.x + dx, y: ship.y + dy }, shipBounds(viewport))
    ship.x = clamped.x
    ship.y = clamped.y
    return ship
}

/** True when a key event should reach the browser rather than be swallowed (Cmd+R, Ctrl+W, …). */
export const isBrowserShortcut = event => !!(event.metaKey || event.ctrlKey || event.altKey)
