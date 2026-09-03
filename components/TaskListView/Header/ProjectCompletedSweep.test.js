import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { AccessibilityInfo, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import ProjectCompletedSweep from './ProjectCompletedSweep'
import useProjectCompletedSweepMotion from '../OpenTasksView/projectCompletedSweepMotion'
import {
    SWEEP_FILL_MS,
    SWEEP_PULSE_MS,
    SWEEP_SETTLE_MS,
    SWEEP_SHIMMER_MS,
    SWEEP_TOTAL_MS,
} from '../OpenTasksView/projectCompletedSweepMotion'

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))

/**
 * AT-2492 (second pass) — the visual contract of the completed sweep.
 *
 * Motion is inert under jest by convention here and stands down under reduced motion, so a suite
 * that wants to see what a user sees has to opt out of BOTH. Otherwise every assertion below passes
 * vacuously against a component that rendered `null` — which is exactly how AT-2445's predecessor
 * rotted.
 */

/**
 * AT-2495 moved the RUN up into `ProjectHeader`, because the same sequence now also drives the mask
 * that erases the whole line and a child cannot mask its parent. The overlay is handed the values
 * instead of calling the hook itself, so the suite calls the hook here — everything below still
 * drives the real sequence through the real component, exactly as before.
 */
const SweepHarness = ({ runId, projectId, lineWillLeave = false }) => (
    <ProjectCompletedSweep motion={useProjectCompletedSweepMotion(runId, lineWillLeave)} projectId={projectId} />
)

const PROJECT = 'project-a'
const PROJECT_COLOR = '#2F80ED'
const ROW_WIDTH = 640

let matchMediaReducedMotion = false

const findOne = (tree, testID) => tree.root.findAllByProps({ testID }, { deep: false })[0]
const countOf = (tree, testID) => tree.root.findAllByProps({ testID }, { deep: false }).length
// The wash's `scaleX` IS the run's progress value, so this is the handle on the live animation.
const progressValueOf = tree =>
    StyleSheet.flatten(findOne(tree, 'project-completed-sweep-wash').props.style).transform[0].scaleX
const styleOf = (tree, testID) => StyleSheet.flatten(findOne(tree, testID).props.style)
const transformOf = (tree, testID, key) => {
    const entry = styleOf(tree, testID).transform.find(item => item[key] !== undefined)
    return entry[key]
}
/**
 * The stage values, read back off the layers that consume them.
 *
 * `shimmer` and `pulse` never reach this component as props, so the only handle on them is the
 * interpolation the rendered style carries — which is the point: a stage wired to nothing, or wired
 * to the wrong value, cannot pass. `_parent` is the driving `Animated.Value` one level up, and
 * reaching for it is what lets a stage be driven by hand at all: `__mocks__/react-native.js`
 * replaces `Animated.timing` with a no-op, so no sequence ever advances under jest and every
 * assertion here would otherwise be about frame one only.
 */
const driverOf = interpolation => interpolation._parent
const shimmerTravelOf = tree => transformOf(tree, 'project-completed-sweep-shimmer', 'translateX')
const pulseOpacityOf = tree => styleOf(tree, 'project-completed-sweep-pulse').opacity
const accentThicknessOf = tree => transformOf(tree, 'project-completed-sweep-accent', 'scaleY')

