import React from 'react'
import renderer, { act } from 'react-test-renderer'
import moment from 'moment'
import { AccessibilityInfo, StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import AllProjectsEmptyInbox from './AllProjectsEmptyInbox'
import {
    CONFETTI_BURST_PIECE_COUNT,
    CONFETTI_LAYER_Z_INDEX,
    CONFETTI_PAGE_PIECE_COUNT,
    CONFETTI_PIECE_COUNT,
} from './EmptyInboxConfetti'
import { CONGRATS_TOTAL_MS, HEADLINE_MS } from './emptyInboxCongratsMotion'
import { resetEmptyInboxCelebrationSessionMarkers } from '../../SettingsView/Profile/Achievements/emptyInboxCelebrationMarker'
import { CELEBRATION_CLAIM_SETTLE_MS } from '../../SettingsView/Profile/Achievements/useTodayEmptyInboxCelebration'
import { CELEBRATION_TOTAL_MS, DOT_START_DELAY_MS } from '../../SettingsView/Profile/Achievements/emptyInboxDotMotion'

/**
 * AT-2445 — drives the REAL congrats block through the REAL animated branch.
 *
 * This file exists for the same reason AT-2418's `EmptyInboxCelebrationFlow` does, and because of
 * how its predecessor rotted: the only test of the old celebration mocked `isReduceMotionEnabled`
 * to `true`, so the suite exercised the static branch forever and nothing ever ran the animated one.
 * Motion is inert under jest by convention here, so a suite that wants to see what a user sees has
 * to opt out of BOTH.
 */

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
}))
jest.mock('../../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../../../redux/actions', () => ({
    navigateToSettings: jest.fn(options => ({ type: 'Navigate to settings', options })),
}))
jest.mock('./AllProjectsEmptyInboxAddTask', () => 'AllProjectsEmptyInboxAddTask')
jest.mock('./AllProjectsEmptyInboxTags', () => 'AllProjectsEmptyInboxTags')
jest.mock('./AllProjectsEmptyInboxText', () => 'AllProjectsEmptyInboxText')
jest.mock('./AllProjectsEmptyInboxPicture', () => 'AllProjectsEmptyInboxPicture')
jest.mock('../../SettingsView/Profile/Achievements/AchievementsArea', () => ({
    EmptyInboxOverview: 'EmptyInboxOverview',
}))

const PINNED_NOW = new Date('2026-08-26T18:52:00Z')
const todayKey = moment(PINNED_NOW).format('YYYY-MM-DD')
const yesterdayKey = moment(PINNED_NOW).subtract(1, 'day').format('YYYY-MM-DD')

const countOf = (tree, testID) => tree.root.findAllByProps({ testID }, { deep: false }).length

