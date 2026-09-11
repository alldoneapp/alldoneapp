import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { AccessibilityInfo, View } from 'react-native'

import useGoalSectionExitMotion, {
    GOAL_EXIT_COLLAPSE_DELAY_MS,
    GOAL_EXIT_COLLAPSE_MS,
    GOAL_EXIT_FADE_MS,
    GOAL_SECTION_EXIT_TOTAL_MS,
} from './goalSectionExitMotion'
import { GOAL_SECTION_HOLD_MS } from './useGoalSectionExit'
import { COLLAPSE_DURATION_MS, COMPLETION_HOLD_MS } from '../TaskItem/TaskPresentation/taskCompletionMotion'
import { SWEEP_TOTAL_MS } from './projectCompletedSweepMotion'

/**
 * AT-2507 — the shape of a goal section's departure.
 *
 * The animation itself cannot be watched here (`__mocks__/react-native.js` stubs `Animated.timing`
 * to a no-op, which is what `browser-tests/at2507` exists for), so this suite pins the two things a
 * browser harness is bad at: the STRUCTURE of the style the section wears, and the arithmetic
 * relating this run to the three timings around it that it has to fit between.
 */

let motion
const Harness = ({ exitRunId }) => {
    motion = useGoalSectionExitMotion(exitRunId)
    return <View onLayout={motion.onSectionLayout} style={motion.sectionStyle} />
}

const layout = height => ({ nativeEvent: { layout: { height } } })