describe('the project completed sweep (AT-2492)', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener
    const originalNodeEnv = process.env.NODE_ENV

    beforeEach(() => {
        jest.clearAllMocks()
        jest.useFakeTimers()
        matchMediaReducedMotion = false
        // `useReducedMotion` answers from the media query on its FIRST render, so a suite that only
        // stubs the async `AccessibilityInfo` answer still gets one fully-animated commit — which
        // is enough to hide a run being consumed while motion is unavailable.
        window.matchMedia = jest.fn(query => ({
            matches: query.includes('reduce') ? matchMediaReducedMotion : false,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            addListener: jest.fn(),
            removeListener: jest.fn(),
        }))
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        AccessibilityInfo.addEventListener = jest.fn(() => ({ remove: jest.fn() }))
        useSelector.mockImplementation(selector =>
            selector({ loggedUserProjectsMap: { [PROJECT]: { color: PROJECT_COLOR } } })
        )
        process.env.NODE_ENV = 'development'
    })

    afterEach(() => {
        jest.useRealTimers()
        AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
        AccessibilityInfo.addEventListener = originalAddEventListener
        process.env.NODE_ENV = originalNodeEnv
    })

    const renderSweep = async (runId, { measure = true } = {}) => {
        let tree
        await act(async () => {
            tree = renderer.create(<SweepHarness runId={runId} projectId={PROJECT} />)
        })
        if (measure && countOf(tree, 'project-completed-sweep') > 0) {
            await act(async () => {
                findOne(tree, 'project-completed-sweep').props.onLayout({
                    nativeEvent: { layout: { width: ROW_WIDTH } },
                })
            })
        }
        return tree
    }

    it('renders nothing at all when there is nothing to celebrate', async () => {
        const tree = await renderSweep(0)

        expect(countOf(tree, 'project-completed-sweep')).toBe(0)
    })

    it('sweeps the row when the project has just been cleared', async () => {
        const tree = await renderSweep(1)

        expect(countOf(tree, 'project-completed-sweep')).toBe(1)
        expect(countOf(tree, 'project-completed-sweep-wash')).toBe(1)
        expect(countOf(tree, 'project-completed-sweep-edge')).toBe(1)
    })

    /**
     * The one property the whole feature rests on: the celebration may not change the board it is
     * celebrating. An overlay that took part in layout would push the project name down by 35px for
     * a second, and one that took pointer events would swallow a tap on the add-task button.
     */
    it('cannot alter layout or intercept a tap while it plays', async () => {
        const tree = await renderSweep(1)
        const overlay = findOne(tree, 'project-completed-sweep')
        const style = StyleSheet.flatten(overlay.props.style)

        expect(style.position).toBe('absolute')
        // In `style`, not as a prop — react-native-web 0.21 deprecates the prop form.
        expect(style.pointerEvents).toBe('none')
        // Keeps the travelling edge from painting outside the row once it reaches the end.
        expect(style.overflow).toBe('hidden')
    })

    /**
     * Without `transformOrigin: 'left center'` a `scaleX` grows from the element's middle, which
     * reads as a bar blooming outwards rather than as a sweep with a direction — the exact mistake
     * AT-2404 documents for the task-row progress bar.
     */
    it('fills from the left edge rather than from the middle', async () => {
        const tree = await renderSweep(1)
        const wash = findOne(tree, 'project-completed-sweep-wash')
        const style = StyleSheet.flatten(wash.props.style)

        expect(style.transformOrigin).toBe('left center')
        expect(style.transform[0].scaleX).toBeDefined()
        // Frame one: nothing filled yet, so the sweep is genuinely a fill and not a fade-in.
        expect(style.transform[0].scaleX.__getValue()).toBe(0)
    })

    /**
     * Karsten chose the project's own colour over the app's green "done". The point of the choice is
     * lost if the sweep quietly falls back to a constant, so this pins that the tint actually comes
     * from the project.
     */
    it("is tinted with the project's own colour", async () => {
        const tree = await renderSweep(1)
        const washStyle = StyleSheet.flatten(findOne(tree, 'project-completed-sweep-wash').props.style)
        const edgeLine = findOne(tree, 'project-completed-sweep-edge-line')

        // 47,128,237 is #2F80ED — the wash is that colour at low alpha...
        expect(washStyle.backgroundColor).toBe('rgba(47,128,237,0.2)')
        // ...and the leading edge is the same colour at FULL strength, which is what keeps a pale
        // project colour visible when 16% of it is nearly invisible.
        expect(StyleSheet.flatten(edgeLine.props.style).backgroundColor).toBe(PROJECT_COLOR)
        // The accent bar is the second full-strength element, and it is the one that SURVIVES the
        // fill: the edge leaves the row at the end of stage 1, so without this a pale project would
        // spend the shimmer and the breath as an almost invisible tint.
        expect(styleOf(tree, 'project-completed-sweep-accent').backgroundColor).toBe(PROJECT_COLOR)
    })

    it('still sweeps for a project whose colour has not loaded', async () => {
        useSelector.mockImplementation(selector => selector({ loggedUserProjectsMap: { [PROJECT]: {} } }))

        const tree = await renderSweep(1)
        const washStyle = StyleSheet.flatten(findOne(tree, 'project-completed-sweep-wash').props.style)

        expect(countOf(tree, 'project-completed-sweep')).toBe(1)
        expect(washStyle.backgroundColor).toEqual(expect.stringContaining('rgba('))
    })

    /**
     * The edge must be a SIBLING of the scaled wash, not a child of it: `scaleX` squashes everything
     * inside it, so an edge nested in the wash would be crushed to nothing exactly as it travelled.
     * It therefore moves by `translateX` over a MEASURED row width — a percentage would resolve
     * against the edge's own 44px, parking it at the left margin.
     */
    it('travels the measured width of the row instead of being squashed by the fill', async () => {
        const tree = await renderSweep(1)
        const edgeStyle = StyleSheet.flatten(findOne(tree, 'project-completed-sweep-edge').props.style)
        const transform = edgeStyle.transform[0]

        expect(transform.translateX).toBeDefined()
        expect(edgeStyle.transform.some(entry => entry.scaleX !== undefined)).toBe(false)

        // The RN animation driver runs on requestAnimationFrame and does not advance under jest's
        // fake timers, so the run is driven by hand through the value the component actually
        // interpolates. That tests the mapping, which is the thing that can be wrong.
        const progress = progressValueOf(tree)

        // It starts fully off the left edge...
        expect(transform.translateX.__getValue()).toBeLessThan(0)
        await act(async () => {
            progress.setValue(1)
        })
        // ...and ends past the right one, so no bright line is ever left parked at either end.
        expect(transform.translateX.__getValue()).toBe(ROW_WIDTH)
    })

    it('draws no edge until the row has been measured, rather than one parked at zero', async () => {
        const tree = await renderSweep(1, { measure: false })

        expect(countOf(tree, 'project-completed-sweep-wash')).toBe(1)
        expect(countOf(tree, 'project-completed-sweep-edge')).toBe(0)
    })

    /**
     * A settled row has to be byte-identical to the row that was there before. The teardown is a
     * TIMER rather than the animation's completion callback precisely so this holds on a renderer
     * whose composite never reports finishing — a project line left permanently striped in its own
     * colour is a far worse failure than a sweep ending a frame early.
     */
    it('leaves nothing behind once the run settles', async () => {
        const tree = await renderSweep(1)

        await act(async () => {
            jest.advanceTimersByTime(SWEEP_TOTAL_MS + 200)
        })

        expect(countOf(tree, 'project-completed-sweep')).toBe(0)
    })

    it('plays once per run rather than restarting on every re-render', async () => {
        const tree = await renderSweep(1)
        const progress = progressValueOf(tree)

        await act(async () => {
            progress.setValue(0.5)
        })

        // The project row re-renders on every task write in the project; that must not rewind a
        // sweep already halfway across.
        await act(async () => {
            tree.update(<SweepHarness runId={1} projectId={PROJECT} />)
        })

        expect(progress.__getValue()).toBe(0.5)

        // A NEW run does start from the beginning, so clearing a second project still sweeps.
        await act(async () => {
            tree.update(<SweepHarness runId={2} projectId={PROJECT} />)
        })
        expect(progressValueOf(tree).__getValue()).toBe(0)
    })

    /**
     * ── THE FOUR STAGES (AT-2492 third pass) ─────────────────────────────────────────────────────
     *
     * Karsten's verdict on the shipped single-pass sweep was that it works but is over before it
     * registers: "make it more celebratory and maybe up to 3 seconds long". Three seconds cannot be
     * bought by slowing one gesture down — a 2.5s fill across a 900px row reads as a stuck progress
     * bar — so the run became four sequential stages. These assertions are about the two properties
     * that make staging work at all: each stage drives its own layer, and no layer is visible
     * outside its own stage.
     */
    describe('the four stages', () => {
        it('spends ~2.8s across four sequential stages, none of them dominant', () => {
            const stages = [SWEEP_FILL_MS, SWEEP_SHIMMER_MS, SWEEP_PULSE_MS, SWEEP_SETTLE_MS]

            expect(stages.reduce((total, stage) => total + stage, 0)).toBe(SWEEP_TOTAL_MS)
            expect(SWEEP_TOTAL_MS).toBeGreaterThanOrEqual(2500)
            expect(SWEEP_TOTAL_MS).toBeLessThanOrEqual(3000)
            // No stage may swallow the run. A single beat stretched over half of a three-second
            // animation is exactly the "slow progress bar" this staging replaced, and it is the
            // shape a well-meaning retune would drift back into.
            stages.forEach(stage => expect(stage).toBeLessThan(SWEEP_TOTAL_MS / 2))
            // ...and none may be so short it reads as a glitch rather than a beat.
            stages.forEach(stage => expect(stage).toBeGreaterThanOrEqual(400))
        })

        it('draws one layer per stage, each on its own value', async () => {
            const tree = await renderSweep(1)

            expect(countOf(tree, 'project-completed-sweep-wash')).toBe(1)
            expect(countOf(tree, 'project-completed-sweep-shimmer')).toBe(1)
            expect(countOf(tree, 'project-completed-sweep-pulse')).toBe(1)
            expect(countOf(tree, 'project-completed-sweep-accent')).toBe(1)

            // The fill's value drives the wash, the edge AND the accent — the AT-2404 rule, so the
            // wash's edge IS the bright edge rather than a second animation alongside it.
            const fill = progressValueOf(tree)
            expect(driverOf(transformOf(tree, 'project-completed-sweep-edge', 'translateX'))).toBe(fill)
            expect(transformOf(tree, 'project-completed-sweep-accent', 'scaleX')).toBe(fill)

            // The later stages are genuinely separate values, not the fill reused. Reusing it is the
            // failure that would make the shimmer and the breath play DURING the fill.
            expect(driverOf(shimmerTravelOf(tree))).not.toBe(fill)
            expect(driverOf(driverOf(accentThicknessOf(tree)))).not.toBe(fill)
        })

        /**
         * The gating property, and the reason there is no per-stage opacity bookkeeping to get out
         * of step with the sequence: the edge and the shimmer band each travel from fully off the
         * left of the row to fully off the right of it, and the overlay clips. So each is invisible
         * before and after its own stage by GEOMETRY.
         */
        it('parks each travelling layer outside the row before and after its own stage', async () => {
            const tree = await renderSweep(1)
            const shimmerTravel = shimmerTravelOf(tree)
            const shimmer = driverOf(shimmerTravel)

            // Stage 2 has not started, so the band sits entirely off the left edge.
            expect(shimmerTravel.__getValue()).toBeLessThan(0)
            await act(async () => {
                shimmer.setValue(0.5)
            })
            // Mid-stage it is somewhere over the row...
            expect(shimmerTravel.__getValue()).toBeGreaterThan(0)
            expect(shimmerTravel.__getValue()).toBeLessThan(ROW_WIDTH)
            await act(async () => {
                shimmer.setValue(1)
            })
            // ...and by the end it has left it entirely, so the breath plays over a clean row.
            expect(shimmerTravel.__getValue()).toBe(ROW_WIDTH)
        })

        /**
         * The breath is a normalised CLOCK, not an amplitude: its shape lives in the interpolations
         * that read it. Both ends of the clock map to nothing, which is what keeps the glow
         * invisible through stages 1 and 2 and leaves no residue at the end — the accent has to come
         * back to exactly 1, or a settled row would keep a permanently thickened bar.
         */
        it('breathes once at the end and returns to rest', async () => {
            const tree = await renderSweep(1)
            const glow = pulseOpacityOf(tree)
            const thickness = accentThicknessOf(tree)
            const pulse = driverOf(driverOf(thickness))

            expect(glow.__getValue()).toBe(0)
            expect(thickness.__getValue()).toBe(1)

            await act(async () => {
                pulse.setValue(0.42)
            })
            expect(glow.__getValue()).toBeGreaterThan(0)
            expect(thickness.__getValue()).toBeGreaterThan(1)

            await act(async () => {
                pulse.setValue(1)
            })
            expect(glow.__getValue()).toBe(0)
            expect(thickness.__getValue()).toBe(1)
        })

        /**
         * The settle is the beat that made the previous pass feel clipped, and it has to take EVERY
         * layer with it. A layer that keeps its own opacity would be left painted on the row for the
         * frame between the fade landing and the overlay unmounting.
         */
        it('fades every layer together on the settle', async () => {
            const tree = await renderSweep(1)
            const layers = [
                'project-completed-sweep-wash',
                'project-completed-sweep-shimmer',
                'project-completed-sweep-edge',
                'project-completed-sweep-accent',
            ]
            layers.forEach(testID => expect(styleOf(tree, testID).opacity.__getValue()).toBe(1))

            // Driven through the wash's own opacity, which IS the shared exit value — so this only
            // passes if every other layer is reading the same one.
            const fade = styleOf(tree, 'project-completed-sweep-wash').opacity
            await act(async () => {
                fade.setValue(0)
            })
            layers.forEach(testID => expect(styleOf(tree, testID).opacity.__getValue()).toBe(0))
            // The breath's glow rides the same exit, so it cannot outlive the layers under it.
            expect(pulseOpacityOf(tree).__getValue()).toBe(0)
        })
    })

    it('stands down entirely under reduced motion', async () => {
        matchMediaReducedMotion = true
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))

        const tree = await renderSweep(1)

        expect(countOf(tree, 'project-completed-sweep')).toBe(0)
    })

    /**
     * A run must be marked "played" only once it has actually played.
     *
     * The play-once guard used to consume the run id BEFORE testing whether motion was available,
     * so a run that arrived while the preference said "reduce" was swallowed permanently — turning
     * motion back on could never recover it, because the run looked like one already shown. The
     * failure is silent: a swallowed run is indistinguishable from a run that was never requested.
     * It is reachable without touching any setting, because react-native-web resolves the
     * preference to `true` whenever `window.matchMedia` is missing.
     */
    it('still plays a run that arrived while motion was unavailable', async () => {
        let notifyPreferenceChanged
        matchMediaReducedMotion = true
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))
        AccessibilityInfo.addEventListener = jest.fn((eventName, handler) => {
            notifyPreferenceChanged = handler
            return { remove: jest.fn() }
        })

        const tree = await renderSweep(1)
        expect(countOf(tree, 'project-completed-sweep')).toBe(0)

        // The user turns motion back on (or the environment can finally answer the question).
        await act(async () => {
            notifyPreferenceChanged(false)
        })

        expect(countOf(tree, 'project-completed-sweep')).toBe(1)
    })
})
