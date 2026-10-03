import { createRandom } from './rageDebris'

/**
 * A raid mission, generated from the user's own day: which waves come when, where today's tasks
 * are dug in as bunkers on the ground, and what the ground itself looks like. Pure and seeded, so a
 * mission is the same mission every time it is flown with the same seed — the arena seeds it from
 * the date, which makes "today's level" a fixed thing you can get better at.
 *
 * Coordinates. Time `t` is seconds since the mission started. The ground scrolls down the screen at
 * `scrollSpeed`; a point ON the ground is addressed by `g`, its distance (px) from where the mission
 * started, growing upwards. The arena turns `g` into a screen y as the ground scrolls past.
 */

// Ground speed (px/s) on mission 1; every later mission scrolls faster, up to MAX_SPEEDUP times.
export const SCROLL_SPEED = 96
export const SPEEDUP_PER_MISSION = 0.12
export const MAX_SPEEDUP = 1.8
export const CHUNK_HEIGHT = 512
export const RIVER_HALF_WIDTH = 36
export const ROAD_HALF_WIDTH = 13
export const MAX_BUNKERS = 16
export const MIN_BUNKERS = 6
export const BUNKER_HEIGHT = 46
export const TERRAIN_THEMES = 3

/*
 * The waves. Mission 1 is written by hand: it introduces the cast one or two at a time, with room
 * to learn each before the next arrives. Later missions are drawn (seeded by the day) from a pool of
 * wave templates that unlocks more of the cast as you go — sticky notes, mines and meeting invites
 * from mission 2, the deadline clock from mission 3 — and every mission flies at least one golden
 * starred task carrying power-ups. Times are seconds after the mission starts; `offset` places a
 * template's second flight relative to its first.
 */
const MISSION_ONE = [
    [{ at: 3, pattern: 'vee', type: 'fighter', count: 5, spacing: 0, x: 0.5 }],
    [
        { at: 10, pattern: 'weave', type: 'mail', count: 7, spacing: 0.32, x: 0.28 },
        { at: 12, pattern: 'weave', type: 'mail', count: 7, spacing: 0.32, x: 0.72 },
    ],
    [{ at: 19, pattern: 'zigzag', type: 'chat', count: 4, spacing: 0.6 }],
    [{ at: 26, pattern: 'sweep', type: 'carrier', count: 1, spacing: 0, y: 0.18, side: 'left', duration: 6 }],
    [{ at: 30, pattern: 'swarm', type: 'ping', count: 5, spacing: 0.45 }],
    [
        { at: 38, pattern: 'sweep', type: 'mail', count: 8, spacing: 0.26, y: 0.24, side: 'right' },
        { at: 40, pattern: 'hover', type: 'fighter', count: 3, spacing: 0, y: 0.2 },
    ],
    [{ at: 48, pattern: 'drift', type: 'note', count: 3, spacing: 1.2 }],
    [
        { at: 56, pattern: 'swoop', type: 'fighter', count: 3, spacing: 0.7, side: 'right' },
        { at: 58, pattern: 'drift', type: 'mine', count: 3, spacing: 1 },
    ],
]

export const WAVE_POOL = [
    { id: 'vee', min: 1, waves: [{ pattern: 'vee', type: 'fighter', count: 5, spacing: 0, x: 0.5 }] },
    {
        id: 'mailWeave',
        min: 1,
        waves: [
            { pattern: 'weave', type: 'mail', count: 7, spacing: 0.32, x: 0.3 },
            { offset: 2, pattern: 'weave', type: 'mail', count: 7, spacing: 0.32, x: 0.7 },
        ],
    },
    { id: 'chat', min: 1, waves: [{ pattern: 'zigzag', type: 'chat', count: 4, spacing: 0.6 }] },
    { id: 'pings', min: 1, waves: [{ pattern: 'swarm', type: 'ping', count: 6, spacing: 0.4 }] },
    {
        id: 'swoopPings',
        min: 1,
        waves: [
            { pattern: 'swoop', type: 'fighter', count: 3, spacing: 0.7, side: 'left' },
            { offset: 1.5, pattern: 'swarm', type: 'ping', count: 3, spacing: 0.5 },
        ],
    },
    { id: 'notes', min: 2, waves: [{ pattern: 'drift', type: 'note', count: 4, spacing: 1 }] },
    {
        id: 'minefield',
        min: 2,
        waves: [
            { pattern: 'drift', type: 'mine', count: 5, spacing: 0.8 },
            { offset: 1, pattern: 'zigzag', type: 'chat', count: 3, spacing: 0.6 },
        ],
    },
    { id: 'meetings', min: 2, waves: [{ pattern: 'hover', type: 'meeting', count: 2, spacing: 0, y: 0.2, hold: 5 }] },
    {
        id: 'mailSweeps',
        min: 2,
        waves: [
            { pattern: 'sweep', type: 'mail', count: 8, spacing: 0.26, y: 0.24, side: 'right' },
            { offset: 2, pattern: 'sweep', type: 'mail', count: 8, spacing: 0.26, y: 0.4, side: 'left' },
        ],
    },
    {
        id: 'deadline',
        min: 3,
        waves: [
            { pattern: 'single', type: 'deadline', count: 1, spacing: 0, y: 0.24, hold: 9 },
            { offset: 3, pattern: 'swarm', type: 'ping', count: 4, spacing: 0.6 },
        ],
    },
    {
        id: 'boardroom',
        min: 3,
        waves: [
            { pattern: 'hover', type: 'meeting', count: 3, spacing: 0, y: 0.22, hold: 5 },
            { offset: 2, pattern: 'drift', type: 'mine', count: 3, spacing: 1 },
        ],
    },
]
const SLOT_TIMES = [3, 11, 19, 27, 35, 43, 51, 59]
const CARRIER_TIMES = [23, 47]
// Big enemies do not come in bigger numbers later on — they come more often.
const FIXED_COUNT = new Set(['deadline', 'meeting', 'carrier'])

