import React from 'react'
import renderer, { act } from 'react-test-renderer'
import moment from 'moment'
import { AccessibilityInfo, Dimensions, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import SelectedProjectEmptyInbox from './SelectedProjectEmptyInbox'
import AllProjectsEmptyInbox from './AllProjectsEmptyInbox'
import ProjectCompletedSweep from '../Header/ProjectCompletedSweep'
import ProjectLineDisintegration from '../Header/ProjectLineDisintegration'
import { CONFETTI_BURST_PIECE_COUNT, CONFETTI_PAGE_PIECE_COUNT } from './EmptyInboxConfetti'
import { CONGRATS_TOTAL_MS } from './emptyInboxCongratsMotion'
import { PROJECT_CONGRATS_TOTAL_MS, PROJECT_ENTRANCE_MS } from './projectEmptyInboxCongratsMotion'
import useProjectCompletedSweepMotion, {
    SWEEP_EXIT_TOTAL_MS,
    SWEEP_TOTAL_MS,
    useProjectLineExit,
} from './projectCompletedSweepMotion'
import { SPARK_COUNT } from './projectLineDisintegration'
import { resetEmptyInboxCelebrationSessionMarkers } from '../../SettingsView/Profile/Achievements/emptyInboxCelebrationMarker'

jest.mock('react-redux', () => ({ useDispatch: () => jest.fn(), useSelector: jest.fn() }))
jest.mock('../../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../../../redux/actions', () => ({ navigateToSettings: jest.fn(() => ({ type: 'noop' })) }))
jest.mock('./AllProjectsEmptyInboxAddTask', () => 'AllProjectsEmptyInboxAddTask')
jest.mock('./AllProjectsEmptyInboxTags', () => 'AllProjectsEmptyInboxTags')
jest.mock('./AllProjectsEmptyInboxText', () => 'AllProjectsEmptyInboxText')
jest.mock('./AllProjectsEmptyInboxPicture', () => 'AllProjectsEmptyInboxPicture')
jest.mock('../../SettingsView/Profile/Achievements/AchievementsArea', () => ({
    EmptyInboxOverview: 'EmptyInboxOverview',
}))

/**
 * AT-2492 — drives the REAL per-project celebration through the REAL animated branch, and measures
 * it against the REAL all-projects one.
 *
 * The task is a statement about RANKING — "celebrate it already a little, but not as much as when we
 * achieve empty inbox across all projects" — so the assertions that matter are comparative. A suite
 * that only checked "the small one animates" would keep passing on the day somebody quietly handed
 * it the page-wide confetti, which is the thing that must stay exclusive to the bigger moment.
 *
 * The SECOND PASS moved the per-project celebration off the Anna picture and onto the project line,
 * and dropped confetti from it entirely. That makes the ranking a difference in KIND rather than in
 * degree — one is a coloured sweep across a 56px row, the other is a headline plus a burst plus a
 * fall across the whole viewport — and it is what lets the same celebration work in All Projects,
 * where there is no picture at all. The exclusivity assertion below is therefore now absolute:
 * the small celebration renders NO confetti of any kind, not merely less of it.
 *
 * Motion is inert under jest by convention here and stands down under reduced motion, so a suite
 * that wants to see what a user sees has to opt out of BOTH — otherwise every assertion passes
 * vacuously. That is exactly how AT-2445's predecessor rotted.
 */

const VIEWPORT = { width: 1280, height: 800, scale: 1, fontScale: 1 }
const PROJECT = 'project-a'
const PROJECT_COLOR = '#2F80ED'
const ROW_HEIGHT = 57

const countOf = (tree, testID) => tree.root.findAllByProps({ testID }, { deep: false }).length
const findOne = (tree, testID) => tree.root.findAllByProps({ testID }, { deep: false })[0]

describe('the per-project celebration, measured against the all-projects one (AT-2492)', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener
    const originalNodeEnv = process.env.NODE_ENV

    beforeEach(() => {
        jest.clearAllMocks()
        resetEmptyInboxCelebrationSessionMarkers()
        localStorage.clear()
        jest.useFakeTimers()
        jest.spyOn(Dimensions, 'get').mockReturnValue(VIEWPORT)
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        AccessibilityInfo.addEventListener = jest.fn(() => ({ remove: jest.fn() }))
        useSelector.mockImplementation(selector =>
            selector({
                loggedUser: { uid: 'user-1', emptyInboxDays: [] },
                loggedUserProjectsMap: { [PROJECT]: { color: PROJECT_COLOR } },
                isMiddleScreen: false,
                thereAreLaterOpenTasks: {},
                thereAreLaterEmptyGoals: {},
                thereAreSomedayOpenTasks: {},
                thereAreSomedayEmptyGoals: {},
            })
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

    /**
     * The whole per-project celebration as `ProjectHeader` assembles it: one run driving the sweep
     * overlay INSIDE the row and the disintegration particles BESIDE it. Rendering only the overlay
     * — which is what this suite did before AT-2495 — would have left the new spark layer outside
     * every comparative assertion here, i.e. outside the one place the ranking is actually enforced.
     */
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

    // jsdom lays nothing out, so the row's height has to be handed to the exit by hand — the same
    // measurement `ProjectHeader` gets from `onLayout` in a browser.
    const MeasureHook = ({ onLineLayout }) => {
        React.useEffect(() => {
            onLineLayout({ nativeEvent: { layout: { height: ROW_HEIGHT, width: 900 } } })
        }, [onLineLayout])
        return null
    }

    const renderSweep = async (celebrationRunId = 0, { lineWillLeave = false } = {}) => {
        let tree
        await act(async () => {
            tree = renderer.create(<ProjectLineHarness runId={celebrationRunId} lineWillLeave={lineWillLeave} />)
        })
        return tree
    }

    /** Drives a leaving line all the way into its disintegration, the way All Projects does. */
    const renderLeavingLine = async () => {
        const tree = await renderSweep(1, { lineWillLeave: true })
        await act(async () => {
            jest.advanceTimersByTime(SWEEP_EXIT_TOTAL_MS - 100)
        })
        return tree
    }

    const renderPicture = async (celebrationRunId = 0) => {
        let tree
        await act(async () => {
            tree = renderer.create(
                <SelectedProjectEmptyInbox projectId={PROJECT} instanceKey="key" celebrationRunId={celebrationRunId} />
            )
        })
        return tree
    }

    const renderAllProjects = async () => {
        resetEmptyInboxCelebrationSessionMarkers()
        localStorage.clear()
        useSelector.mockImplementation(selector =>
            selector({
                loggedUser: { uid: 'user-1', emptyInboxDays: [moment().format('YYYY-MM-DD')] },
                isMiddleScreen: false,
            })
        )
        let tree
        await act(async () => {
            tree = renderer.create(<AllProjectsEmptyInbox showEmptyInboxOverview celebrateNewDay />)
        })
        return tree
    }

    describe('the ranking', () => {
        /**
         * The line between the two celebrations, and after the second pass it is absolute rather
         * than a matter of piece counts. Clearing one project sweeps the row you are looking at;
         * clearing every project changes the whole screen.
         */
        it('never throws confetti of any kind — that stays exclusive to the all-projects moment', async () => {
            const sweep = await renderSweep(1)
            expect(countOf(sweep, 'empty-inbox-confetti')).toBe(0)
            expect(countOf(sweep, 'empty-inbox-confetti-burst')).toBe(0)
            expect(countOf(sweep, 'empty-inbox-confetti-piece')).toBe(0)

            // …including while the line is disintegrating, which is the beat AT-2495 added a
            // celebration to and therefore the one that could most easily grow into confetti.
            const leaving = await renderLeavingLine()
            expect(countOf(leaving, 'empty-inbox-confetti')).toBe(0)
            expect(countOf(leaving, 'empty-inbox-confetti-burst')).toBe(0)
            expect(countOf(leaving, 'empty-inbox-confetti-piece')).toBe(0)

            const picture = await renderPicture(1)
            expect(countOf(picture, 'empty-inbox-confetti')).toBe(0)
            expect(countOf(picture, 'empty-inbox-confetti-burst')).toBe(0)
            expect(countOf(picture, 'empty-inbox-confetti-piece')).toBe(0)
        })

        it('celebrates the departing line with a sprinkle an order of magnitude below the confetti', async () => {
            const leaving = await renderLeavingLine()

            expect(countOf(leaving, 'project-line-disintegration-spark')).toBe(SPARK_COUNT)
            // Nine against forty-six. The ranking has to survive a piece-count retune on either
            // side, hence the comparison rather than two literals.
            expect(SPARK_COUNT).toBeLessThan((CONFETTI_BURST_PIECE_COUNT + CONFETTI_PAGE_PIECE_COUNT) / 3)
        })

        it('leaves the all-projects celebration exactly as loud as it was', async () => {
            const tree = await renderAllProjects()

            expect(countOf(tree, 'empty-inbox-confetti')).toBe(1)
            expect(countOf(tree, 'empty-inbox-confetti-burst')).toBe(1)
            expect(countOf(tree, 'empty-inbox-confetti-piece')).toBe(
                CONFETTI_BURST_PIECE_COUNT + CONFETTI_PAGE_PIECE_COUNT
            )
        })

        /**
         * DURATION IS NO LONGER WHAT RANKS THEM, and that is a deliberate reversal.
         *
         * The second pass encoded the ranking as "half or less" (860ms against 3000ms). Karsten's
         * verdict on the shipped result was that it works but is over before it registers — "make it
         * more celebratory and maybe up to 3 seconds long" — so the third pass spends roughly the
         * same wall clock as the all-projects moment and carries the ranking entirely in KIND: no
         * confetti of any sort, bounded to one 56px row, no viewport-derived dimension anywhere.
         * Those are the assertions above and below, and they are the ones that must not move.
         *
         * What survives here is only the ordering that would look like a mistake if it inverted: the
         * small celebration must never OUTLAST the big one. Plus the window Karsten asked for, so a
         * future retune cannot quietly hand the row back its old 860ms flash.
         */
        it('runs for the ~3s Karsten asked for, and still never outlasts the all-projects one', () => {
            expect(SWEEP_TOTAL_MS).toBeLessThan(CONGRATS_TOTAL_MS)
            expect(SWEEP_TOTAL_MS).toBeGreaterThanOrEqual(2500)
            expect(SWEEP_TOTAL_MS).toBeLessThanOrEqual(3000)
            /**
             * A LEAVING line spends longer, because its last stage is its 1.2s departure rather than
             * a 660ms settle — and that is the one number here allowed to exceed the all-projects
             * run, because it is not celebration time, it is the row physically leaving the board.
             * It is still bounded, so a future retune cannot leave a cleared project sitting on the
             * board for five seconds.
             */
            expect(SWEEP_EXIT_TOTAL_MS).toBeGreaterThan(SWEEP_TOTAL_MS)
            expect(SWEEP_EXIT_TOTAL_MS).toBeLessThanOrEqual(3600)
            // The picture's pop is tied to the sweep, so the two halves of the small celebration end
            // together instead of one outliving the other.
            expect(PROJECT_CONGRATS_TOTAL_MS).toBe(SWEEP_TOTAL_MS)
            expect(PROJECT_ENTRANCE_MS).toBeLessThan(PROJECT_CONGRATS_TOTAL_MS)
        })

        /**
         * The structural difference behind the ranking, and the reason it cannot be undone by
         * retuning a duration: the all-projects fall is `position: fixed`, so it ESCAPES whatever it
         * is rendered inside and covers the viewport — that is what makes it visible from across a
         * room. The sweep is `position: absolute`, so it is bounded by the 56px row it belongs to and
         * cannot spread however it is styled.
         */
        it('stays inside one row while the big one escapes to the viewport', async () => {
            const sweep = await renderSweep(1)
            const overlayStyle = StyleSheet.flatten(findOne(sweep, 'project-completed-sweep').props.style)

            expect(overlayStyle.position).toBe('absolute')
            // Pinned to its parent row's edges, with no viewport-derived dimension anywhere.
            expect(overlayStyle.left).toBe(0)
            expect(overlayStyle.right).toBe(0)
            expect(overlayStyle.height).toBeUndefined()
            expect(overlayStyle.width).toBeUndefined()
            // Bounded vertically to the row's content band rather than filling it.
            expect(overlayStyle.top).toBeGreaterThan(0)

            // The celebration that rides on the line's departure is bounded the same way: absolute,
            // and exactly as tall as the row it came off. It cannot spread however it is styled.
            const leaving = await renderLeavingLine()
            const particleStyle = StyleSheet.flatten(findOne(leaving, 'project-line-disintegration').props.style)
            expect(particleStyle.position).toBe('absolute')
            expect(particleStyle.height).toBe(ROW_HEIGHT)
            expect(particleStyle.left).toBe(0)
            expect(particleStyle.right).toBe(0)

            const allProjects = await renderAllProjects()
            const pageLayerStyle = StyleSheet.flatten(findOne(allProjects, 'empty-inbox-confetti').props.style)
            expect(pageLayerStyle.position).toBe('fixed')
        })
    })

    describe('the picture that comes with it on the selected-project board', () => {
        it('renders the plain picture when there is nothing to celebrate', async () => {
            const tree = await renderPicture(0)

            expect(tree.root.findByProps({ testID: 'project-empty-inbox-picture' }, { deep: false })).toBeTruthy()
        })

        it('pops the picture in over the entrance window', async () => {
            const tree = await renderPicture(1)
            const style = StyleSheet.flatten(
                tree.root.findByProps({ testID: 'project-empty-inbox-picture' }, { deep: false }).props.style
            )

            // Frame one: not yet visible and slightly under size.
            expect(style.opacity.__getValue()).toBe(0)
            expect(style.transform[0].scale.__getValue()).toBeLessThan(1)
        })

        /**
         * A settled block has to be byte-identical to the block that was there before the
         * celebration — no residual transform, nothing left behind. Reloading the page and watching
         * the animation finish must produce the same picture.
         */
        it('leaves no residue once the run settles', async () => {
            const tree = await renderPicture(1)

            await act(async () => {
                jest.advanceTimersByTime(PROJECT_CONGRATS_TOTAL_MS + 50)
            })

            const style = StyleSheet.flatten(
                tree.root.findByProps({ testID: 'project-empty-inbox-picture' }, { deep: false }).props.style
            )
            expect(style.transform).toBeUndefined()
            expect(style.opacity).toBeUndefined()
        })

        /**
         * The picture's own sizing moved out one level onto the animated wrapper so the transform
         * could be applied without touching it. If the wrapper ever loses these, the illustration
         * collapses — the exact layout risk the all-projects motion declined to take.
         */
        it('keeps the picture sized exactly as it was before it could animate', async () => {
            const tree = await renderPicture(0)
            const style = StyleSheet.flatten(
                tree.root.findByProps({ testID: 'project-empty-inbox-picture' }, { deep: false }).props.style
            )

            expect(style.flex).toBe(1)
            expect(style.width).toBe('100%')
            expect(style.maxWidth).toBe(432)
        })
    })

    it('stands down entirely under reduced motion, leaving the information on screen', async () => {
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))

        // No sweep — it carries nothing a static frame could preserve, and the empty list already
        // says the project is done.
        const sweep = await renderSweep(1)
        expect(countOf(sweep, 'project-completed-sweep')).toBe(0)

        // …and no disintegration or sparks either: a line that cannot be celebrated leaves exactly
        // the way it always did.
        const leaving = await renderLeavingLine()
        expect(countOf(leaving, 'project-line-disintegration')).toBe(0)
        expect(countOf(leaving, 'project-line-disintegration-spark')).toBe(0)

        // ...and the picture, which IS the congratulation on this board, is simply there.
        const picture = await renderPicture(1)
        expect(picture.root.findByProps({ testID: 'project-empty-inbox-picture' }, { deep: false })).toBeTruthy()
    })
})
