/**
 * The pure half of rage mode's destruction: how a hit breaks something into pieces, and how those
 * pieces fly. No DOM, no three.js — every number is in CSS pixels and seconds, in SCREEN space
 * (x to the right, y DOWN the viewport, z out of the page towards the viewer), so the arena can
 * test a piece against the element it came from with a plain `getBoundingClientRect()`.
 *
 * Hand-rolled on purpose: a physics engine would be the heaviest dependency in the chunk to move a
 * few hundred flat pieces along ballistic arcs, and none of them ever collide with each other.
 */

export const GRAVITY = 1900
export const AIR_DRAG = 0.6
export const FLOOR_RESTITUTION = 0.38
export const FLOOR_FRICTION = 0.72
export const DEBRIS_LIFE = 3.6
export const DEBRIS_FADE = 0.7
export const MAX_Z = 520

// Deterministic per-piece randomness: a seeded generator keeps a hit reproducible in tests, and
// makes the rewind return every piece along the same path it left on.
export const createRandom = (seed = 1) => {
    let state = seed >>> 0 || 1
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0
        return state / 4294967296
    }
}

const between = (random, min, max) => min + (max - min) * random()

/**
 * The initial motion of a piece knocked out of the page at `origin` by an impact at `impact`:
 * away from the impact, out of the page towards the viewer, with a spin. `power` scales it —
 * a rocket throws further than a blaster bolt.
 */
export const launchVelocity = (origin, impact, random, power = 1) => {
    const dx = origin.x - impact.x
    const dy = origin.y - impact.y
    const distance = Math.hypot(dx, dy) || 1
    // Closer pieces fly harder; a piece at the very centre gets a random direction rather than none.
    const falloff = 1 / (1 + distance / 60)
    const nx = distance > 0.5 ? dx / distance : between(random, -1, 1)
    const ny = distance > 0.5 ? dy / distance : between(random, -1, 1)
    const speed = (260 + 520 * falloff) * power * between(random, 0.7, 1.25)
    return {
        vx: nx * speed + between(random, -90, 90) * power,
        vy: ny * speed - between(random, 220, 520) * power,
        vz: between(random, 140, 520) * power,
        spinX: between(random, -9, 9),
        spinY: between(random, -9, 9),
        spinZ: between(random, -12, 12),
    }
}

/**
 * Advance one piece by `dt` seconds. Mutates and returns the piece. The floor is the bottom edge of
 * the viewport: pieces bounce, slide and settle there instead of vanishing below it, which is what
 * sells the page as a floor you are wrecking rather than a screensaver.
 */
export const stepDebris = (piece, dt, floorY) => {
    piece.age += dt
    piece.vy += GRAVITY * dt
    const drag = Math.max(0, 1 - AIR_DRAG * dt)
    piece.vx *= drag
    piece.vz *= drag
    piece.x += piece.vx * dt
    piece.y += piece.vy * dt
    piece.z = Math.min(MAX_Z, Math.max(-40, piece.z + piece.vz * dt))
    // Pieces flying at the viewer slow down and drift back to the page plane, so they do not park
    // in front of the camera and cover the whole view.
    piece.vz -= piece.z * 1.4 * dt
    piece.rx += piece.spinX * dt
    piece.ry += piece.spinY * dt
    piece.rz += piece.spinZ * dt

    const bottom = floorY - (piece.halfHeight || 0)
    if (piece.y > bottom) {
        piece.y = bottom
        if (piece.vy > 0) piece.vy = -piece.vy * FLOOR_RESTITUTION
        piece.vx *= FLOOR_FRICTION
        piece.spinX *= FLOOR_FRICTION
        piece.spinY *= FLOOR_FRICTION
        piece.spinZ *= FLOOR_FRICTION
        if (Math.abs(piece.vy) < 40) piece.vy = 0
    }
    return piece
}

/** 1 while a piece is alive, fading to 0 over its last `DEBRIS_FADE` seconds. */
export const debrisOpacity = (age, life = DEBRIS_LIFE) => {
    if (age <= life - DEBRIS_FADE) return 1
    if (age >= life) return 0
    return (life - age) / DEBRIS_FADE
}

/**
 * Cut a rectangle into triangular shards: a jittered grid, each cell split along a random diagonal.
 * Returns triangles in rectangle-local pixels plus their centroid, so a shard can be built around
 * its own centre (it spins about itself, not about the corner of the image).
 *
 * The triangles tile the rectangle exactly — the jitter moves only INTERIOR grid points — which is
 * what makes the rewind land back on an intact image with no gaps.
 */
export const shatterRect = (width, height, random, targetShardSize = 34) => {
    const cols = Math.max(1, Math.min(9, Math.round(width / targetShardSize)))
    const rows = Math.max(1, Math.min(7, Math.round(height / targetShardSize)))
    const points = []
    for (let r = 0; r <= rows; r++) {
        const row = []
        for (let c = 0; c <= cols; c++) {
            const interiorX = c > 0 && c < cols
            const interiorY = r > 0 && r < rows
            const jx = interiorX ? between(random, -0.3, 0.3) * (width / cols) : 0
            const jy = interiorY ? between(random, -0.3, 0.3) * (height / rows) : 0
            row.push({ x: (c / cols) * width + jx, y: (r / rows) * height + jy })
        }
        points.push(row)
    }
    const shards = []
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const a = points[r][c]
            const b = points[r][c + 1]
            const d = points[r + 1][c]
            const e = points[r + 1][c + 1]
            const triangles =
                random() < 0.5
                    ? [
                          [a, b, e],
                          [a, e, d],
                      ]
                    : [
                          [a, b, d],
                          [b, e, d],
                      ]
            triangles.forEach(vertices => {
                const cx = (vertices[0].x + vertices[1].x + vertices[2].x) / 3
                const cy = (vertices[0].y + vertices[1].y + vertices[2].y) / 3
                shards.push({ vertices, centroid: { x: cx, y: cy } })
            })
        }
    }
    return shards
}

export const triangleArea = ([a, b, c]) => Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2

/**
 * Where a piece is during the rewind, `t` running 0 → 1: an ease-in-out from where it lies now back
 * to the spot it was knocked out of, with its spin unwound on the way.
 */
export const rewindPose = (from, to, t) => {
    const clamped = Math.max(0, Math.min(1, t))
    const eased = clamped < 0.5 ? 4 * clamped ** 3 : 1 - (-2 * clamped + 2) ** 3 / 2
    const lerp = (a, b) => a + (b - a) * eased
    // A little lift through the middle, so pieces arc home instead of sliding along the floor.
    const lift = Math.sin(Math.PI * eased) * 90
    return {
        x: lerp(from.x, to.x),
        y: lerp(from.y, to.y) - lift,
        z: lerp(from.z, to.z) + lift * 0.6,
        rx: lerp(from.rx, 0),
        ry: lerp(from.ry, 0),
        rz: lerp(from.rz, 0),
    }
}
