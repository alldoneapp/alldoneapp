import React from 'react'
import renderer, { act } from 'react-test-renderer'
import moment from 'moment'
import { AccessibilityInfo, Dimensions, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import SelectedProjectEmptyInbox from './SelectedProjectEmptyInbox'
import AllProjectsEmptyInbox from './AllProjectsEmptyInbox'
import {
    CONFETTI_BURST_PIECE_COUNT,
    CONFETTI_COMPACT_BURST_PIECE_COUNT,
    CONFETTI_PAGE_PIECE_COUNT,
} from './EmptyInboxConfetti'
import { CONGRATS_TOTAL_MS } from './emptyInboxCongratsMotion'
import { PROJECT_CONGRATS_TOTAL_MS, PROJECT_ENTRANCE_MS } from './projectEmptyInboxCongratsMotion'
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
 * AT-2492 — drives the REAL per-project block through the REAL animated branch, and measures it
 * against the REAL all-projects block.
 *
 * The task is a statement about RANKING — "celebrate it already a little, but not as much as when we
 * achieve empty inbox across all projects" — so the assertions that matter are comparative. A suite
 * that only checked "the small one animates" would keep passing on the day somebody quietly gave it
 * the page-wide confetti fall, which is the one thing that must stay exclusive to the bigger moment.
 *
 * Motion is inert under jest by convention here and stands down under reduced motion, so a suite
 * that wants to see what a user sees has to opt out of BOTH — otherwise every assertion below passes
 * vacuously. That is exactly how AT-2445's predecessor rotted.
 */

const VIEWPORT = { width: 1280, height: 800, scale: 1, fontScale: 1 }

const countOf = (tree, testID) => tree.root.findAllByProps({ testID }, { deep: false }).length

describe('the per-project empty-inbox celebration, end to end (AT-2492)', () => {
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

    const renderProjectBlock = async (celebrationRunId = 0) => {
        let tree
        await act(async () => {
            tree = renderer.create(
                <SelectedProjectEmptyInbox
                    projectId="project-a"
                    instanceKey="key"
                    celebrationRunId={celebrationRunId}
                />
            )
        })
        return tree
    }

    it('renders the plain picture and nothing else when there is nothing to celebrate', async () => {
        const tree = await renderProjectBlock(0)

        expect(countOf(tree, 'empty-inbox-confetti-burst')).toBe(0)
        expect(countOf(tree, 'empty-inbox-confetti-piece')).toBe(0)
        expect(tree.root.findByProps({ testID: 'project-empty-inbox-picture' }, { deep: false })).toBeTruthy()
    })

    it('throws a burst when the project is cleared', async () => {
        const tree = await renderProjectBlock(1)

        expect(countOf(tree, 'empty-inbox-confetti-burst')).toBe(1)
        expect(countOf(tree, 'empty-inbox-confetti-piece')).toBe(CONFETTI_COMPACT_BURST_PIECE_COUNT)
    })

    /**
     * The line between the two celebrations, and it is a difference in KIND rather than in degree.
     * The page-wide fall is what makes the all-projects moment visible from across a room; the
     * per-project one stays a flourish over the block you are already looking at. Tuning piece
     * counts alone would have left the two reading as "the same thing, slightly weaker".
     */
    it('never rains across the page — that stays exclusive to the all-projects moment', async () => {
        const projectTree = await renderProjectBlock(1)

        expect(countOf(projectTree, 'empty-inbox-confetti')).toBe(0)

        // The all-projects block earns its own celebration from a day recorded on the user document.
        resetEmptyInboxCelebrationSessionMarkers()
        localStorage.clear()
        useSelector.mockImplementation(selector =>
            selector({
                loggedUser: { uid: 'user-1', emptyInboxDays: [moment().format('YYYY-MM-DD')] },
                isMiddleScreen: false,
            })
        )

        let allProjectsTree
        await act(async () => {
            allProjectsTree = renderer.create(<AllProjectsEmptyInbox showEmptyInboxOverview celebrateNewDay />)
        })

        expect(countOf(allProjectsTree, 'empty-inbox-confetti')).toBe(1)
        expect(countOf(allProjectsTree, 'empty-inbox-confetti-piece')).toBe(
            CONFETTI_BURST_PIECE_COUNT + CONFETTI_PAGE_PIECE_COUNT
        )
    })

    it('is smaller and shorter than the all-projects celebration', () => {
        expect(CONFETTI_COMPACT_BURST_PIECE_COUNT).toBeLessThan(CONFETTI_BURST_PIECE_COUNT)
        expect(PROJECT_CONGRATS_TOTAL_MS).toBeLessThan(CONGRATS_TOTAL_MS)
        // Comfortably so, not marginally — half or less, or the ranking is not legible to a user.
        expect(PROJECT_CONGRATS_TOTAL_MS).toBeLessThanOrEqual(CONGRATS_TOTAL_MS / 2)
    })

    /**
     * The burst is anchored to a zero-size absolute overlay and is `pointerEvents: none`, so it can
     * neither move the picture while it plays nor swallow a tap on anything under it. This is the
     * property that keeps it on the right side of the full-screen Giphy overlay AT-2404 retired.
     */
    it('cannot move or intercept anything while it plays', async () => {
        const tree = await renderProjectBlock(1)
        const burstLayer = tree.root.findByProps({ testID: 'empty-inbox-confetti-burst' }, { deep: false })
        const style = StyleSheet.flatten(burstLayer.props.style)

        expect(style.position).toBe('absolute')
        expect(style.pointerEvents).toBe('none')
    })

    /**
     * A settled block has to be byte-identical to the block that was there before the celebration —
     * no residual transform, nothing left behind. Reloading the page and watching the animation
     * finish must produce the same picture.
     */
    it('leaves no residue once the run settles', async () => {
        const tree = await renderProjectBlock(1)

        await act(async () => {
            jest.advanceTimersByTime(PROJECT_CONGRATS_TOTAL_MS + 50)
        })

        expect(countOf(tree, 'empty-inbox-confetti-burst')).toBe(0)
        const picture = tree.root.findByProps({ testID: 'project-empty-inbox-picture' }, { deep: false })
        const style = StyleSheet.flatten(picture.props.style)
        expect(style.transform).toBeUndefined()
        expect(style.opacity).toBeUndefined()
    })

    /**
     * The picture's own sizing moved out one level onto the animated wrapper so the transform could
     * be applied without touching it. If the wrapper ever loses these, the illustration collapses —
     * the exact layout risk the all-projects motion declined to take with its own picture.
     */
    it('keeps the picture sized exactly as it was before it could animate', async () => {
        const tree = await renderProjectBlock(0)
        const picture = tree.root.findByProps({ testID: 'project-empty-inbox-picture' }, { deep: false })
        const style = StyleSheet.flatten(picture.props.style)

        expect(style.flex).toBe(1)
        expect(style.width).toBe('100%')
        expect(style.maxWidth).toBe(432)
    })

    it('stands down entirely under reduced motion, leaving the information on screen', async () => {
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))

        const tree = await renderProjectBlock(1)

        // No confetti at all — it carries nothing a static frame could preserve...
        expect(countOf(tree, 'empty-inbox-confetti-burst')).toBe(0)
        // ...and the picture, which IS the congratulation, is simply there.
        expect(tree.root.findByProps({ testID: 'project-empty-inbox-picture' }, { deep: false })).toBeTruthy()
    })

    it('animates the picture in over the entrance window', async () => {
        const tree = await renderProjectBlock(1)
        const picture = tree.root.findByProps({ testID: 'project-empty-inbox-picture' }, { deep: false })
        const style = StyleSheet.flatten(picture.props.style)

        // Frame one: not yet visible and slightly under size.
        expect(style.opacity.__getValue()).toBe(0)
        expect(style.transform[0].scale.__getValue()).toBeLessThan(1)

        // The entrance is over well before the burst is.
        expect(PROJECT_ENTRANCE_MS).toBeLessThan(PROJECT_CONGRATS_TOTAL_MS)
    })
})