export const BOSS_AT = 68

const hashSeed = (...parts) => parts.reduce((acc, part) => Math.imul(acc ^ (part | 0), 2654435761) >>> 0 || 1, 7)

/** A seed for a calendar day: the same level all day, a new one tomorrow. */
export const daySeed = (date = new Date()) => date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()

/** The river's centre line at ground distance `g`: a lazy meander that never touches the edges. */
export const riverX = (g, width, seed) => {
    const a = (seed % 97) / 15
    const b = (seed % 89) / 13
    const share = 0.5 + 0.27 * Math.sin(g / 1150 + a) + 0.08 * Math.sin(g / 380 + b)
    return width * Math.max(0.14, Math.min(0.86, share))
}

/** The one north-south road, on the side the mission picks. */
export const roadX = (width, seed) => width * (seed % 2 ? 0.2 : 0.8)

// Capped at a third of the screen, so a bunker always fits beside the river, even on a phone.
const estimateBunkerWidth = (label, width) =>
    Math.min(width * 0.34, Math.max(100, Math.min(240, 44 + (label || '').length * 7.2)))

/**
 * Today's tasks, dug in along the route. Each task becomes one bunker carrying its title; a short
 * list is padded with unlabelled ones so a quiet day is still a fight. Never in the river.
 */
export const placeBunkers = ({ tasks, width, seed, mission, length }) => {
    const random = createRandom(hashSeed(seed, mission, 11))
    const labelled = tasks.slice(0, MAX_BUNKERS)
    const list = labelled.map(task => ({ ...task }))
    while (list.length < MIN_BUNKERS) list.push({ label: '', color: null })
    const start = 380
    const end = Math.max(start + 400, length - 500)
    const gap = (end - start) / list.length
    return list.map((task, i) => {
        const w = estimateBunkerWidth(task.label, width)
        const g = start + gap * (i + 0.2 + random() * 0.6)
        const river = riverX(g, width, seed)
        const road = roadX(width, seed)
        // Try a few spots; keep the first one clear of the river and the road. Failing that (a narrow
        // phone screen), the edge farthest from the river: a bunker may sit on the road, never in water.
        let x = null
        for (let attempt = 0; attempt < 12 && x === null; attempt++) {
            const candidate = w / 2 + 24 + random() * Math.max(1, width - w - 48)
            const clearOfRiver = Math.abs(candidate - river) > RIVER_HALF_WIDTH + w / 2 + 16
            const clearOfRoad = Math.abs(candidate - road) > ROAD_HALF_WIDTH + w / 2 + 10
            if (clearOfRiver && clearOfRoad) x = candidate
        }
        if (x === null) x = river < width / 2 ? width - w / 2 - 4 : w / 2 + 4
        return {
            g,
            x,
            w,
            h: BUNKER_HEIGHT,
            label: task.label || '',
            color: task.color || null,
            armoured: typeof task.armoured === 'boolean' ? task.armoured : random() < 0.25,
        }
    })
}

/**
 * The wave script for mission `n`: mission 1 is the script as written; later missions shuffle the
 * order (seeded) and bring bigger flights.
 */
