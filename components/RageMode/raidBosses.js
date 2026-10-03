import { BOSS_HP } from './rageBoss'

/**
 * The five raid bosses, one per mission in turn: how each moves, what it throws, and when it gets
 * angrier. Pure — screen pixels and seconds, y down. The arena draws them and resolves collisions.
 *
 * Every boss has the same health (`BOSS_HP`, scaled only by the mission) and wears today's
 * open-task count on its chest, so a busy day and an empty inbox are the same fight — only the
 * number changes. What differs is the fight itself:
 *
 *   backlog   The Backlog — the angry red block: aimed fans, lunges, and mail swarms once hurt.
 *   inbox     Inbox Overlord — a giant tray that rains rows of letters with gaps to find.
 *   calendar  Calendar Colossus — books slots on your timeline: warned column beams, corner bursts.
 *   bell      Notification Storm — a swinging bell whose shockwave rings each leave one gap.
 *   clock     The Grand Deadline — counter-rotating spirals while its hands sweep as beams.
 *
 * Each boss has two phases: below half health it attacks faster and adds a move. Hazards beyond
 * plain bullets are BEAMS (a column, or a line swept around the boss) and WAVES (an expanding ring
 * with a gap). Both always telegraph before they can hurt: a beam is a thin warning line first,
 * and a wave's gap is visible from the moment it leaves.
 */

export const BOSS_ORDER = ['backlog', 'inbox', 'calendar', 'bell', 'clock']

export const BOSS_KINDS = {
    backlog: { halfWidth: 78, halfHeight: 66, holdY: 0.26 },
    inbox: { halfWidth: 120, halfHeight: 62, holdY: 0.2 },
    calendar: { halfWidth: 104, halfHeight: 90, holdY: 0.24 },
    bell: { halfWidth: 82, halfHeight: 78, holdY: 0.24 },
    clock: { halfWidth: 96, halfHeight: 96, holdY: 0.28 },
}

export const ORB_SPEED = 290
export const ORB_RADIUS = 11
export const BEAM_WARN = 1.0
export const BEAM_ACTIVE = 0.7
export const COLUMN_WIDTH = 46
export const SWEEP_WIDTH = 30
export const WAVE_SPEED = 175
export const WAVE_THICKNESS = 16
export const WAVE_GAP = 0.75

/** Which boss ends mission `n`: the five in turn. */
export const bossKindFor = mission => BOSS_ORDER[(Math.max(1, mission) - 1) % BOSS_ORDER.length]

export const createRaidBoss = (kind, openTasks, viewport, hp = BOSS_HP) => {
    const shape = BOSS_KINDS[kind] || BOSS_KINDS.backlog
    return {
        kind: BOSS_KINDS[kind] ? kind : 'backlog',
        openTasks: Math.max(0, openTasks || 0),
        hp,
        maxHp: hp,
        halfWidth: shape.halfWidth,
        halfHeight: shape.halfHeight,
        x: viewport.width / 2,
        y: -shape.halfHeight * 2,
        t: 0,
        phase: 'entering',
        hurt: 0,
        timers: { a: 2.2, b: 5, c: 9 },
        charge: null,
        spiral: 0,
    }
}

/** The number on its chest: the open-task count, counting down with its health. 0 on an empty day. */
export const displayedCount = boss =>
    boss.hp <= 0 || !boss.openTasks ? 0 : Math.max(1, Math.ceil((boss.hp / boss.maxHp) * boss.openTasks))

/** Below half health a boss attacks faster and adds a move. */
export const isEnraged = boss => boss.hp < boss.maxHp / 2

export const insideRaidBoss = (boss, x, y, pad = 0) =>
    boss.hp > 0 && Math.abs(x - boss.x) <= boss.halfWidth + pad && Math.abs(y - boss.y) <= boss.halfHeight + pad

export const damageRaidBoss = (boss, amount) => {
    if (boss.hp <= 0) return false
    boss.hp = Math.max(0, boss.hp - amount)
    boss.hurt = 0.12
    return boss.hp <= 0
}

const orb = (x, y, angle, speed, tint) => ({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    age: 0,
    tint,
})
const fan = (boss, target, count, gap, speed, tint) => {
    const aim = Math.atan2(target.y - boss.y, target.x - boss.x)
    return Array.from({ length: count }, (_, i) => orb(boss.x, boss.y, aim + (i - (count - 1) / 2) * gap, speed, tint))
}
const ring = (x, y, count, speed, offset, tint) =>
    Array.from({ length: count }, (_, i) => orb(x, y, offset + (Math.PI * 2 * i) / count, speed, tint))

