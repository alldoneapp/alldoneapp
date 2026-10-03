/**
 * The raid's enemies: what each kind can take and dish out, the flight paths the air waves follow,
 * and when they shoot. Pure — screen pixels and seconds, y down the viewport. The arena draws them
 * and resolves collisions.
 *
 * Air enemies fly scripted PATHS rather than steering, which is what makes a vertical shooter
 * learnable: the same wave comes in the same way every time, so the second attempt is a plan
 * instead of a reflex. A path is a plain object built once at spawn (`expandWave`), evaluated by
 * `pathPoint(path, t)`.
 */

export const ENEMY_TYPES = {
    // Incoming mail: small, fast, fragile, flies in swarms and only hurts if it hits you.
    mail: { hp: 1, radius: 17, fireEvery: 0, layer: 'air' },
    // A fighter: takes a few hits and fires aimed shots.
    fighter: { hp: 5, radius: 25, fireEvery: 1.7, layer: 'air' },
    // A task on the ground, dug in as a bunker with a turret. Armoured ones are tougher.
    bunker: { hp: 7, radius: 0, fireEvery: 2.6, layer: 'ground' },
    armoured: { hp: 16, radius: 0, fireEvery: 2.0, layer: 'ground' },
    // A task row of the real page, at take-off. Easy, slow to shoot: the welcome committee.
    pageTask: { hp: 3, radius: 0, fireEvery: 3.4, layer: 'ground' },
}

export const BULLET_SPEED = 260
export const BULLET_RADIUS = 7
// Enemies never fire from the very top edge (you could not see them yet) or once they are below
// the ship's band (a shot from behind is unfair).
export const FIRE_ZONE = { top: 30, bottomShare: 0.78 }

const OFF = 60

/**
 * Where a path is `t` seconds after its enemy spawned. `done` turns true once the path has carried
 * the enemy off screen for good.
 */
export const pathPoint = (path, t) => {
    switch (path.kind) {
        case 'dive': {
            // Straight down a lane, weaving.
            const y = -OFF + path.speed * t
            const x = path.x + Math.sin(t * path.freq + path.phase) * path.amp
            return { x, y, done: y > path.height + OFF }
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
        default:
            return { x: 0, y: 0, done: true }
    }
}

/**
 * A wave's spec (from `raidLevel.js`) expanded into individual enemies for this viewport:
 * `[{ delay, type, path }]`, `delay` in seconds after the wave starts.
 */
export const expandWave = (wave, viewport) => {
    const { width, height } = viewport
    const enemies = []
    for (let i = 0; i < wave.count; i++) {
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
            case 'sweep': {
                const fromLeft = wave.side !== 'right'
                path = {
                    kind: 'sine',
                    fromX: fromLeft ? -OFF : width + OFF,
                    toX: fromLeft ? width + OFF : -OFF,
                    y: height * wave.y,
                    duration: 4.2,
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
            case 'hover':
            default: {
                const lanes = Math.max(1, wave.count)
                path = {
                    kind: 'hover',
                    x: width * (0.15 + (0.7 * (i + 0.5)) / lanes),
                    holdY: height * (wave.y || 0.22),
                    hold: 4.5,
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
    return {
        type: spec.type,
        path: spec.path,
        hp: Math.round(type.hp * difficulty),
        maxHp: Math.round(type.hp * difficulty),
        radius: type.radius,
        t: 0,
        x: 0,
        y: -OFF,
        // Stagger the first shot so a whole wave does not fire in unison.
        fireIn: type.fireEvery ? type.fireEvery * (0.4 + random() * 0.8) : Infinity,
        hurt: 0,
        dead: false,
    }
}

/** Advance an air enemy along its path. Returns false once it has left for good. */
export const stepAirEnemy = (enemy, dt) => {
    enemy.t += dt
    enemy.hurt = Math.max(0, enemy.hurt - dt)
    const point = pathPoint(enemy.path, enemy.t)
    enemy.vx = dt > 0 ? (point.x - enemy.x) / dt : 0
    enemy.x = point.x
    enemy.y = point.y
    return !point.done
}

export const canFireFrom = (y, viewport) => y > FIRE_ZONE.top && y < viewport.height * FIRE_ZONE.bottomShare

/**
 * Count down a shooter's timer; when it fires, return the bullets aimed at `target` (a little fan
 * for tougher kinds and later missions). Works for air and ground enemies alike.
 */
export const stepEnemyFire = (enemy, dt, target, viewport, difficulty, random) => {
    const type = ENEMY_TYPES[enemy.type]
    if (!type.fireEvery || enemy.hp <= 0) return []
    enemy.fireIn -= dt
    if (enemy.fireIn > 0) return []
    enemy.fireIn = (type.fireEvery * (0.75 + random() * 0.5)) / Math.sqrt(difficulty)
    if (!canFireFrom(enemy.y, viewport)) return []
    const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x)
    const speed = BULLET_SPEED * Math.sqrt(difficulty)
    const count = enemy.type === 'armoured' || difficulty >= 1.4 ? 3 : 1
    const bullets = []
    for (let i = 0; i < count; i++) {
        const a = angle + (i - (count - 1) / 2) * 0.18
        bullets.push({ x: enemy.x, y: enemy.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, age: 0 })
    }
    return bullets
}

/** Move a bullet on; returns false once it has left the screen. */
export const stepBullet = (bullet, dt, viewport) => {
    bullet.age += dt
    bullet.x += bullet.vx * dt
    bullet.y += bullet.vy * dt
    return bullet.x > -30 && bullet.y > -30 && bullet.x < viewport.width + 30 && bullet.y < viewport.height + 30
}

/** Damage an enemy; returns whether that destroyed it. */
export const damageEnemy = (enemy, amount) => {
    if (enemy.hp <= 0) return false
    enemy.hp = Math.max(0, enemy.hp - amount)
    enemy.hurt = 0.1
    return enemy.hp <= 0
}