describe('the empty-inbox congrats celebration, end to end (AT-2445)', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener
    const originalNodeEnv = process.env.NODE_ENV
    const dispatch = jest.fn()

    beforeEach(() => {
        jest.clearAllMocks()
        resetEmptyInboxCelebrationSessionMarkers()
        localStorage.clear()
        jest.useFakeTimers()
        jest.setSystemTime(PINNED_NOW)
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        AccessibilityInfo.addEventListener = jest.fn(() => ({ remove: jest.fn() }))
        useDispatch.mockReturnValue(dispatch)
        // The motion is inert under jest by convention, so a suite that wants the real branch has to
        // opt out of it — otherwise every assertion below passes vacuously.
        process.env.NODE_ENV = 'development'
    })

    afterEach(() => {
        jest.useRealTimers()
        AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
        AccessibilityInfo.addEventListener = originalAddEventListener
        process.env.NODE_ENV = originalNodeEnv
    })

    const renderBoard = async (emptyInboxDays, props = { showEmptyInboxOverview: true, celebrateNewDay: true }) => {
        useSelector.mockImplementation(selector => selector({ loggedUser: { uid: 'user-1', emptyInboxDays } }))
        let tree
        await act(async () => {
            tree = renderer.create(<AllProjectsEmptyInbox {...props} />)
        })
        return tree
    }

    it('throws confetti when the last task of the day is cleared while the board is open', async () => {
        const tree = await renderBoard([yesterdayKey])

        expect(countOf(tree, 'empty-inbox-confetti')).toBe(0)

        // The write lands and today joins the achievement days.
        await act(async () => {
            useSelector.mockImplementation(selector =>
                selector({ loggedUser: { uid: 'user-1', emptyInboxDays: [yesterdayKey, todayKey] } })
            )
            tree.update(<AllProjectsEmptyInbox showEmptyInboxOverview celebrateNewDay />)
        })

        // AT-2460: two layers. The burst is thrown from behind the headline, so the celebration is
        // visibly caused by the line being read; the page layer covers the whole viewport, which is
        // what makes it an event rather than a flourish next to a headline on a wide board.
        expect(countOf(tree, 'empty-inbox-confetti')).toBe(1)
        expect(countOf(tree, 'empty-inbox-confetti-burst')).toBe(1)
        expect(countOf(tree, 'empty-inbox-confetti-piece')).toBe(CONFETTI_PIECE_COUNT)
        expect(CONFETTI_PIECE_COUNT).toBe(CONFETTI_BURST_PIECE_COUNT + CONFETTI_PAGE_PIECE_COUNT)

        await act(async () => {
            jest.advanceTimersByTime(CONGRATS_TOTAL_MS)
        })

        // Settled: every decorative layer is gone and the block is the block a reload paints.
        expect(countOf(tree, 'empty-inbox-confetti')).toBe(0)
        expect(countOf(tree, 'empty-inbox-confetti-burst')).toBe(0)
        expect(countOf(tree, 'empty-inbox-congrats-headline')).toBe(1)
    })

    /**
     * AT-2460 — the page layer is the reason this is "much more celebratory", so the two properties
     * that keep it acceptable are pinned rather than left to review.
     *
     * It is the same class of overlay as the full-screen Giphy animation AT-2404 removed, and the
     * difference is entirely in these two attributes: it cannot receive a tap, and it never covers
     * content opaquely. Losing either would reintroduce the thing that was deleted on purpose.
     */
    it('cannot swallow a tap and paints nothing opaque over the page', async () => {
        const tree = await renderBoard([yesterdayKey, todayKey])
        const layerStyle = testId => {
            const layer = tree.root.findByProps({ testID: testId }, { deep: false })
            return StyleSheet.flatten(layer.props.style)
        }

        const page = layerStyle('empty-inbox-confetti')
        expect(page.pointerEvents).toBe('none')
        expect(page.backgroundColor).toBeUndefined()
        // Escapes the scroll container it is rendered inside without a portal, and clips itself so
        // a piece travelling past the bottom edge cannot add a scrollbar to the app shell.
        expect(page.position).toBe('fixed')
        expect(page.overflow).toBe('hidden')

        expect(layerStyle('empty-inbox-confetti-burst').pointerEvents).toBe('none')
    })

    /**
     * The block is lifted for exactly as long as it celebrates.
     *
     * The confetti layer's own `zIndex` cannot reach past this View — react-native-web gives every
     * View `z-index: 0`, so the block is already its own stacking context — and without the lift a
     * page-wide fall paints behind everything the board renders below the block. Putting it back is
     * the other half: an all-projects board permanently lifted above the email line and the task
     * filters would be a stacking change nobody asked for.
     */
    it('lifts the block only while the confetti is falling', async () => {
        const tree = await renderBoard([yesterdayKey, todayKey])
        const blockZIndex = () => StyleSheet.flatten(tree.root.findByType(View).props.style).zIndex ?? 'unset'

        expect(blockZIndex()).toBe(CONFETTI_LAYER_Z_INDEX)

        await act(async () => {
            jest.advanceTimersByTime(CONGRATS_TOTAL_MS)
        })

        expect(blockZIndex()).toBe('unset')
    })

    /**
     * The two halves of the celebration are one event on one run id, so their schedules have to
     * interlock: the dot waits out the headline, and the day is not spent until the longest of them
     * has been on screen. Asserted here because this is the one suite that can see both.
     */
    it('interlocks the headline, the dot and the once-per-day claim', () => {
        // The dot starts once the congratulation has settled, not while it is still arriving —
        // the two competing for the same half-second, several blocks apart, is what made the dot
        // impossible to find in the first place.
        expect(DOT_START_DELAY_MS).toBeGreaterThanOrEqual(HEADLINE_MS)
        // ...and while the confetti is still falling, so the page never goes quiet mid-celebration.
        expect(DOT_START_DELAY_MS).toBeLessThan(CONGRATS_TOTAL_MS)
        // A day may only be counted as spent once the whole thing has had time to play. Too short
        // and a user who navigated away mid-run has silently lost the celebration for good.
        expect(CELEBRATION_CLAIM_SETTLE_MS).toBeGreaterThanOrEqual(CONGRATS_TOTAL_MS)
        expect(CELEBRATION_CLAIM_SETTLE_MS).toBeGreaterThanOrEqual(CELEBRATION_TOTAL_MS)
    })

    // The case AT-2418 already fixed for the dot and which must hold for the whole block: the inbox
    // was cleared somewhere else (My Day, another device) and the board is opened afterwards.
    it('plays on the first view of a day earned elsewhere', async () => {
        const tree = await renderBoard([yesterdayKey, todayKey])

        expect(countOf(tree, 'empty-inbox-confetti')).toBe(1)
    })

    // The whole point of this task: My Day has no achievement card, so before this change clearing
    // your last task there produced a silent congratulation and nothing else.
    it('plays in My Day, which has no achievement card at all', async () => {
        const tree = await renderBoard([yesterdayKey, todayKey], { celebrateNewDay: true })

        expect(tree.root.findAllByType('EmptyInboxOverview')).toHaveLength(0)
        expect(countOf(tree, 'empty-inbox-confetti-piece')).toBe(CONFETTI_PIECE_COUNT)
    })

    it('shows a finished, static block under reduced motion', async () => {
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))

        const tree = await renderBoard([yesterdayKey, todayKey])

        // The information survives — the congratulation is on screen — and no beat of the motion is
        // rendered at all, because confetti carries nothing a static frame could preserve.
        expect(countOf(tree, 'empty-inbox-congrats-headline')).toBe(1)
        expect(countOf(tree, 'empty-inbox-confetti')).toBe(0)
    })

    it('does not replay for the rest of the day', async () => {
        const firstVisit = await renderBoard([yesterdayKey, todayKey])
        expect(countOf(firstVisit, 'empty-inbox-confetti')).toBe(1)

        // The day is spent once the run has been on screen for the refund window, which is
        // deliberately a little longer than the motion itself — a visit that ends sooner is treated
        // as never having been seen and the celebration is still owed (AT-2445).
        await act(async () => {
            jest.advanceTimersByTime(CELEBRATION_CLAIM_SETTLE_MS)
            firstVisit.unmount()
        })

        const secondVisit = await renderBoard([yesterdayKey, todayKey])

        expect(countOf(secondVisit, 'empty-inbox-confetti')).toBe(0)
    })

    /**
     * The other half of that rule, and the one AT-2460 could have broken silently: the celebration
     * got two and a half times longer, so a claim window left at its old length would have started
     * counting runs the user never saw as spent.
     */
    it('hands the day back when the board is left before the celebration has played', async () => {
        const interrupted = await renderBoard([yesterdayKey, todayKey])
        expect(countOf(interrupted, 'empty-inbox-confetti')).toBe(1)

        await act(async () => {
            jest.advanceTimersByTime(CONGRATS_TOTAL_MS - 100)
            interrupted.unmount()
        })

        const secondVisit = await renderBoard([yesterdayKey, todayKey])

        expect(countOf(secondVisit, 'empty-inbox-confetti')).toBe(1)
    })

    /**
     * The confetti trajectories must not be re-rolled on a re-render. The all-projects board is
     * subscribed to the task counts and re-renders constantly, and a `Math.random()` read during
     * render would teleport every piece onto a fresh trajectory each time — mid-flight.
     */
    it('keeps every piece on the trajectory it was launched on', async () => {
        const tree = await renderBoard([yesterdayKey, todayKey])
        const transformsOf = () =>
            tree.root
                .findAllByProps({ testID: 'empty-inbox-confetti-piece' }, { deep: false })
                .map(piece => JSON.stringify(piece.props.style))

        const before = transformsOf()

        await act(async () => {
            tree.update(<AllProjectsEmptyInbox showEmptyInboxOverview celebrateNewDay />)
        })

        expect(transformsOf()).toEqual(before)
    })
})
