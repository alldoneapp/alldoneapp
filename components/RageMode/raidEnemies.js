/**
 * The raid's enemies: what each kind can take and dish out, the flight paths the air waves follow,
 * and how they shoot. Pure — screen pixels and seconds, y down the viewport. The arena draws them
 * and resolves collisions.
 *
 * The cast is Alldone's own working day: incoming mail in swarms, chat bubbles that talk back,
 * notification pings that chase you, sticky notes that multiply when you deal with them, checkbox
 * mines, meeting invites that fill the air with rings, and the deadline clock — a mini-boss that
 * sprays spirals while its hands spin. A golden starred task flees across the screen carrying
 * power-ups.
 *
 * Most air enemies fly scripted PATHS rather than steering, which is what makes a vertical shooter
 * learnable: the same wave comes in the same way every time, so the second attempt is a plan
 * instead of a reflex. A path is a plain object built once at spawn (`expandWave`), evaluated by
 * `pathPoint(path, t)`. The two exceptions are deliberate: a ping HOMES (that is its whole
 * personality) and the halves of a split sticky note scatter from wherever the note died.
 */

import { FULL_SCREEN, scaleCount } from './raidScreen'

/**
 * `fire.pattern`: aimed (a fan of `count` at the ship), spread (a wider fan), ring (`count` evenly
 * around), spiral (`arms` streams rotating by `step` every shot, in bursts). `fire.speed` scales
 * the base bullet speed. `contact` is the damage of flying into Anna. `tint` colours the bullets.
 */
export const ENEMY_TYPES = {
    // Incoming mail: small, fast, fragile, flies in swarms and only hurts if it hits you.
    mail: { hp: 1, radius: 17, layer: 'air', contact: 10, fire: null },
    // A fighter: takes a few hits and fires aimed shots.
    fighter: { hp: 5, radius: 25, layer: 'air', contact: 18, fire: { pattern: 'aimed', every: 1.7 } },
    // A chat bubble: zigzags down and answers with a three-dot spread.
    chat: {
        hp: 3,
        radius: 22,
        layer: 'air',
        contact: 12,
        tint: '#2F80ED',
        fire: { pattern: 'spread', every: 2.2, count: 3, spread: 0.5, speed: 0.85 },
    },
    // A notification ping: a red badge that homes in on you and goes off on contact.
    ping: { hp: 2, radius: 15, layer: 'air', contact: 14, kamikaze: true, fire: null },
    // A sticky note: dealing with it makes two smaller ones.
    note: {
        hp: 6,
        radius: 24,
        layer: 'air',
        contact: 12,
        tint: '#F9A825',
        splitsInto: 'noteSmall',
        fire: { pattern: 'aimed', every: 3 },
    },
    noteSmall: { hp: 2, radius: 14, layer: 'air', contact: 8, tint: '#F9A825', fire: null },
    // A checkbox mine: drifts down, arms when you come close, and bursts into a ring.
    mine: { hp: 3, radius: 18, layer: 'air', contact: 20, tint: '#2E7D32', mine: true, fire: null },
    // A meeting invite: tough, slow, fills the air with rings.
    meeting: {
        hp: 18,
        radius: 34,
        layer: 'air',
        contact: 22,
        tint: '#7E57C2',
        fire: { pattern: 'ring', every: 2.6, count: 10, speed: 0.62 },
    },
    // The deadline: a clock mini-boss whose spiral of fire turns with its hands.
    deadline: {
        hp: 45,
        radius: 40,
        layer: 'air',
        contact: 26,
        tint: '#EF6C00',
        fire: { pattern: 'spiral', every: 0.11, arms: 2, step: 0.33, speed: 0.66, burst: 2.6, pause: 1.6 },
    },
    // A starred task: never shoots, flees across the screen, always drops power-ups.
    carrier: { hp: 4, radius: 22, layer: 'air', contact: 0, carrier: true, fire: null },
    // A task on the ground, dug in as a bunker with a turret. Armoured ones are tougher.
    bunker: { hp: 7, radius: 0, layer: 'ground', fire: { pattern: 'aimed', every: 2.6 } },
    armoured: { hp: 16, radius: 0, layer: 'ground', fire: { pattern: 'aimed', every: 2.0, count: 3 } },
    // A task row of the real page, at take-off. Easy, slow to shoot: the welcome committee.
    pageTask: { hp: 3, radius: 0, layer: 'ground', fire: { pattern: 'aimed', every: 3.4 } },
}

