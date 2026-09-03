import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { AccessibilityInfo } from 'react-native'

import useProjectCompletedSweepMotion, {
    PROJECT_LINE_EXIT_HOLD_MS,
    SWEEP_EXIT_TOTAL_MS,
    SWEEP_FILL_MS,
    SWEEP_LEAD_MS,
    SWEEP_PULSE_MS,
    SWEEP_SETTLE_MS,
    SWEEP_SHIMMER_MS,
    SWEEP_TOTAL_MS,
    useProjectLineExit,
} from './projectCompletedSweepMotion'
import { DISINTEGRATION_DURATION_MS, DISSOLVE_MASK_IMAGE } from './projectLineDisintegration'

/**
 * AT-2495 (second pass) — stage 4 of the completed sweep, which is two different stages.
 *
 * A line that STAYS settles: everything fades and the row is handed back exactly as it was found.
 * A line that LEAVES disintegrates: the row is masked, erased right to left, and its height closes
 * behind it. Which one runs is the subject of this suite, and it is the one piece of this feature
 * whose failure mode is invisible — a settle is a perfectly plausible-looking animation, so a branch
 * that picks it wrongly does not look broken, it looks like the disintegration was never built.
 *
 * The reason it can be picked wrongly is a race. The celebration starts on the `sidebarNumbers`
 * snapshot; the fact that the board is dropping the block arrives separately, through
 * `thereAreNotTasksInFirstDay`, and is routinely SECOND. Deciding at `start()` would therefore have
 * chosen the settle for the ordinary case. The branch is read 2.1s in instead, from a ref.
 *
 * `__mocks__/react-native.js` stubs `Animated.timing` to a no-op, so nothing here can watch a value
 * advance — what is driven is the SCHEDULE (fake timers) and what is asserted is the state the
 * schedule produces. `browser-tests/at2495` is where the paint is checked.
 */

const ROW_HEIGHT = 57

const Harness = ({ runId, lineWillLeave, onState }) => {
    const motion = useProjectCompletedSweepMotion(runId, lineWillLeave)
    const exit = useProjectLineExit(motion)
    onState({ motion, exit })
    // The measurement `ProjectHeader` gets from `onLayout`; jsdom lays nothing out.
    React.useEffect(() => {
        exit.onLineLayout({ nativeEvent: { layout: { height: ROW_HEIGHT, width: 900 } } })
    }, [exit.onLineLayout])
    return null
}

