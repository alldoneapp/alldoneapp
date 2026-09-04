import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { AccessibilityInfo } from 'react-native'
import { useSelector } from 'react-redux'

import GoalCompletedFlourish from './GoalCompletedFlourish'
import ProjectCompletedSweep from '../TaskListView/Header/ProjectCompletedSweep'
import ProjectLineDisintegration from '../TaskListView/Header/ProjectLineDisintegration'
import useProjectCompletedSweepMotion, {
    SWEEP_TOTAL_MS,
    useProjectLineExit,
} from '../TaskListView/OpenTasksView/projectCompletedSweepMotion'
import { CONGRATS_TOTAL_MS } from '../TaskListView/OpenTasksView/emptyInboxCongratsMotion'
import {
    GOAL_FLOURISH_FADE_MS,
    GOAL_FLOURISH_FILL_MS,
    GOAL_FLOURISH_PULSE_MS,
    GOAL_FLOURISH_TOTAL_MS,
} from '../TaskListView/OpenTasksView/goalCompletedFlourishMotion'
import { COMPLETION_HOLD_MS } from '../TaskListView/TaskItem/TaskPresentation/taskCompletionMotion'

jest.mock('react-redux', () => ({ useDispatch: () => jest.fn(), useSelector: jest.fn() }))

/**
 * AT-2507 — drives the REAL goal flourish through the REAL animated branch, and measures it against
 * the REAL per-project sweep it must stay smaller than.
 *
 * The task is a statement about RANKING — "an even smaller animation" than the project line, which
 * is itself smaller than the all-projects empty inbox — so the assertions that matter are
 * comparative, exactly as in `ProjectEmptyInboxCelebration.test.js` one scope up. A suite that only
 * checked "the goal animates" would keep passing on the day somebody quietly handed it sparks, a
 * shimmer band or a two-second run, which is the whole thing that must not happen.
 *
 * Motion is inert under jest by convention and stands down under reduced motion, so this suite opts
 * out of BOTH — otherwise every assertion below passes vacuously against a component that has
 * correctly decided to draw nothing. That is exactly how AT-2445's predecessor rotted.
 */

const PROJECT = 'project-a'
const PROJECT_COLOR = '#2F80ED'
const GOAL_ACCENT = '#6C63FF'
const ROW_HEIGHT = 57

const countOf = (tree, testID) => tree.root.findAllByProps({ testID }, { deep: false }).length
const findOne = (tree, testID) => tree.root.findAllByProps({ testID }, { deep: false })[0]

