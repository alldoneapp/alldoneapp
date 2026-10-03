/**
 * Anna's greeting in the raid (Enter, or 👋): ONE loop that runs towards the camera. She rises and arcs
 * forward until she is about 2.6x her size at the front of the loop, stops there to greet you with
 * one of a few poses and a speech bubble, then finishes the loop by dipping down and back to exactly
 * where she started — and carries on.
 *
 * The loop lies in the plane of screen-y and depth: the first half goes UP and OVER towards the
 * viewer, the second half goes DOWN and UNDER away from them, so she arrives at the greeting and
 * leaves it along one continuous circle. She stays upright on her jetpack throughout and leans into
 * the direction she is flying (towards the camera on the way in, away from it on the way out).
 *
 * Pure: `greetingPose` maps elapsed time to a pose, so the choreography can be tuned and tested
 * without three.js. Screen space (px, y down) for position; z is towards the viewer. Angles are the
 * hero's own rig: `yaw` turns the figure (−π/2 faces the camera), `pitch` tips it towards the
 * camera (a lean, a bow, a somersault), `roll` turns it in the screen plane, `armPitch` swings the
 * blaster arm up/down, `armSpread` swings it out sideways, `rearArm` raises the free arm out to the
 * side, `headTilt` tips the head sideways.
 */

export const GREETING_STYLES = ['wave', 'cheer', 'twirl', 'bow', 'flip']

// in: the first half of the loop · hold: the greeting at its front · out: the second half.
export const GREETING_TIMING = { in: 1.0, hold: 1.9, out: 1.0 }
export const GREETING_DURATION = GREETING_TIMING.in + GREETING_TIMING.hold + GREETING_TIMING.out

// How far above (first half) and below (second half) her path the loop swings, in screen px.
export const LOOP_RADIUS = 110
// How far she leans into the direction of travel while looping.
export const LOOP_LEAN = 0.6
// Not straight at the camera: a slight three-quarter view reads as a person rather than a sign.
export const FACE_CAMERA_YAW = -Math.PI / 2 + 0.2

const clamp01 = value => Math.max(0, Math.min(1, value))
const ease = t => {
    const c = clamp01(t)
    return c < 0.5 ? 4 * c ** 3 : 1 - (-2 * c + 2) ** 3 / 2
}
const lerp = (a, b, t) => a + (b - a) * t

/** Interpolate between two angles along the shorter way round. */
export const lerpAngle = (from, to, t) => {
    let delta = (to - from) % (Math.PI * 2)
    if (delta > Math.PI) delta -= Math.PI * 2
    if (delta < -Math.PI) delta += Math.PI * 2
    return from + delta * t
}

/** A different style from last time, so pressing Space twice shows something new. */
export const pickGreetingStyle = (random, previous) => {
    const options = GREETING_STYLES.filter(style => style !== previous)
    return options[Math.min(options.length - 1, Math.floor(random() * options.length))]
}

const wave = h => 2.45 + Math.sin(h * 14) * 0.38

// Each style is the pose for `h` seconds into the hold (0 … GREETING_TIMING.hold).
const HOLD_POSES = {
    wave: h => ({ rearArm: wave(h), armPitch: -1.15, headTilt: Math.sin(h * 3.2) * 0.14 }),
    cheer: h => ({
        rearArm: 2.85,
        armPitch: Math.PI / 2,
        armSpread: 0.4,
        lift: Math.abs(Math.sin(h * 6.5)) * 16,
        headTilt: Math.sin(h * 6.5) * 0.08,
    }),
    twirl: h => ({
        yawSpin: Math.PI * 4 * ease(h / (GREETING_TIMING.hold * 0.8)),
        rearArm: 1.55,
        armPitch: 0.8,
        armSpread: 0.5,
    }),
    bow: h => {
        const bowPart = clamp01(h / (GREETING_TIMING.hold * 0.55))
        return {
            pitch: Math.sin(Math.PI * bowPart) * 0.6,
            rearArm: bowPart >= 1 ? wave(h) : 0.2,
            armPitch: -1.3,
            headTilt: bowPart >= 1 ? 0.12 : 0,
        }
    },
    flip: h => {
        const flipPart = ease(h / 0.75)
        const done = h >= 0.75
        return {
            pitch: -Math.PI * 2 * flipPart,
            lift: Math.sin(Math.PI * clamp01(h / 0.75)) * 36,
            rearArm: done ? 2.85 : 0.6,
            armPitch: done ? Math.PI / 2 : 0.2,
            armSpread: done ? 0.4 : 0,
        }
    },
}

