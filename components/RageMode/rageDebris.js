/**
 * The pure half of rage mode's destruction: seeded randomness, and how a destroyed thing breaks
 * into shards. No DOM, no three.js — rectangle-local CSS pixels.
 */

// Deterministic per-piece randomness: a seeded generator keeps a hit reproducible in tests, and
// makes a level the same level every time it is flown with the same seed.
export const createRandom = (seed = 1) => {
    let state = seed >>> 0 || 1
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0
        return state / 4294967296
    }
}

const between = (random, min, max) => min + (max - min) * random()

/**
 * Cut a rectangle into triangular shards: a jittered grid, each cell split along a random diagonal.
 * Returns triangles in rectangle-local pixels plus their centroid, so a shard can be built around
 * its own centre (it spins about itself, not about the corner of the image).
 *
 * The triangles tile the rectangle exactly — the jitter moves only INTERIOR grid points — so the
 * shards of a destroyed bunker cover it with no gaps at the moment it breaks.
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
