import React from 'react'
import renderer, { act } from 'react-test-renderer'
import moment from 'moment'
import { AccessibilityInfo, Dimensions, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import SelectedProjectEmptyInbox from './SelectedProjectEmptyInbox'
import AllProjectsEmptyInbox from './AllProjectsEmptyInbox'
import ProjectCompletedSweep from '../Header/ProjectCompletedSweep'
import { CONFETTI_BURST_PIECE_COUNT, CONFETTI_PAGE_PIECE_COUNT } from './EmptyInboxConfetti'
import { CONGRATS_TOTAL_MS } from './emptyInboxCongratsMotion'
import { PROJECT_CONGRATS_TOTAL_MS, PROJECT_ENTRANCE_MS } from './projectEmptyInboxCongratsMotion'
import { SWEEP_TOTAL_MS } from './projectCompletedSweepMotion'
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

    const renderSweep = async (celebrationRunId = 0) => {
        let tree
        await act(async () => {
            tree = renderer.create(<ProjectCompletedSweep runId={celebrationRunId} projectId={PROJECT} />)
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

            const picture = await renderPicture(1)
            expect(countOf(picture, 'empty-inbox-confetti')).toBe(0)
            expect(countOf(picture, 'empty-inbox-confetti-burst')).toBe(0)
            expect(countOf(picture, 'empty-inbox-confetti-piece')).toBe(0)
        })

        it('leaves the all-projects celebration exactly as loud as it was', async () => {
            const tree = await renderAllProjects()

            expect(countOf(tree, 'empty-inbox-confetti')).toBe(1)
            expect(countOf(tree, 'empty-inbox-confetti-burst')).toBe(1)
            expect(countOf(tree, 'empty-inbox-confetti-piece')).toBe(
                CONFETTI_BURST_PIECE_COUNT + CONFETTI_PAGE_PIECE_COUNT
            )
        })

        it('is over well before the all-projects celebration would be', () => {
            expect(SWEEP_TOTAL_MS).toBeLessThan(CONGRATS_TOTAL_MS)
            // Comfortably so, not marginally — half or less, or the ranking is not legible to a user.
            expect(SWEEP_TOTAL_MS).toBeLessThanOrEqual(CONGRATS_TOTAL_MS / 2)
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

        // ...and the picture, which IS the congratulation on this board, is simply there.
        const picture = await renderPicture(1)
        expect(picture.root.findByProps({ testID: 'project-empty-inbox-picture' }, { deep: false })).toBeTruthy()
    })
})
