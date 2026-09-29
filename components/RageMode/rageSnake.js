/**
 * Task snakes: a task row peels out of the list and crawls around the screen like the old game —
 * a chain of tiles (one per letter of its title, plus a head with eyes) moving on a grid and turning
 * at right angles. Shooting it knocks the tail off and shrinks it until it bursts.
 *
 * Pure: movement and segment placement only, in screen space (px, y down). The arena owns the
 * meshes and decides what a hit does.
 *
 * The body follows the head's TRAIL: every turn the head makes is recorded as a vertex, and segment
 * i sits `i * gap` pixels back along that polyline. That is exactly how Snake reads — the body
 * retraces the head's path, corners and all — and it needs no per-segment physics.
 */

export const SNAKE_TILE = 18
export const SNAKE_GAP = 21
export const SNAKE_CELL = 42
export const SNAKE_SPEED = 150
export const SNAKE_TURN_CHANCE = 0.35
export const SNAKE_SHRINK = 0.86
export const SNAKE_MIN_SCALE = 0.42
export const SNAKE_MAX_LETTERS = 16
export const SNAKE_MORPH_SECONDS = 0.55

const DIRECTIONS = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
]

const inside = (point, bounds, margin) =>
    point.x >= bounds.left + margin &&
    point.x <= bounds.right - margin &&
    point.y >= bounds.top + margin &&
    point.y <= bounds.bottom - margin

/**
 * A snake lying along a line of text: `tail` → `head` in reading order, heading on in the same
 * direction. The trail runs back past the tail so every segment has somewhere to stand at once.
 */
export const createSnake = ({ head, tail, segmentCount }) => {
    const dx = head.x - tail.x
    const dy = head.y - tail.y
    const length = Math.hypot(dx, dy) || 1
    const dir = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx) || 1, y: 0 } : { x: 0, y: Math.sign(dy) }
    const reach = segmentCount * SNAKE_GAP + SNAKE_GAP
    return {
        head: { x: head.x, y: head.y },
        dir,
        // Head first; the last vertex is far enough back for the whole body.
        trail: [
            { x: head.x, y: head.y },
            { x: head.x - dir.x * Math.max(reach, length), y: head.y - dir.y * Math.max(reach, length) },
        ],
        sinceTurn: 0,
        scale: 1,
        age: 0,
    }
}

const trailLength = trail => {
    let total = 0
    for (let i = 1; i < trail.length; i++) {
        total += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].y - trail[i - 1].y)
    }
    return total
}

/** The point `distance` px back along the trail from the head. */
export const pointAlongTrail = (trail, distance) => {
    let left = distance
    for (let i = 1; i < trail.length; i++) {
        const a = trail[i - 1]
        const b = trail[i]
        const length = Math.hypot(b.x - a.x, b.y - a.y)
        if (left <= length) {
            const t = length ? left / length : 0
            return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
        }
        left -= length
    }
    return { ...trail[trail.length - 1] }
}

/** Where each of `count` segments stands (index 0 = the head). */
export const segmentPositions = (snake, count) => {
    const gap = SNAKE_GAP * snake.scale
    const positions = []
    for (let i = 0; i < count; i++) positions.push(pointAlongTrail(snake.trail, i * gap))
    return positions
}

/**
 * Which way to go at a grid point: carry on, or (sometimes) turn left or right — never back into
 * itself, and never off the play area. Only if every forward option leaves the area does it reverse.
 */
export const chooseDirection = (snake, bounds, random) => {
    const current = DIRECTIONS.findIndex(d => d.x === snake.dir.x && d.y === snake.dir.y)
    const straight = DIRECTIONS[current]
    const left = DIRECTIONS[(current + 3) % 4]
    const right = DIRECTIONS[(current + 1) % 4]
    const lookAhead = SNAKE_CELL * snake.scale + SNAKE_TILE
    const fits = dir => inside({ x: snake.head.x + dir.x * lookAhead, y: snake.head.y + dir.y * lookAhead }, bounds, 0)
    const turns = random() < 0.5 ? [left, right] : [right, left]
    const wantsTurn = random() < SNAKE_TURN_CHANCE
    const order = wantsTurn ? [...turns, straight] : [straight, ...turns]
    return order.find(fits) || DIRECTIONS[(current + 2) % 4]
}

/**
 * Move the snake on by `dt` seconds. It speeds up as it shrinks — a wounded snake is an angry one.
 * Mutates and returns the snake.
 */
export const stepSnake = (snake, dt, bounds, random, segmentCount) => {
    snake.age += dt
    const speed = SNAKE_SPEED / Math.sqrt(snake.scale)
    let remaining = speed * dt
    const cell = SNAKE_CELL * snake.scale
    while (remaining > 0) {
        const toCell = cell - snake.sinceTurn
        const move = Math.min(remaining, toCell)
        snake.head.x += snake.dir.x * move
        snake.head.y += snake.dir.y * move
        snake.sinceTurn += move
        remaining -= move
        if (snake.sinceTurn >= cell - 1e-6) {
            snake.sinceTurn = 0
            const next = chooseDirection(snake, bounds, random)
            if (next.x !== snake.dir.x || next.y !== snake.dir.y) {
                // A corner: pin it in the trail so the body turns exactly where the head did.
                snake.trail.splice(1, 0, { x: snake.head.x, y: snake.head.y })
                snake.dir = next
            }
        }
    }
    snake.trail[0] = { x: snake.head.x, y: snake.head.y }

    // Drop trail the body no longer needs.
    const needed = segmentCount * SNAKE_GAP * snake.scale + SNAKE_GAP
    while (snake.trail.length > 2) {
        const withoutLast = snake.trail.slice(0, -1)
        if (trailLength(withoutLast) >= needed) snake.trail = withoutLast
        else break
    }
    return snake
}

/** The snake after a hit: smaller, and it says whether that was the killing blow. */
export const shrinkSnake = (snake, segmentsLeft) => {
    snake.scale *= SNAKE_SHRINK
    return { dead: segmentsLeft <= 1 || snake.scale < SNAKE_MIN_SCALE }
}