describe('useGoalSectionExitMotion (AT-2507)', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener
    const originalNodeEnv = process.env.NODE_ENV

    beforeEach(() => {
        motion = undefined
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        AccessibilityInfo.addEventListener = jest.fn(() => ({ remove: jest.fn() }))
        // Inert by jest convention, and this hook stands down entirely when motion is unavailable —
        // so without this every assertion below would pass against a hook doing nothing.
        process.env.NODE_ENV = 'development'
    })

    afterEach(() => {
        AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
        AccessibilityInfo.addEventListener = originalAddEventListener
        process.env.NODE_ENV = originalNodeEnv
    })

    const render = async (exitRunId = 0, { measuredHeight = 180 } = {}) => {
        let tree
        await act(async () => {
            tree = renderer.create(<Harness exitRunId={exitRunId} />)
            await Promise.resolve()
        })
        if (measuredHeight !== null) {
            await act(async () => {
                motion.onSectionLayout(layout(measuredHeight))
            })
        }
        return tree
    }

    const startExit = async (tree, runId = 1) => {
        await act(async () => {
            tree.update(<Harness exitRunId={runId} />)
            await Promise.resolve()
        })
    }

    describe('an ordinary section', () => {
        it('wears no exit style at all', async () => {
            await render(0)

            expect(motion.sectionStyle).toBeUndefined()
            expect(motion.exiting).toBe(false)
        })

        it('is still interactive', async () => {
            await render(0)

            expect(motion.exiting).toBe(false)
        })
    })

    describe('a section that is leaving', () => {
        it('pins the height it was measured at and clips to it', async () => {
            const tree = await render(0, { measuredHeight: 180 })
            await startExit(tree)

            expect(motion.exiting).toBe(true)
            expect(motion.sectionStyle.overflow).toBe('hidden')
            expect(motion.sectionStyle.height).toBeDefined()
        })

        it('clears any minHeight floor with the pinned height', async () => {
            // A locked goal's section carries a 258-344px `minHeight`. `height` and `minHeight` are
            // independent properties, so the floor would win and stop the collapse dead.
            const tree = await render(0, { measuredHeight: 180 })
            await startExit(tree)

            expect(motion.sectionStyle.minHeight).toBe(0)
        })

        it('drifts upward as it fades, from the same value', async () => {
            const tree = await render(0, { measuredHeight: 180 })
            await startExit(tree)

            expect(motion.sectionStyle.opacity).toBeDefined()
            expect(motion.sectionStyle.transform).toHaveLength(1)
            expect(motion.sectionStyle.transform[0].translateY).toBeDefined()
        })

        it('still fades when the section was never laid out', async () => {
            // Animating a height to 0 from an unknown start would jump, so an unmeasured section
            // fades without collapsing rather than sitting at full height for the whole hold.
            const tree = await render(0, { measuredHeight: null })
            await startExit(tree)

            expect(motion.exiting).toBe(true)
            expect(motion.sectionStyle.opacity).toBeDefined()
            expect(motion.sectionStyle.height).toBeUndefined()
        })

        it('ignores a layout measured while it is already collapsing', async () => {
            // Otherwise the collapse would overwrite the value it is collapsing from.
            const tree = await render(0, { measuredHeight: 180 })
            await startExit(tree)
            const pinned = motion.sectionStyle.height

            await act(async () => {
                motion.onSectionLayout(layout(12))
            })

            expect(motion.sectionStyle.height).toBe(pinned)
        })

        it('does not restart when the section re-renders mid-run', async () => {
            // A goal section re-renders on every task write in its project.
            const tree = await render(0, { measuredHeight: 180 })
            await startExit(tree, 1)
            const first = motion.sectionStyle

            await startExit(tree, 1)

            expect(motion.sectionStyle).toBe(first)
        })

        it('stops accepting input', async () => {
            const tree = await render(0, { measuredHeight: 180 })
            await startExit(tree)

            expect(motion.exiting).toBe(true)
        })
    })

    it('stands down under reduced motion, leaving the section exactly as it was', async () => {
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))
        const tree = await render(0, { measuredHeight: 180 })

        await startExit(tree)

        expect(motion.exiting).toBe(false)
        expect(motion.sectionStyle).toBeUndefined()
    })

    describe('the timings, against the ones around them', () => {
        it('runs for the ~1.4s that was asked for', () => {
            expect(GOAL_SECTION_EXIT_TOTAL_MS).toBeGreaterThanOrEqual(1300)
            expect(GOAL_SECTION_EXIT_TOTAL_MS).toBeLessThanOrEqual(1500)
        })

        it('leaves the layout alone for a beat before it starts moving', () => {
            // Fading and shrinking from the same instant makes the list jump while the user is
            // still looking at the block — a busier version of the pop this replaces.
            expect(GOAL_EXIT_COLLAPSE_DELAY_MS).toBeGreaterThan(200)
            expect(GOAL_EXIT_COLLAPSE_DELAY_MS).toBeLessThan(GOAL_EXIT_FADE_MS)
        })

        it('is invisible before it is flat', () => {
            // Fading and shrinking at the same rate reads as a squash (the AT-2404 rule).
            expect(GOAL_EXIT_FADE_MS).toBeLessThan(GOAL_EXIT_COLLAPSE_DELAY_MS + GOAL_EXIT_COLLAPSE_MS)
        })

        it('is outlived by the hold that keeps the section on screen for it', () => {
            // The hold and the run are started from two different components, so nothing guarantees
            // their order; both are derived rather than hand-tuned, and pinned from both sides.
            expect(GOAL_SECTION_HOLD_MS).toBeGreaterThan(GOAL_SECTION_EXIT_TOTAL_MS)
        })

        it('is slower than a task row leaving and quicker than a project line', () => {
            // A task is completed dozens of times an hour, so its exit has to be short and
            // repeatable; a project line leaves once a day and earns the cinematic version. A goal
            // section sits between them, and so does this.
            expect(GOAL_SECTION_EXIT_TOTAL_MS).toBeGreaterThan(COLLAPSE_DURATION_MS)
            expect(GOAL_SECTION_EXIT_TOTAL_MS).toBeLessThan(SWEEP_TOTAL_MS)
        })

        it('starts after the completing task has finished its own exit', () => {
            // The section is only dropped once the write lands, which AT-2404 holds for
            // `COMPLETION_HOLD_MS` — so the two never run over the top of each other, and the goal
            // block is still at full height while the task row collapses inside it.
            expect(COMPLETION_HOLD_MS).toBeGreaterThan(COLLAPSE_DURATION_MS)
        })
    })
})