const NEUTRAL = { pitch: 0, roll: 0, armPitch: 0, armSpread: 0, rearArm: 0.15, headTilt: 0, lift: 0, yawSpin: 0 }

/**
 * Where she is on the loop at angle `phi` (0 = where she started, π = the front of the loop, closest
 * to the camera, 2π = back where she started). Between start and front she also drifts towards the
 * stage (usually the middle of the screen), so a close-up never runs off the edge.
 */
export const loopPoint = (phi, { start, stage, closeZ }) => {
    const towardsFront = (1 - Math.cos(phi)) / 2
    return {
        x: lerp(start.x, stage.x, towardsFront),
        y: lerp(start.y, stage.y, towardsFront) - LOOP_RADIUS * Math.sin(phi),
        z: lerp(start.z, closeZ, towardsFront),
        // Velocity along the loop points towards the camera in the first half and away in the
        // second; she leans with it and is upright again at the front, where she greets.
        pitch: LOOP_LEAN * Math.sin(phi),
    }
}

/**
 * The pose `t` seconds into a greeting.
 *
 * @param {number} t
 * @param {object} plan
 * @param {{x:number,y:number,z:number,yaw:number,facing:number}} plan.start where she was
 * @param {{x:number,y:number}} plan.stage where she greets from (usually the middle of the screen)
 * @param {number} plan.closeZ how close to the camera she comes
 * @param {string} plan.style one of GREETING_STYLES
 */
export const greetingPose = (t, plan) => {
    const { start, closeZ, style } = plan
    const holdPose = HOLD_POSES[style] || HOLD_POSES.wave
    const holdEnd = GREETING_TIMING.in + GREETING_TIMING.hold

    if (t < GREETING_TIMING.in) {
        // First half of the loop: up and over towards the camera, turning to face it.
        const u = ease(t / GREETING_TIMING.in)
        const point = loopPoint(Math.PI * u, plan)
        const target = { ...NEUTRAL, ...holdPose(0) }
        return {
            ...NEUTRAL,
            ...point,
            yaw: lerpAngle(start.yaw, FACE_CAMERA_YAW, u),
            rearArm: lerp(NEUTRAL.rearArm, target.rearArm, u),
            armPitch: lerp(0, target.armPitch, u),
            armSpread: lerp(0, target.armSpread, u),
            bubble: 0,
            done: false,
        }
    }

    if (t < holdEnd) {
        // At the front of the loop: the greeting.
        const h = t - GREETING_TIMING.in
        const front = loopPoint(Math.PI, plan)
        const pose = { ...NEUTRAL, ...holdPose(h) }
        const bob = Math.sin(h * 3) * 4
        return {
            ...pose,
            x: front.x,
            y: front.y + bob - pose.lift,
            z: closeZ,
            yaw: FACE_CAMERA_YAW + pose.yawSpin,
            bubble: Math.min(clamp01(h / 0.18), clamp01((GREETING_TIMING.hold - h) / 0.22)),
            done: false,
        }
    }

    // Second half of the loop: down and under, away from the camera, back to where she started.
    const u = ease((t - holdEnd) / GREETING_TIMING.out)
    const point = loopPoint(Math.PI + Math.PI * u, plan)
    const last = { ...NEUTRAL, ...holdPose(GREETING_TIMING.hold) }
    return {
        ...NEUTRAL,
        ...point,
        yaw: lerpAngle(FACE_CAMERA_YAW, start.yaw, u),
        rearArm: lerp(last.rearArm, NEUTRAL.rearArm, u),
        armPitch: lerp(last.armPitch, 0, u),
        armSpread: lerp(last.armSpread, 0, u),
        bubble: 0,
        done: t >= GREETING_DURATION,
    }
}