// Where each boss likes to be when it is not doing something special.
const hoverPoint = (boss, viewport) => {
    const shape = BOSS_KINDS[boss.kind]
    const baseY = Math.max(boss.halfHeight + 70, viewport.height * shape.holdY)
    switch (boss.kind) {
        case 'inbox':
            return { x: viewport.width / 2 + Math.sin(boss.t * 0.4) * viewport.width * 0.3, y: baseY }
        case 'calendar':
            return { x: viewport.width / 2 + Math.sin(boss.t * 0.25) * viewport.width * 0.12, y: baseY }
        case 'bell':
            return {
                x: viewport.width / 2 + Math.sin(boss.t * 0.7) * viewport.width * 0.25,
                y: baseY + Math.sin(boss.t * 1.4) * 20,
            }
        case 'clock':
            return { x: viewport.width / 2, y: baseY + Math.sin(boss.t * 0.6) * 14 }
        default:
            return {
                x: viewport.width / 2 + Math.sin(boss.t * 0.55) * viewport.width * 0.3,
                y: baseY + Math.sin(boss.t * 1.3) * 36,
            }
    }
}

/**
 * Advance a boss by `dt`. Returns what it unleashed this step:
 * `{ orbs, beams, waves, spawns }` — bullets, beams (`{kind:'column', x}` or
 * `{kind:'sweep', from, to}` in radians), expanding rings (`{gapAngle}`) and wave specs for minions.
 */
export const stepRaidBoss = (boss, dt, target, viewport, random) => {
    boss.t += dt
    boss.hurt = Math.max(0, boss.hurt - dt)
    const out = { orbs: [], beams: [], waves: [], spawns: [] }
    if (boss.hp <= 0) return out

    if (boss.phase === 'entering') {
        const goal = hoverPoint(boss, viewport)
        boss.x += (goal.x - boss.x) * Math.min(1, dt * 2.2)
        boss.y += (goal.y - boss.y) * Math.min(1, dt * 2.2)
        if (Math.abs(boss.y - goal.y) < 4) boss.phase = 'fighting'
        return out
    }

    if (boss.charge) {
        // A lunge at where Anna WAS, and back: the Backlog's signature move.
        boss.charge.t += dt
        const k = boss.charge.t / boss.charge.duration
        const there = k < 0.5 ? k * 2 : 2 - k * 2
        const eased = there * there * (3 - 2 * there)
        boss.x = boss.charge.from.x + (boss.charge.to.x - boss.charge.from.x) * eased
        boss.y = boss.charge.from.y + (boss.charge.to.y - boss.charge.from.y) * eased
        if (k >= 1) boss.charge = null
        return out
    }

    const goal = hoverPoint(boss, viewport)
    boss.x += (goal.x - boss.x) * Math.min(1, dt * 3)
    boss.y += (goal.y - boss.y) * Math.min(1, dt * 3)

    const enraged = isEnraged(boss)
    const fury = enraged ? 0.65 : 1
    const timers = boss.timers
    timers.a -= dt
    timers.b -= dt
    timers.c -= dt

    switch (boss.kind) {
        case 'inbox': {
            // Letter rain: a row of letters across the whole width with gaps to slip through.
            if (timers.a <= 0) {
                timers.a = 2.4 * fury
                const gaps = enraged ? 1 : 2
                const step = 46
                const holes = Array.from({ length: gaps }, () => 60 + random() * (viewport.width - 120))
                for (let x = step / 2; x < viewport.width; x += step) {
                    if (holes.some(hole => Math.abs(hole - x) < 70)) continue
                    out.orbs.push(orb(x, boss.y + boss.halfHeight, Math.PI / 2, 190, '#2F80ED'))
                }
            }
            if (timers.b <= 0) {
                timers.b = 7 * fury
                out.spawns.push({ pattern: 'weave', type: 'mail', count: 6, spacing: 0.3, x: 0.25 + random() * 0.5 })
            }
            if (enraged && timers.c <= 0) {
                timers.c = 1.6
                out.orbs.push(...fan(boss, target, 7, 0.16, ORB_SPEED, '#2F80ED'))
            }
            break
        }
        case 'calendar': {
            // Booked slots: columns that flash a warning, then burn. One is always on Anna.
            if (timers.a <= 0) {
                timers.a = 3 * fury
                const count = enraged ? 3 : 2
                out.beams.push({ kind: 'column', x: target.x })
                for (let i = 1; i < count; i++)
                    out.beams.push({ kind: 'column', x: 50 + random() * (viewport.width - 100) })
            }
            if (timers.b <= 0) {
                timers.b = 3.2 * fury
                const corners = [
                    [-1, -1],
                    [1, -1],
                    [-1, 1],
                    [1, 1],
                ]
                corners.forEach(([sx, sy], i) =>
                    out.orbs.push(
                        ...ring(
                            boss.x + sx * boss.halfWidth * 0.8,
                            boss.y + sy * boss.halfHeight * 0.8,
                            enraged ? 10 : 8,
                            200,
                            i * 0.2 + boss.t,
                            '#7E57C2'
                        )
                    )
                )
            }
            break
        }
        case 'bell': {
            // Shockwaves: rings that grow from the bell, each with one gap to fly through.
            if (timers.a <= 0) {
                timers.a = 2.5 * fury
                const toward = Math.atan2(target.y - boss.y, target.x - boss.x)
                out.waves.push({ gapAngle: toward + (random() - 0.5) * 2.4 })
            }
            if (timers.b <= 0) {
                timers.b = 5 * fury
                out.spawns.push({ pattern: 'swarm', type: 'ping', count: enraged ? 5 : 3, spacing: 0.35 })
            }
            if (enraged && timers.c <= 0) {
                timers.c = 2.2
                out.orbs.push(...fan(boss, target, 5, 0.25, ORB_SPEED, '#E53935'))
            }
            break
        }
        case 'clock': {
            // Counter-rotating spirals that never stop, and the hands sweeping as beams.
            if (timers.a <= 0) {
                timers.a = enraged ? 0.09 : 0.13
                boss.spiral += 0.27
                ;[boss.spiral, -boss.spiral * 1.3].forEach((angle, i) =>
                    out.orbs.push(orb(boss.x, boss.y, angle + (i ? Math.PI / 2 : 0), 170, '#EF6C00'))
                )
            }
            if (timers.b <= 0) {
                timers.b = 6.5 * fury
                const start = Math.PI * 0.15 + random() * 0.4
                out.beams.push({ kind: 'sweep', from: start, to: start + Math.PI * 0.7 })
                if (enraged)
                    out.beams.push({ kind: 'sweep', from: Math.PI - start, to: Math.PI - start - Math.PI * 0.7 })
            }
            break
        }
        default: {
            // The Backlog: fans at Anna, a lunge now and then, mail swarms once it is hurt.
            if (timers.a <= 0) {
                timers.a = (1.6 + random() * 1.1) * fury
                out.orbs.push(...fan(boss, target, enraged ? 5 : 3, 0.22, ORB_SPEED, '#D32F2F'))
            }
            if (timers.c <= 0) {
                timers.c = (7 + random() * 4) * fury
                boss.charge = { t: 0, duration: 1.1, from: { x: boss.x, y: boss.y }, to: { x: target.x, y: target.y } }
            }
            if (enraged && timers.b <= 0) {
                timers.b = 6
                out.spawns.push({
                    pattern: 'weave',
                    type: 'mail',
                    count: 5,
                    spacing: 0.3,
                    x: random() < 0.5 ? 0.3 : 0.7,
                })
            }
        }
    }
    return out
}