describe('the goal flourish, measured against the project sweep (AT-2507)', () => {
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
        jest.restoreAllMocks()
        AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
        AccessibilityInfo.addEventListener = originalAddEventListener
        process.env.NODE_ENV = originalNodeEnv
    })

    const renderFlourish = async (completedRunId = 0) => {
        let tree
        await act(async () => {
            tree = renderer.create(<GoalCompletedFlourish completedRunId={completedRunId} accentColor={GOAL_ACCENT} />)
        })
        return tree
    }

    /** The whole per-project celebration as `ProjectHeader` assembles it — sweep plus particles. */
    const MeasureHook = ({ onLineLayout }) => {
        React.useEffect(() => {
            onLineLayout({ nativeEvent: { layout: { height: ROW_HEIGHT, width: 900 } } })
        }, [onLineLayout])
        return null
    }

    const ProjectLineHarness = ({ runId, lineWillLeave }) => {
        const motion = useProjectCompletedSweepMotion(runId, lineWillLeave)
        const { exitStyle, exitHeight, onLineLayout } = useProjectLineExit(motion)
        return (
            <>
                <ProjectCompletedSweep motion={motion} projectId={PROJECT} />
                {exitStyle ? (
                    <ProjectLineDisintegration
                        progress={motion.disintegrate}
                        height={exitHeight}
                        tint={PROJECT_COLOR}
                    />
                ) : null}
                <MeasureHook onLineLayout={onLineLayout} />
            </>
        )
    }

    const renderProjectSweep = async ({ lineWillLeave = false } = {}) => {
        let tree
        await act(async () => {
            tree = renderer.create(<ProjectLineHarness runId={1} lineWillLeave={lineWillLeave} />)
        })
        return tree
    }

    describe('an ordinary goal row', () => {
        it('draws nothing at all when there is nothing to celebrate', async () => {
            const tree = await renderFlourish(0)

            expect(findOne(tree, 'goal-completed-flourish')).toBeUndefined()
        })

        it('leaves no residue once the run is over', async () => {
            // The row it decorates USUALLY STAYS on the board — as an `EmptyGoal` with its add-task
            // line — unlike the project line, which leaves. Anything left behind would therefore be
            // a permanent decoration on a perfectly ordinary row, not a frame nobody sees.
            const tree = await renderFlourish(1)
            expect(findOne(tree, 'goal-completed-flourish')).toBeDefined()

            await act(async () => {
                jest.advanceTimersByTime(GOAL_FLOURISH_TOTAL_MS + 200)
            })

            expect(findOne(tree, 'goal-completed-flourish')).toBeUndefined()
        })

        it('does not restart when the row re-renders mid-run', async () => {
            // A goal row re-renders on every task write in its project.
            const tree = await renderFlourish(1)
            await act(async () => {
                jest.advanceTimersByTime(GOAL_FLOURISH_FILL_MS)
                tree.update(<GoalCompletedFlourish completedRunId={1} accentColor={GOAL_ACCENT} />)
            })

            // Still the same run: it finishes on its original schedule rather than starting over.
            await act(async () => {
                jest.advanceTimersByTime(GOAL_FLOURISH_PULSE_MS + GOAL_FLOURISH_FADE_MS + 200)
            })
            expect(findOne(tree, 'goal-completed-flourish')).toBeUndefined()
        })

        it('celebrates a second clearing of the same goal', async () => {
            const tree = await renderFlourish(1)
            await act(async () => {
                jest.advanceTimersByTime(GOAL_FLOURISH_TOTAL_MS + 200)
            })
            expect(findOne(tree, 'goal-completed-flourish')).toBeUndefined()

            await act(async () => {
                tree.update(<GoalCompletedFlourish completedRunId={2} accentColor={GOAL_ACCENT} />)
            })

            expect(findOne(tree, 'goal-completed-flourish')).toBeDefined()
        })
    })

    describe('the ranking against the celebrations above it', () => {
        it('never sheds a particle of any kind', async () => {
            // The project line's departure sparks and dust are what make it the bigger moment; a
            // goal is cleared several times a day where a project is cleared once.
            const goal = await renderFlourish(1)

            expect(countOf(goal, 'project-line-spark')).toBe(0)
            expect(countOf(goal, 'project-line-dust')).toBe(0)
            expect(countOf(goal, 'empty-inbox-confetti-piece')).toBe(0)
        })

        it('leaves the travelling edge and the shimmer band to the project line', async () => {
            // Those two layers ARE the project sweep's "it got all the way there" statement. The
            // goal beat is a bar and a breath, and copying them would make the two read as the same
            // celebration at two sizes — the difference-in-degree trap AT-2492 exists to avoid.
            const goal = await renderFlourish(1)
            const project = await renderProjectSweep()
            // Both travelling layers are held back until the row has been measured, because
            // `translateX` takes pixels. jsdom lays nothing out, so the measurement `ProjectHeader`
            // gets from `onLayout` in a browser has to be handed over by hand.
            await act(async () => {
                findOne(project, 'project-completed-sweep').props.onLayout({
                    nativeEvent: { layout: { width: 900, height: 36 } },
                })
            })

            expect(countOf(project, 'project-completed-sweep-edge')).toBeGreaterThan(0)
            expect(countOf(project, 'project-completed-sweep-shimmer')).toBeGreaterThan(0)
            expect(countOf(goal, 'project-completed-sweep-edge')).toBe(0)
            expect(countOf(goal, 'project-completed-sweep-shimmer')).toBe(0)
        })

        it('draws strictly fewer layers than the project sweep', async () => {
            const goal = await renderFlourish(1)
            const project = await renderProjectSweep()
            await act(async () => {
                findOne(project, 'project-completed-sweep').props.onLayout({
                    nativeEvent: { layout: { width: 900, height: 36 } },
                })
            })

            const goalLayers =
                countOf(goal, 'goal-completed-flourish-wash') + countOf(goal, 'goal-completed-flourish-bar')
            const projectLayers =
                countOf(project, 'project-completed-sweep-wash') +
                countOf(project, 'project-completed-sweep-pulse') +
                countOf(project, 'project-completed-sweep-shimmer') +
                countOf(project, 'project-completed-sweep-edge') +
                countOf(project, 'project-completed-sweep-accent')

            expect(goalLayers).toBeLessThan(projectLayers)
        })

        it('is over in well under half the time the project line takes', () => {
            expect(GOAL_FLOURISH_TOTAL_MS).toBeLessThan(SWEEP_TOTAL_MS / 2)
            expect(GOAL_FLOURISH_TOTAL_MS).toBeLessThan(CONGRATS_TOTAL_MS / 2)
        })

        it('stays around the ~0.9s that reads as a flourish rather than a wait', () => {
            // Long enough to register as deliberate; short enough that clearing three goals in a
            // row never feels like queueing behind animations.
            expect(GOAL_FLOURISH_TOTAL_MS).toBeGreaterThanOrEqual(700)
            expect(GOAL_FLOURISH_TOTAL_MS).toBeLessThanOrEqual(1000)
        })

        /**
         * THE load-bearing number. The task row holds its Firestore write for `COMPLETION_HOLD_MS`
         * while it collapses, and that hold is the ONLY reason the goal section is still mounted
         * when this plays — it is what lets AT-2507 skip the probe-and-hold machinery AT-2492 needed.
         * Overrun it and the snapshot unmounts the section mid-run, with no way to resume.
         */
        it('always finishes before the completing task writes and takes the section away', () => {
            expect(GOAL_FLOURISH_TOTAL_MS).toBeLessThan(COMPLETION_HOLD_MS)
            // And with enough margin that a slow frame or two cannot eat the confirmation.
            expect(COMPLETION_HOLD_MS - GOAL_FLOURISH_TOTAL_MS).toBeGreaterThanOrEqual(100)
        })

        it('confirms only after it has finished drawing', () => {
            // A confirmation that overlaps the thing it confirms is a wobble (the AT-2404 rule).
            expect(GOAL_FLOURISH_TOTAL_MS).toBe(GOAL_FLOURISH_FILL_MS + GOAL_FLOURISH_PULSE_MS + GOAL_FLOURISH_FADE_MS)
        })
    })

    describe('geometry', () => {
        it('cannot intercept a tap on the goal row', async () => {
            const tree = await renderFlourish(1)
            const overlay = findOne(tree, 'goal-completed-flourish')

            const style = Object.assign({}, ...[].concat(overlay.props.style).filter(Boolean))
            expect(style.pointerEvents).toBe('none')
            expect(style.position).toBe('absolute')
        })

        it('stays inside the card it decorates', async () => {
            // No viewport-derived dimension anywhere: the all-projects confetti is `position: fixed`
            // and escapes to the viewport, and that is the difference this must never erase.
            const tree = await renderFlourish(1)
            const overlay = findOne(tree, 'goal-completed-flourish')
            const style = Object.assign({}, ...[].concat(overlay.props.style).filter(Boolean))

            expect(style.overflow).toBe('hidden')
            expect(style.position).not.toBe('fixed')
        })

        it('grows the bar from the left edge of the card, not from its middle', async () => {
            // Without this the bar expands out of its own centre and stops reading as progress at
            // all — the AT-2404 lesson, available to make again here.
            const tree = await renderFlourish(1)
            const bar = findOne(tree, 'goal-completed-flourish-bar')
            const style = Object.assign({}, ...[].concat(bar.props.style).filter(Boolean))

            expect(style.transformOrigin).toBe('left bottom')
        })

        it('paints in the accent colour the goal row already uses', async () => {
            const tree = await renderFlourish(1)
            const bar = findOne(tree, 'goal-completed-flourish-bar')
            const style = Object.assign({}, ...[].concat(bar.props.style).filter(Boolean))

            expect(style.backgroundColor).toBe(GOAL_ACCENT)
        })

        it('still draws when the goal has no colour resolved yet', async () => {
            let tree
            await act(async () => {
                tree = renderer.create(<GoalCompletedFlourish completedRunId={1} accentColor={undefined} />)
            })

            expect(findOne(tree, 'goal-completed-flourish-bar')).toBeDefined()
        })
    })

    it('stands down entirely under reduced motion', async () => {
        // Nothing is lost by doing so: the goal section emptying already says the work is done, so
        // unlike the task row's progress bar there is no information here worth a static frame.
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))

        const tree = await renderFlourish(1)

        expect(findOne(tree, 'goal-completed-flourish')).toBeUndefined()
    })
})