export const BULLET_SPEED = 260
export const BULLET_RADIUS = 7
export const DEFAULT_TINT = '#FF3B30'
// Enemies never fire from the very top edge (you could not see them yet) or once they are below
// the ship's band (a shot from behind is unfair).
export const FIRE_ZONE = { top: 30, bottomShare: 0.78 }
// A mine arms when Anna comes this close, and goes off this long after.
export const MINE_TRIGGER_RADIUS = 80
export const MINE_FUSE_SECONDS = 0.65
export const PING_LIFE = 9

const OFF = 60

// −1 … 1 … −1 over one unit: the zigzag of a chat bubble.
const triangle = u => 2 * Math.abs(2 * (u - Math.floor(u + 0.5))) - 1

/**
 * Where a path is `t` seconds after its enemy spawned. `done` turns true once the path has carried
 * the enemy off screen for good. (A homing path is steered in `stepAirEnemy` instead.)
 */
export const pathPoint = (path, t) => {
    switch (path.kind) {
        case 'dive': {
            // Straight down a lane, weaving.
            const y = -OFF + path.speed * t
            const x = path.x + Math.sin(t * path.freq + path.phase) * path.amp
            return { x, y, done: y > path.height + OFF }
        }
        case 'zigzag': {
            const y = -OFF + path.speed * t
            const x = path.x + triangle(t * path.freq + path.phase) * path.amp
            return { x, y, done: y > path.height + OFF }
        }
        case 'drift': {
            // Slowly down the screen, swaying: mines and notes.
            const y = -OFF + path.speed * t
            const x = path.x + Math.sin(t * path.freq + path.phase) * path.amp
            return { x, y, done: y > path.height + OFF }
        }
        case 'scatter': {
            // Thrown apart from where something broke, then drifting on down.
            const k = (1 - Math.exp(-2.5 * t)) / 2.5
            const x = path.x + path.vx * k
            const y = path.y + path.vy * k + path.fall * t
            return { x, y, done: y > path.height + OFF || x < -OFF || x > path.width + OFF }
        }
        case 'sine': {
            // Across the screen at a height, bobbing.
            const k = t / path.duration
            const x = path.fromX + (path.toX - path.fromX) * k
            const y = path.y + Math.sin(t * path.freq + path.phase) * path.amp
            return { x, y, done: k >= 1 }
        }
        case 'arc': {
            // In from one side, swooping down through the middle and out the other side.
            const k = Math.min(1, t / path.duration)
            const u = 1 - k
            const x = u * u * path.from.x + 2 * u * k * path.via.x + k * k * path.to.x
            const y = u * u * path.from.y + 2 * u * k * path.via.y + k * k * path.to.y
            return { x, y, done: t >= path.duration }
        }
        case 'hover': {
            // Down to a holding line, strafe there for a while, then leave the way it came.
            const enter = 1.3
            const leave = 1.1
            if (t < enter) {
                const k = t / enter
                const eased = 1 - (1 - k) * (1 - k)
                return { x: path.x, y: -OFF + (path.holdY + OFF) * eased, done: false }
            }
            if (t < enter + path.hold) {
                const s = t - enter
                return { x: path.x + Math.sin(s * path.freq) * path.amp, y: path.holdY, done: false }
            }
            const k = (t - enter - path.hold) / leave
            const x = path.x + Math.sin(path.hold * path.freq) * path.amp
            return { x, y: path.holdY - (path.holdY + OFF * 2) * k * k, done: k >= 1 }
        }
        case 'homing':
            return { x: path.x, y: -OFF, done: false }
        default:
            return { x: 0, y: 0, done: true }
    }
}

