import React from 'react'
import renderer, { act } from 'react-test-renderer'
import moment from 'moment'
import { AccessibilityInfo } from 'react-native'

import { EmptyInboxOverview } from './AchievementsArea'
import { CELEBRATION_TOTAL_MS, STREAK_TICK_DELAY_MS } from './emptyInboxDotMotion'
import { resetEmptyInboxCelebrationSessionMarkers } from './emptyInboxCelebrationMarker'

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: (key, values = {}) => (values.date ? `${key} ${values.date}` : key),
}))

/**
 * AT-2418 — drives the REAL card through the REAL animated branch, end to end.
 *
 * This file exists because of how the previous celebration rotted. It had unit tests, they passed,
 * and the animation had nevertheless stopped reaching users: the only test of the banner mocked
 * `isReduceMotionEnabled` to `true`, so the suite exercised the static reduced-motion branch and
 * nothing ever ran the animated one. The two things that were actually broken — the celebration
 * never firing unless you were already watching the board at the right millisecond, and the
 * animated path itself — were both outside what the tests looked at.
 *
 * So: opt out of jest's inert-animation convention, opt out of reduced motion, and assert on the
 * beats a user would see.
 */

// `__mocks__/moment.js` pins `Date.now` repo-wide, but `jest.useFakeTimers()` installs a clock of
// its own and overrides it — so a suite that uses fake timers AND reads "today" has to say which
// clock wins, or the component resolves a different day than the test data was built for and
// nothing celebrates.
const PINNED_NOW = new Date('2019-04-22T10:20:30Z')
const todayKey = moment(PINNED_NOW).format('YYYY-MM-DD')
const yesterdayKey = moment(PINNED_NOW).subtract(1, 'day').format('YYYY-MM-DD')

const countOf = (tree, testID) => tree.root.findAllByProps({ testID }, { deep: false }).length
const streakValue = tree =>
    tree.root.findByProps({ testID: 'empty-inbox-streak-value' }, { deep: false }).props.children

describe('the empty-inbox day celebration, end to end', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener
    const originalAnnounce = AccessibilityInfo.announceForAccessibility
    const originalNodeEnv = process.env.NODE_ENV

    beforeEach(() => {
        resetEmptyInboxCelebrationSessionMarkers()
        localStorage.clear()
        jest.useFakeTimers()
        jest.setSystemTime(PINNED_NOW)
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        AccessibilityInfo.addEventListener = jest.fn(() => ({ remove: jest.fn() }))
        AccessibilityInfo.announceForAccessibility = jest.fn()
        // The motion is inert under jest by convention, so a suite that wants to see the real
        // branch has to opt out of it — otherwise every assertion below passes vacuously.
        process.env.NODE_ENV = 'development'
    })

    afterEach(() => {
        jest.useRealTimers()
        AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
        AccessibilityInfo.addEventListener = originalAddEventListener
        AccessibilityInfo.announceForAccessibility = originalAnnounce
        process.env.NODE_ENV = originalNodeEnv
    })

    const renderBoard = async emptyInboxDays => {
        let tree
        await act(async () => {
            tree = renderer.create(<EmptyInboxOverview user={{ uid: 'user-1', emptyInboxDays }} celebrateNewDay />)
        })
        return tree
    }

    it('plays the full run when the last task is cleared while the board is open', async () => {
        const tree = await renderBoard([yesterdayKey])

        expect(countOf(tree, 'empty-inbox-today-dot')).toBe(0)
        // Nothing is celebrating, so the streak renders as the plain Text it is every other day.
        expect(countOf(tree, 'empty-inbox-streak-value')).toBe(0)

        // The user completes their last task: the write lands and today joins the achievement days.
        await act(async () => {
            tree.update(
                <EmptyInboxOverview
                    user={{ uid: 'user-1', emptyInboxDays: [yesterdayKey, todayKey] }}
                    celebrateNewDay
                />
            )
        })

        expect(countOf(tree, 'empty-inbox-today-dot')).toBe(1)
        expect(countOf(tree, 'empty-inbox-dot-halo')).toBe(1)
        expect(countOf(tree, 'empty-inbox-dot-ring')).toBe(1)
        expect(countOf(tree, 'empty-inbox-dot-spark')).toBe(6)
        // Yesterday's streak is still on screen while the dot lands.
        expect(streakValue(tree)).toBe(1)

        await act(async () => {
            jest.advanceTimersByTime(STREAK_TICK_DELAY_MS)
        })
        expect(streakValue(tree)).toBe(2)

        await act(async () => {
            jest.advanceTimersByTime(CELEBRATION_TOTAL_MS)
        })

        // Settled: the dot stays green, every decorative layer is gone.
        expect(countOf(tree, 'empty-inbox-today-dot')).toBe(1)
        expect(countOf(tree, 'empty-inbox-dot-fill')).toBe(1)
        expect(countOf(tree, 'empty-inbox-dot-ring')).toBe(0)
        expect(countOf(tree, 'empty-inbox-dot-spark')).toBe(0)
        expect(streakValue(tree)).toBe(2)
    })

    // The case the old implementation could not reach at all: the inbox was cleared somewhere else
    // (My Day, another device) and the board is opened afterwards.
    it('plays the full run on the first view of a day earned elsewhere', async () => {
        const tree = await renderBoard([yesterdayKey, todayKey])

        expect(countOf(tree, 'empty-inbox-today-dot')).toBe(1)
        expect(countOf(tree, 'empty-inbox-dot-ring')).toBe(1)
        expect(streakValue(tree)).toBe(1)

        await act(async () => {
            jest.advanceTimersByTime(CELEBRATION_TOTAL_MS)
        })

        expect(streakValue(tree)).toBe(2)
        expect(countOf(tree, 'empty-inbox-dot-ring')).toBe(0)
    })

    it('announces the day to screen readers as it plays', async () => {
        await renderBoard([yesterdayKey, todayKey])

        expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Empty inbox streak day added')
    })

    it('shows a finished, static card under reduced motion', async () => {
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))

        const tree = await renderBoard([yesterdayKey, todayKey])

        // The information survives — the day is green and the streak is correct — and no beat of
        // the motion is rendered at all.
        expect(countOf(tree, 'empty-inbox-dot-fill')).toBe(1)
        expect(countOf(tree, 'empty-inbox-dot-ring')).toBe(0)
        expect(countOf(tree, 'empty-inbox-dot-spark')).toBe(0)
        expect(streakValue(tree)).toBe(2)
    })

    it('does not replay for the rest of the day', async () => {
        const firstVisit = await renderBoard([yesterdayKey, todayKey])
        expect(countOf(firstVisit, 'empty-inbox-today-dot')).toBe(1)

        await act(async () => {
            jest.advanceTimersByTime(CELEBRATION_TOTAL_MS)
            firstVisit.unmount()
        })

        const secondVisit = await renderBoard([yesterdayKey, todayKey])

        expect(countOf(secondVisit, 'empty-inbox-today-dot')).toBe(0)
        expect(countOf(secondVisit, 'empty-inbox-dot-ring')).toBe(0)
    })
})