export const missionWaves = (mission, seed) => {
    if (mission <= 1) return MISSION_ONE.flat().map(wave => ({ ...wave }))
    const random = createRandom(hashSeed(seed, mission, 23))
    const allowed = WAVE_POOL.filter(template => template.min <= mission)
    // Whatever this mission unlocks is flown at least once; the rest of the slots are drawn.
    const chosen = WAVE_POOL.filter(template => template.min === mission)
    while (chosen.length < SLOT_TIMES.length) chosen.push(allowed[Math.floor(random() * allowed.length)])
    for (let i = chosen.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        ;[chosen[i], chosen[j]] = [chosen[j], chosen[i]]
    }
    // A deadline is a mid-mission mini-boss: if one was drawn, it takes the middle slot.
    const deadlineAt = chosen.findIndex(template => template.id === 'deadline')
    if (deadlineAt >= 0) {
        const middle = Math.floor(SLOT_TIMES.length / 2)
        ;[chosen[deadlineAt], chosen[middle]] = [chosen[middle], chosen[deadlineAt]]
    }
    const extra = Math.min(4, mission - 1)
    const waves = []
    chosen.slice(0, SLOT_TIMES.length).forEach((template, slot) =>
        template.waves.forEach(wave => {
            const { offset = 0, ...rest } = wave
            waves.push({
                ...rest,
                at: SLOT_TIMES[slot] + offset,
                count: FIXED_COUNT.has(wave.type) ? wave.count + (mission >= 5 ? 1 : 0) : wave.count + extra,
            })
        })
    )
    const carrierAt = CARRIER_TIMES[Math.floor(random() * CARRIER_TIMES.length)]
    waves.push({
        at: carrierAt,
        pattern: 'sweep',
        type: 'carrier',
        count: 1,
        spacing: 0,
        y: 0.18,
        side: random() < 0.5 ? 'left' : 'right',
        duration: 6,
    })
    return waves.sort((a, b) => a.at - b.at)
}

/** How fast the ground scrolls on mission `n` (1-based). */
export const missionScrollSpeed = mission =>
    Math.round(SCROLL_SPEED * Math.min(MAX_SPEEDUP, 1 + SPEEDUP_PER_MISSION * Math.max(0, mission - 1)))

/**
 * Everything the arena needs to fly mission `mission`. `tasks` is `[{ label, color?, armoured? }]`.
 */
export const buildMission = ({ mission = 1, seed = 1, tasks = [], width }) => {
    const scrollSpeed = missionScrollSpeed(mission)
    const length = BOSS_AT * scrollSpeed
    return {
        mission,
        seed,
        scrollSpeed,
        waves: missionWaves(mission, seed),
        bunkers: placeBunkers({ tasks, width, seed, mission, length }),
        bossAt: BOSS_AT,
        theme: (mission - 1) % TERRAIN_THEMES,
    }
}

/**
 * The scenery of one `CHUNK_HEIGHT` slice of ground (chunk `index` covers g from index·CHUNK_HEIGHT
 * up). Positions are chunk-local: `x` across, `y` UP from the chunk's bottom edge. Fields are
 * a jittered patchwork, trees cluster in the fields, a few houses line the road.
 */
export const terrainChunk = ({ index, width, seed }) => {
    const random = createRandom(hashSeed(seed, index, 37))
    const base = index * CHUNK_HEIGHT
    const road = roadX(width, seed)
    const fields = []
    const cell = 128
    const cols = Math.ceil(width / cell)
    for (let row = 0; row < CHUNK_HEIGHT / cell; row++) {
        for (let col = 0; col < cols; col++) {
            if (random() < 0.35) continue
            const inset = 6 + random() * 10
            fields.push({
                x: col * cell + inset,
                y: row * cell + inset,
                w: cell - inset * 2,
                h: cell - inset * 2,
                shade: Math.floor(random() * 4),
            })
        }
    }
    const blocked = (x, y, pad) =>
        Math.abs(x - riverX(base + y, width, seed)) < RIVER_HALF_WIDTH + pad ||
        Math.abs(x - road) < ROAD_HALF_WIDTH + pad
    const trees = []
    const clusters = 3 + Math.floor(random() * 3)
    for (let c = 0; c < clusters; c++) {
        const cx = random() * width
        const cy = random() * CHUNK_HEIGHT
        const count = 4 + Math.floor(random() * 7)
        for (let i = 0; i < count; i++) {
            const x = cx + (random() - 0.5) * 120
            const y = cy + (random() - 0.5) * 120
            if (x < 6 || x > width - 6 || y < 0 || y > CHUNK_HEIGHT || blocked(x, y, 12)) continue
            trees.push({ x, y, r: 7 + random() * 7 })
        }
    }
    const houses = []
    const houseCount = Math.floor(random() * 4)
    for (let i = 0; i < houseCount; i++) {
        const side = random() < 0.5 ? -1 : 1
        const x = road + side * (ROAD_HALF_WIDTH + 22 + random() * 14)
        const y = 30 + random() * (CHUNK_HEIGHT - 60)
        if (x < 20 || x > width - 20 || blocked(x, y, 16)) continue
        houses.push({ x, y, w: 26 + random() * 14, d: 22 + random() * 10, h: 14 + random() * 14 })
    }
    // Every third chunk is crossed by an east-west road.
    const crossRoad = index % 3 === 1 ? { y: CHUNK_HEIGHT * (0.3 + random() * 0.4) } : null
    return { index, fields, trees, houses, crossRoad }
}