// Lanes spread across the screen without a pattern you can see: the golden ratio walk.
const goldenLane = (i, width) => width * (0.1 + 0.8 * ((i * 0.618034 + 0.31) % 1))

/**
 * A wave's spec (from `raidLevel.js`) expanded into individual enemies for this viewport:
 * `[{ delay, type, path }]`, `delay` in seconds after the wave starts.
 */
export const expandWave = (wave, viewport, density = 1) => {
    const { width, height } = viewport
    const enemies = []
    // Fewer enemies per wave on a smaller screen (raidScreen.js).
    const count = density === 1 ? wave.count : scaleCount(wave.count, density)
    for (let i = 0; i < count; i++) {
        const delay = i * wave.spacing
        let path
        switch (wave.pattern) {
            case 'vee': {
                // A V of divers: the leader in the middle, wingmen fanning out behind it.
                const side = i === 0 ? 0 : i % 2 ? -1 : 1
                const rank = Math.ceil(i / 2)
                path = {
                    kind: 'dive',
                    x: width * wave.x + side * rank * Math.min(70, width / 10),
                    speed: 150,
                    freq: 0,
                    phase: 0,
                    amp: 0,
                    height,
                }
                enemies.push({ delay: rank * 0.35, type: wave.type, path })
                continue
            }
            case 'weave':
                path = {
                    kind: 'dive',
                    x: width * wave.x,
                    speed: 210,
                    freq: 2.4,
                    phase: i * 0.6,
                    amp: Math.min(140, width * 0.18),
                    height,
                }
                break
            case 'zigzag': {
                const lanes = Math.max(1, count)
                path = {
                    kind: 'zigzag',
                    x: width * (0.15 + (0.7 * (i + 0.5)) / lanes),
                    speed: 120,
                    freq: 0.45,
                    phase: i * 0.5,
                    amp: Math.min(110, width * 0.12),
                    height,
                }
                break
            }
            case 'swarm':
                path = { kind: 'homing', x: goldenLane(i, width), speed: 120, maxSpeed: 330, turn: 2.3, height, width }
                break
            case 'drift':
                path = {
                    kind: 'drift',
                    x: goldenLane(i, width),
                    speed: 70,
                    freq: 0.9,
                    phase: i,
                    amp: Math.min(50, width * 0.05),
                    height,
                }
                break
            case 'sweep': {
                const fromLeft = wave.side !== 'right'
                path = {
                    kind: 'sine',
                    fromX: fromLeft ? -OFF : width + OFF,
                    toX: fromLeft ? width + OFF : -OFF,
                    y: height * wave.y,
                    duration: wave.duration || 4.2,
                    freq: 3,
                    phase: i * 0.8,
                    amp: 40,
                }
                break
            }
            case 'swoop': {
                const fromLeft = wave.side !== 'right'
                path = {
                    kind: 'arc',
                    from: { x: fromLeft ? -OFF : width + OFF, y: height * 0.12 },
                    via: { x: width * 0.5, y: height * 0.95 },
                    to: { x: fromLeft ? width + OFF : -OFF, y: height * 0.05 },
                    duration: 4.6,
                }
                break
            }
            case 'single':
                // One big one, holding the middle of the screen for a long time: a mini-boss.
                path = {
                    kind: 'hover',
                    x: width / 2,
                    holdY: height * (wave.y || 0.24),
                    hold: wave.hold || 9,
                    freq: 0.5,
                    amp: Math.min(160, width * 0.2),
                }
                break
            case 'hover':
            default: {
                const lanes = Math.max(1, count)
                path = {
                    kind: 'hover',
                    x: width * (0.15 + (0.7 * (i + 0.5)) / lanes),
                    holdY: height * (wave.y || 0.22),
                    hold: wave.hold || 4.5,
                    freq: 1.1,
                    amp: Math.min(60, width * 0.06),
                }
                enemies.push({ delay: i * 0.25, type: wave.type, path })
                continue
            }
        }
        enemies.push({ delay, type: wave.type, path })
    }
    return enemies
}

