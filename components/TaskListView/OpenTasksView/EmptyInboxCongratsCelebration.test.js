import React from 'react'
import renderer, { act } from 'react-test-renderer'
import moment from 'moment'
import { AccessibilityInfo } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import AllProjectsEmptyInbox from './AllProjectsEmptyInbox'
import { CONFETTI_PIECE_COUNT } from './EmptyInboxConfetti'
import { CONGRATS_TOTAL_MS } from './emptyInboxCongratsMotion'
import { resetEmptyInboxCelebrationSessionMarkers } from '../../SettingsView/Profile/Achievements/emptyInboxCelebrationMarker'

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

        expect(countOf(tree, 'empty-inbox-confetti')).toBe(1)
        expect(countOf(tree, 'empty-inbox-confetti-piece')).toBe(CONFETTI_PIECE_COUNT)

        await act(async () => {
            jest.advanceTimersByTime(CONGRATS_TOTAL_MS)
        })

        // Settled: every decorative layer is gone and the block is the block a reload paints.
        expect(countOf(tree, 'empty-inbox-confetti')).toBe(0)
        expect(countOf(tree, 'empty-inbox-congrats-headline')).toBe(1)
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

        await act(async () => {
            jest.advanceTimersByTime(CONGRATS_TOTAL_MS)
            firstVisit.unmount()
        })

        const secondVisit = await renderBoard([yesterdayKey, todayKey])

        expect(countOf(secondVisit, 'empty-inbox-confetti')).toBe(0)
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