describe('the completed sweep exit branch (AT-2495)', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener
    const originalNodeEnv = process.env.NODE_ENV
    let state

    beforeEach(() => {
        jest.useFakeTimers()
        state = null
        // Both opt-outs are required. Motion is inert under jest by convention and stands down under
        // reduced motion; a suite that forgets either one asserts against a component that did
        // nothing, which is exactly how AT-2445's predecessor rotted.
        window.matchMedia = jest.fn(() => ({
            matches: false,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            addListener: jest.fn(),
            removeListener: jest.fn(),
        }))
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        AccessibilityInfo.addEventListener = jest.fn(() => ({ remove: jest.fn() }))
        process.env.NODE_ENV = 'development'
    })

    afterEach(() => {
        jest.useRealTimers()
        AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
        AccessibilityInfo.addEventListener = originalAddEventListener
        process.env.NODE_ENV = originalNodeEnv
    })

    const mount = async ({ runId = 1, lineWillLeave = false } = {}) => {
        let tree
        await act(async () => {
            tree = renderer.create(
                <Harness runId={runId} lineWillLeave={lineWillLeave} onState={next => (state = next)} />
            )
        })
        return tree
    }

    const update = async (tree, props) => {
        await act(async () => {
            tree.update(<Harness onState={next => (state = next)} {...props} />)
        })
    }

    const advance = async ms => {
        await act(async () => {
            jest.advanceTimersByTime(ms)
        })
    }

    describe('the timeline', () => {
        it('branches after all three of the sweep stages, never during one', () => {
            // The row must not start coming apart while the celebration is still making its point.
            expect(SWEEP_LEAD_MS).toBe(SWEEP_FILL_MS + SWEEP_SHIMMER_MS + SWEEP_PULSE_MS)
            expect(SWEEP_TOTAL_MS).toBe(SWEEP_LEAD_MS + SWEEP_SETTLE_MS)
            expect(SWEEP_EXIT_TOTAL_MS).toBe(SWEEP_LEAD_MS + DISINTEGRATION_DURATION_MS)
        })

        it('keeps the board hold longer than the run it is covering', () => {
            /**
             * The hold and the run are started from two different components (`OpenTasksByProject`
             * and the overlay inside `ProjectHeader`), so nothing guarantees the order of their
             * timers. The inequality is what stops the board dropping the block mid-dissolve.
             */
            expect(PROJECT_LINE_EXIT_HOLD_MS).toBeGreaterThan(SWEEP_EXIT_TOTAL_MS)
            expect(PROJECT_LINE_EXIT_HOLD_MS).toBeGreaterThan(SWEEP_TOTAL_MS)
        })
    })

    describe('a line that stays put (the selected-project board)', () => {
        it('settles and never masks the row', async () => {
            const tree = await mount({ lineWillLeave: false })
            expect(state.motion.sweeping).toBe(true)

            await advance(SWEEP_LEAD_MS + 10)
            expect(state.motion.exiting).toBe(false)
            expect(state.exit.exitStyle).toBeUndefined()

            // …and it hands the row back completely once the settle is over.
            await advance(SWEEP_SETTLE_MS + 100)
            expect(state.motion.sweeping).toBe(false)
            expect(state.exit.exitStyle).toBeUndefined()
            tree.unmount()
        })
    })

    describe('a line that is leaving (All Projects)', () => {
        it('disintegrates instead of settling', async () => {
            const tree = await mount({ lineWillLeave: true })

            // Nothing is masked while the celebration is still running.
            await advance(SWEEP_LEAD_MS - 50)
            expect(state.motion.exiting).toBe(false)
            expect(state.exit.exitStyle).toBeUndefined()

            await advance(100)
            expect(state.motion.exiting).toBe(true)
            expect(state.exit.exitStyle.maskImage).toBe(DISSOLVE_MASK_IMAGE)
            expect(state.exit.exitHeight).toBe(ROW_HEIGHT)
            tree.unmount()
        })

        it('leaves the erased row erased, rather than flashing it back before the board drops it', async () => {
            /**
             * The exit deliberately does not reset itself: the board unmounts the block ~120ms after
             * the run ends, and a row that popped back to full height for those 120ms would flash —
             * worse than the exit it is ending.
             */
            const tree = await mount({ lineWillLeave: true })
            await advance(SWEEP_EXIT_TOTAL_MS + 60)

            expect(state.motion.exiting).toBe(true)
            expect(state.exit.exitStyle).toBeDefined()
            tree.unmount()
        })

        it('puts an abandoned exit back rather than leaving an invisible hole', async () => {
            /**
             * The backstop. If the board never drops the block — the hold miscomputed, a re-render
             * resurrected it — the row would otherwise stay masked to nothing and collapsed to zero
             * height: present, unclickable and invisible until something remounted it. A line that
             * reappears a moment late is a cosmetic oddity; that is a bug you have to reload to
             * clear.
             */
            const tree = await mount({ lineWillLeave: true })
            await advance(PROJECT_LINE_EXIT_HOLD_MS + 500)

            expect(state.motion.exiting).toBe(false)
            expect(state.exit.exitStyle).toBeUndefined()
            tree.unmount()
        })
    })

    describe('the race the branch exists for', () => {
        it('honours a verdict that arrives AFTER the celebration has started', async () => {
            // The ordinary production order. Deciding at `start()` would have picked the settle here
            // and the disintegration would never have been seen.
            const tree = await mount({ lineWillLeave: false })
            await update(tree, { runId: 1, lineWillLeave: true })

            await advance(SWEEP_LEAD_MS + 10)
            expect(state.motion.exiting).toBe(true)
            expect(state.exit.exitStyle).toBeDefined()
            tree.unmount()
        })

        it('honours a verdict that arrives before it', async () => {
            const tree = await mount({ lineWillLeave: true })
            await advance(SWEEP_LEAD_MS + 10)
            expect(state.motion.exiting).toBe(true)
            tree.unmount()
        })

        it('does not disintegrate a line whose verdict was withdrawn before stage 4', async () => {
            // A task landing back in the project during the sweep. The line stays, so it settles.
            const tree = await mount({ lineWillLeave: true })
            await update(tree, { runId: 1, lineWillLeave: false })

            await advance(SWEEP_LEAD_MS + 10)
            expect(state.motion.exiting).toBe(false)
            expect(state.exit.exitStyle).toBeUndefined()
            tree.unmount()
        })

        it('puts the row back when the verdict is withdrawn mid-exit', async () => {
            const tree = await mount({ lineWillLeave: true })
            await advance(SWEEP_LEAD_MS + 200)
            expect(state.exit.exitStyle).toBeDefined()

            await update(tree, { runId: 1, lineWillLeave: false })
            expect(state.motion.exiting).toBe(false)
            expect(state.exit.exitStyle).toBeUndefined()
            // And the height is released too, so the next exit measures the row afresh.
            expect(state.exit.exitHeight).toBe(0)
            tree.unmount()
        })
    })

    describe('standing down', () => {
        it('runs nothing at all under reduced motion — the line leaves as it always did', async () => {
            AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))
            window.matchMedia = jest.fn(query => ({
                matches: query.includes('reduce'),
                addEventListener: jest.fn(),
                removeEventListener: jest.fn(),
                addListener: jest.fn(),
                removeListener: jest.fn(),
            }))

            const tree = await mount({ lineWillLeave: true })
            await advance(SWEEP_EXIT_TOTAL_MS + 200)

            expect(state.motion.sweeping).toBe(false)
            expect(state.motion.exiting).toBe(false)
            expect(state.exit.exitStyle).toBeUndefined()
            tree.unmount()
        })

        it('never starts anything when there is nothing to celebrate', async () => {
            const tree = await mount({ runId: 0, lineWillLeave: true })
            await advance(SWEEP_EXIT_TOTAL_MS + 200)

            expect(state.motion.sweeping).toBe(false)
            expect(state.motion.exiting).toBe(false)
            expect(state.exit.exitStyle).toBeUndefined()
            tree.unmount()
        })

        it('plays once per run rather than restarting on every re-render', async () => {
            // The project row re-renders on every task write in the project.
            const tree = await mount({ lineWillLeave: true })
            await advance(SWEEP_LEAD_MS + 10)
            expect(state.motion.exiting).toBe(true)

            await update(tree, { runId: 1, lineWillLeave: true })
            // Still the same run: no new stage-4 timer was armed, so nothing restarts.
            await advance(50)
            expect(state.motion.exiting).toBe(true)
            tree.unmount()
        })
    })

    describe('the frozen height', () => {
        it('measures the row before the exit and then stops listening', async () => {
            const tree = await mount({ lineWillLeave: true })
            await advance(SWEEP_LEAD_MS + 10)
            expect(state.exit.exitHeight).toBe(ROW_HEIGHT)

            // The row is collapsing now, so its own layout events must not overwrite the height it
            // is collapsing FROM.
            await act(async () => {
                state.exit.onLineLayout({ nativeEvent: { layout: { height: 12, width: 900 } } })
            })
            expect(state.exit.exitHeight).toBe(ROW_HEIGHT)
            tree.unmount()
        })

        it('rebuilds no interpolation while the exit is running', async () => {
            // Rebuilding would detach and reattach live animated nodes mid-exit.
            const tree = await mount({ lineWillLeave: true })
            await advance(SWEEP_LEAD_MS + 10)
            const first = state.exit.exitStyle

            await update(tree, { runId: 1, lineWillLeave: true })
            expect(state.exit.exitStyle).toBe(first)
            tree.unmount()
        })
    })
})