export const createEnemy = (spec, difficulty, random) => {
    const type = ENEMY_TYPES[spec.type]
    const every = type.fire ? type.fire.every : 0
    const hp = Math.max(1, Math.round(type.hp * difficulty))
    const enemy = {
        type: spec.type,
        path: spec.path,
        hp,
        maxHp: hp,
        radius: type.radius,
        t: 0,
        x: 0,
        y: -OFF,
        // Stagger the first shot so a whole wave does not fire in unison.
        fireIn: every ? Math.max(0.4, every) * (0.4 + random() * 0.8) : Infinity,
        hurt: 0,
        dead: false,
    }
    if (spec.path && spec.path.kind === 'homing') {
        enemy.x = spec.path.x
        enemy.heading = Math.PI / 2
        enemy.speed = spec.path.speed
    }
    if (type.fire && type.fire.pattern === 'spiral')
        enemy.spiral = { angle: random() * Math.PI * 2, burst: 0, pause: 1 }
    return enemy
}

/**
 * Advance an air enemy along its path (or, for a homing ping, towards `target`). Returns false once
 * it has left for good.
 */
export const stepAirEnemy = (enemy, dt, target = null) => {
    enemy.t += dt
    enemy.hurt = Math.max(0, enemy.hurt - dt)
    if (enemy.path.kind === 'homing') {
        const path = enemy.path
        if (target && enemy.t > 0.6) {
            // Turn towards Anna, but only so fast: a ping can be dodged by a sharp sideways move.
            const wanted = Math.atan2(target.y - enemy.y, target.x - enemy.x)
            let delta = wanted - enemy.heading
            while (delta > Math.PI) delta -= Math.PI * 2
            while (delta < -Math.PI) delta += Math.PI * 2
            const max = path.turn * dt
            enemy.heading += Math.max(-max, Math.min(max, delta))
        }
        enemy.speed = Math.min(path.maxSpeed, enemy.speed + 140 * dt)
        enemy.vx = Math.cos(enemy.heading) * enemy.speed
        enemy.x += enemy.vx * dt
        enemy.y += Math.sin(enemy.heading) * enemy.speed * dt
        const off = enemy.y > path.height + OFF || enemy.x < -OFF || enemy.x > path.width + OFF || enemy.y < -OFF * 2
        return !(enemy.t > PING_LIFE || (enemy.t > 1 && off))
    }
    const point = pathPoint(enemy.path, enemy.t)
    enemy.vx = dt > 0 ? (point.x - enemy.x) / dt : 0
    enemy.x = point.x
    enemy.y = point.y
    return !point.done
}

export const canFireFrom = (y, viewport) => y > FIRE_ZONE.top && y < viewport.height * FIRE_ZONE.bottomShare

const bullet = (enemy, angle, speed, tint) => ({
    x: enemy.x,
    y: enemy.y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    age: 0,
    tint,
})

/** Bullets evenly around a point: a mine going off, a meeting's ring. */
export const ringBullets = (enemy, count, speed, offset = 0, tint = DEFAULT_TINT) =>
    Array.from({ length: count }, (_, i) => bullet(enemy, offset + (Math.PI * 2 * i) / count, speed, tint))

/**
 * Count down a shooter's timer; when it fires, return its bullets. Works for air and ground
 * enemies alike. Spirals fire in bursts and keep turning between shots.
 */
