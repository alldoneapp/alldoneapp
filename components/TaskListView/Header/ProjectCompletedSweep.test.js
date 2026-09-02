import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { AccessibilityInfo, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import ProjectCompletedSweep from './ProjectCompletedSweep'
import { SWEEP_TOTAL_MS } from '../OpenTasksView/projectCompletedSweepMotion'

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))

/**
 * AT-2492 (second pass) — the visual contract of the completed sweep.
 *
 * Motion is inert under jest by convention here and stands down under reduced motion, so a suite
 * that wants to see what a user sees has to opt out of BOTH. Otherwise every assertion below passes
 * vacuously against a component that rendered `null` — which is exactly how AT-2445's predecessor
 * rotted.
 */

const PROJECT = 'project-a'
const PROJECT_COLOR = '#2F80ED'
const ROW_WIDTH = 640

const findOne = (tree, testID) => tree.root.findAllByProps({ testID }, { deep: false })[0]
const countOf = (tree, testID) => tree.root.findAllByProps({ testID }, { deep: false }).length
// The wash's `scaleX` IS the run's progress value, so this is the handle on the live animation.
const progressValueOf = tree =>
    StyleSheet.flatten(findOne(tree, 'project-completed-sweep-wash').props.style).transform[0].scaleX

describe('the project completed sweep (AT-2492)', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener
    const originalNodeEnv = process.env.NODE_ENV

    beforeEach(() => {
        jest.clearAllMocks()
        jest.useFakeTimers()
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
            tree = renderer.create(<ProjectCompletedSweep runId={runId} projectId={PROJECT} />)
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
        expect(washStyle.backgroundColor).toBe('rgba(47,128,237,0.16)')
        // ...and the leading edge is the same colour at FULL strength, which is what keeps a pale
        // project colour visible when 16% of it is nearly invisible.
        expect(StyleSheet.flatten(edgeLine.props.style).backgroundColor).toBe(PROJECT_COLOR)
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
            tree.update(<ProjectCompletedSweep runId={1} projectId={PROJECT} />)
        })

        expect(progress.__getValue()).toBe(0.5)

        // A NEW run does start from the beginning, so clearing a second project still sweeps.
        await act(async () => {
            tree.update(<ProjectCompletedSweep runId={2} projectId={PROJECT} />)
        })
        expect(progressValueOf(tree).__getValue()).toBe(0)
    })

    it('stands down entirely under reduced motion', async () => {
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))

        const tree = await renderSweep(1)

        expect(countOf(tree, 'project-completed-sweep')).toBe(0)
    })
})