/* Hazards: beams and waves, shared by every boss. */

export const createBeam = (spec, boss) => ({ ...spec, age: 0, cx: boss.x, cy: boss.y })

/** Where a beam is now; `live` while it can hurt (after its warning). Returns false once spent. */
export const stepBeam = (beam, dt, boss) => {
    beam.age += dt
    if (boss && beam.kind === 'sweep') {
        beam.cx = boss.x
        beam.cy = boss.y
    }
    beam.live = beam.age >= BEAM_WARN && beam.age < BEAM_WARN + BEAM_ACTIVE
    if (beam.kind === 'sweep') {
        // It turns during the warning AND while live, so the line you see is the line that burns.
        const k = Math.min(1, beam.age / (BEAM_WARN + BEAM_ACTIVE))
        beam.angle = beam.from + (beam.to - beam.from) * k
    }
    return beam.age < BEAM_WARN + BEAM_ACTIVE
}

/** Does a live beam touch a circle of radius `r` at (x, y)? */
export const beamHits = (beam, x, y, r) => {
    if (!beam.live) return false
    if (beam.kind === 'column') return Math.abs(x - beam.x) < COLUMN_WIDTH / 2 + r
    const dx = Math.cos(beam.angle)
    const dy = Math.sin(beam.angle)
    const along = (x - beam.cx) * dx + (y - beam.cy) * dy
    if (along < 0) return false
    const across = Math.abs((x - beam.cx) * dy - (y - beam.cy) * dx)
    return across < SWEEP_WIDTH / 2 + r
}

export const createWave = (spec, boss) => ({ ...spec, x: boss.x, y: boss.y, radius: boss.halfWidth * 0.6, age: 0 })

/** Grow a wave; returns false once it has left the screen. */
export const stepWave = (wave, dt, viewport) => {
    wave.age += dt
    wave.radius += WAVE_SPEED * dt
    return wave.radius < Math.hypot(viewport.width, viewport.height)
}

const angleGap = (a, b) => {
    let d = (a - b) % (Math.PI * 2)
    if (d > Math.PI) d -= Math.PI * 2
    if (d < -Math.PI) d += Math.PI * 2
    return Math.abs(d)
}

/** Does a wave's ring touch a circle at (x, y)? Not where its gap is. */
export const waveHits = (wave, x, y, r) => {
    const distance = Math.hypot(x - wave.x, y - wave.y)
    if (Math.abs(distance - wave.radius) > WAVE_THICKNESS / 2 + r) return false
    const angle = Math.atan2(y - wave.y, x - wave.x)
    return angleGap(angle, wave.gapAngle) > WAVE_GAP / 2
}