export const stepEnemyFire = (enemy, dt, target, viewport, difficulty, random, screen = FULL_SCREEN) => {
    const type = ENEMY_TYPES[enemy.type]
    const fire = type.fire
    if (!fire || enemy.hp <= 0) return []
    const tint = type.tint || DEFAULT_TINT
    const speed = BULLET_SPEED * Math.sqrt(difficulty) * (fire.speed || 1)

    if (fire.pattern === 'spiral') {
        const spiral = enemy.spiral
        if (spiral.pause > 0) {
            spiral.pause -= dt
            if (spiral.pause <= 0) spiral.burst = fire.burst
            return []
        }
        spiral.burst -= dt
        if (spiral.burst <= 0) {
            spiral.pause = fire.pause / Math.sqrt(difficulty) / screen.pace
            return []
        }
        enemy.fireIn -= dt
        if (enemy.fireIn > 0 || !canFireFrom(enemy.y, viewport)) return []
        enemy.fireIn = fire.every / screen.pace
        spiral.angle += fire.step
        return ringBullets(enemy, fire.arms, speed, spiral.angle, tint)
    }

    enemy.fireIn -= dt
    if (enemy.fireIn > 0) return []
    enemy.fireIn = (fire.every * (0.75 + random() * 0.5)) / Math.sqrt(difficulty) / screen.pace
    if (!canFireFrom(enemy.y, viewport)) return []
    const aim = Math.atan2(target.y - enemy.y, target.x - enemy.x)
    if (fire.pattern === 'ring') {
        // Each ring is turned half a gap from the last, so standing still never stays safe.
        enemy.ringTurn = (enemy.ringTurn || 0) + Math.PI / fire.count
        const ringCount = scaleCount(fire.count + (difficulty >= 1.4 ? 2 : 0), Math.max(0.6, screen.density))
        return ringBullets(enemy, ringCount, speed, enemy.ringTurn, tint)
    }
    const count = fire.count || (difficulty >= 1.4 ? 3 : 1)
    const gap = fire.pattern === 'spread' ? fire.spread / Math.max(1, count - 1) : 0.18
    const bullets = []
    for (let i = 0; i < count; i++) bullets.push(bullet(enemy, aim + (i - (count - 1) / 2) * gap, speed, tint))
    return bullets
}

/**
 * The two smaller notes a sticky note becomes when destroyed, thrown apart from where it died.
 * Returns spawn specs for `createEnemy`.
 */
export const splitSpecs = (enemy, viewport) => {
    const type = ENEMY_TYPES[enemy.type]
    if (!type.splitsInto) return []
    return [-1, 1].map(side => ({
        type: type.splitsInto,
        path: {
            kind: 'scatter',
            x: enemy.x,
            y: enemy.y,
            vx: side * 220,
            vy: -60,
            fall: 90,
            height: viewport.height,
            width: viewport.width,
        },
    }))
}

/** The ring a mine goes off in: bigger when it was triggered, a small one when it was shot. */
export const mineBurst = (enemy, triggered, difficulty = 1) =>
    ringBullets(
        enemy,
        triggered ? 12 : 6,
        BULLET_SPEED * 0.8 * Math.sqrt(difficulty),
        Math.PI / 12,
        ENEMY_TYPES.mine.tint
    )

/** Move a bullet on; returns false once it has left the screen. */
export const stepBullet = (shot, dt, viewport) => {
    shot.age += dt
    shot.x += shot.vx * dt
    shot.y += shot.vy * dt
    return shot.x > -30 && shot.y > -30 && shot.x < viewport.width + 30 && shot.y < viewport.height + 30
}

/** Damage an enemy; returns whether that destroyed it. */
export const damageEnemy = (enemy, amount) => {
    if (enemy.hp <= 0) return false
    enemy.hp = Math.max(0, enemy.hp - amount)
    enemy.hurt = 0.1
    return enemy.hp <= 0
}
