import { createRandom } from './rageDebris'
import {
    FACE_CAMERA_YAW,
    GREETING_DURATION,
    GREETING_STYLES,
    GREETING_TIMING,
    greetingPose,
    lerpAngle,
    LOOP_LEAN,
    LOOP_RADIUS,
    pickGreetingStyle,
} from './rageGreeting'

const plan = (style, facing = 1) => ({
    start: { x: 300, y: 400, z: 34, yaw: facing > 0 ? -0.25 : Math.PI + 0.25, facing },
    stage: { x: 640, y: 400 },
    closeZ: 700,
    style,
})

const HOLD_START = GREETING_TIMING.in
const HOLD_END = GREETING_TIMING.in + GREETING_TIMING.hold

describe("Anna's greeting", () => {
    it.each(GREETING_STYLES)('%s: starts and ends exactly where she was', style => {
        const p = plan(style)
        const first = greetingPose(0, p)
        const last = greetingPose(GREETING_DURATION, p)
        ;[first, last].forEach(pose => {
            expect(pose.x).toBeCloseTo(300)
            expect(pose.y).toBeCloseTo(400)
            expect(pose.z).toBeCloseTo(34)
        })
        expect(Math.cos(last.yaw)).toBeCloseTo(Math.cos(p.start.yaw))
        expect(Math.sin(last.yaw)).toBeCloseTo(Math.sin(p.start.yaw))
        expect(last.armPitch).toBeCloseTo(0)
        expect(last.done).toBe(true)
        expect(greetingPose(GREETING_DURATION - 0.01, p).done).toBe(false)
    })

    it('rises and arcs towards the camera in the first half of the loop, leaning into it', () => {
        const p = plan('wave')
        const quarter = greetingPose(GREETING_TIMING.in / 2, p)
        expect(quarter.y).toBeCloseTo(400 - LOOP_RADIUS)
        expect(quarter.z).toBeCloseTo((34 + 700) / 2)
        expect(quarter.pitch).toBeCloseTo(LOOP_LEAN)
    })

    it('greets at the front of the loop, upright and closest to the camera', () => {
        const p = plan('wave')
        const front = greetingPose(HOLD_START, p)
        expect(front.z).toBe(700)
        expect(front.x).toBe(640)
        expect(front.pitch).toBeCloseTo(0)
    })

    it('finishes the loop down and under, away from the camera', () => {
        const p = plan('wave')
        const threeQuarter = greetingPose(HOLD_END + GREETING_TIMING.out / 2, p)
        expect(threeQuarter.y).toBeCloseTo(400 + LOOP_RADIUS)
        expect(threeQuarter.z).toBeCloseTo((34 + 700) / 2)
        expect(threeQuarter.pitch).toBeCloseTo(-LOOP_LEAN)
    })

    it('is one continuous loop: no jump into or out of the greeting', () => {
        const p = plan('cheer')
        const beforeHold = greetingPose(HOLD_START - 1e-4, p)
        const holdStart = greetingPose(HOLD_START, p)
        const holdEnd = greetingPose(HOLD_END - 1e-4, p)
        const afterHold = greetingPose(HOLD_END, p)
        expect(Math.abs(beforeHold.x - holdStart.x)).toBeLessThan(0.5)
        expect(Math.abs(beforeHold.z - holdStart.z)).toBeLessThan(0.5)
        expect(Math.abs(holdEnd.x - afterHold.x)).toBeLessThan(0.5)
        expect(Math.abs(holdEnd.z - afterHold.z)).toBeLessThan(0.5)
    })

    it('greets close to the camera, facing it, with the speech bubble up', () => {
        const pose = greetingPose(HOLD_START + GREETING_TIMING.hold / 2, plan('wave'))
        expect(pose.z).toBe(700)
        expect(pose.x).toBe(640)
        expect(pose.yaw).toBeCloseTo(FACE_CAMERA_YAW)
        expect(pose.bubble).toBe(1)
        expect(pose.rearArm).toBeGreaterThan(2)
    })

    it('shows the bubble only while she greets', () => {
        expect(greetingPose(0.2, plan('cheer')).bubble).toBe(0)
        expect(greetingPose(GREETING_DURATION - 0.2, plan('cheer')).bubble).toBe(0)
    })

    it('raises both arms to cheer', () => {
        const pose = greetingPose(HOLD_START + 0.8, plan('cheer'))
        expect(pose.armPitch).toBeCloseTo(Math.PI / 2)
        expect(pose.rearArm).toBeGreaterThan(2.5)
    })

    it('bows towards the camera', () => {
        const pose = greetingPose(HOLD_START + GREETING_TIMING.hold * 0.27, plan('bow'))
        expect(pose.pitch).toBeGreaterThan(0.4)
    })

    it('flips head over heels', () => {
        const pose = greetingPose(HOLD_START + 0.75, plan('flip'))
        expect(pose.pitch).toBeCloseTo(-Math.PI * 2)
    })

    it('picks a different greeting from last time', () => {
        const random = createRandom(5)
        let previous = null
        for (let i = 0; i < 40; i++) {
            const style = pickGreetingStyle(random, previous)
            expect(GREETING_STYLES).toContain(style)
            expect(style).not.toBe(previous)
            previous = style
        }
    })

    it('turns the short way round', () => {
        expect(lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 1)).toBeCloseTo(Math.PI + 0.1)
        expect(lerpAngle(0, 1, 0.5)).toBeCloseTo(0.5)
    })
})
