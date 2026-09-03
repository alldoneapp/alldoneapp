import React from 'react'
import renderer, { act } from 'react-test-renderer'
import moment from 'moment'
import { AccessibilityInfo } from 'react-native'

import useProjectCompletedSweep, {
    PROJECT_CELEBRATION_CLAIM_SETTLE_MS,
    PROJECT_LATE_CLEARING_GRACE_MS,
    PROJECT_SWEEP_PROBE_MS,
} from './useProjectCompletedSweep'
import { PROJECT_LINE_EXIT_HOLD_MS, SWEEP_TOTAL_MS } from './projectCompletedSweepMotion'
import {
    hasCelebratedProjectEmptyInboxDay,
    hasReachedProjectEmptyInboxDay,
    markProjectEmptyInboxDayReached,
    resetProjectEmptyInboxCelebrationSessionMarkers,
} from './projectEmptyInboxCelebrationMarker'

let mockState

jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))

/**
 * AT-2492 (second pass) — the rules that decide whether a cleared project is celebrated, and the
 * exit hold that keeps its line on the board long enough for the sweep to be seen.
 *
 * The hold is the part worth reading. In All Projects a cleared project is dropped from the board
 * entirely, so "celebrate the project you just cleared" and "remove the project you just cleared"
 * are in direct conflict, and every case below that mentions `lineWouldLeave` is about resolving it
 * without ever leaving a project stranded on a board it should have left.
 *
 * Motion is inert under jest by convention, and the hold is deliberately not taken when there will
 * be no visible sweep — so this suite opts out of that convention, or every hold assertion would
 * pass vacuously against a hook that had correctly decided to do nothing.
 */

const USER = 'user-1'
const PROJECT = 'project-a'
const PINNED_NOW = new Date('2026-09-02T10:00:00Z')
const todayKey = moment(PINNED_NOW).format('YYYY-MM-DD')

let latest
let matchMediaReducedMotion = false

const Host = ({ projectId = PROJECT, userId = USER, enabled = true, lineWouldLeave = false }) => {
    latest = useProjectCompletedSweep({ projectId, userId, enabled, lineWouldLeave })
    return null
}

const setTodayCount = count => {
    mockState = { sidebarNumbers: count === undefined ? {} : { [PROJECT]: { [USER]: count } } }
}

describe('useProjectCompletedSweep (AT-2492)', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener
    const originalNodeEnv = process.env.NODE_ENV

    beforeEach(() => {
        jest.useFakeTimers()
        jest.setSystemTime(PINNED_NOW)
        localStorage.clear()
        resetProjectEmptyInboxCelebrationSessionMarkers()
        latest = undefined
        setTodayCount(0)
        matchMediaReducedMotion = false
        // `useReducedMotion` reads the media query synchronously on its first render, so a suite
        // that only stubs the async `AccessibilityInfo` answer would claim the day for one commit
        // before standing down — which is precisely the window this must be able to assert on.
        window.matchMedia = jest.fn(query => ({
            matches: query.includes('reduce') ? matchMediaReducedMotion : false,
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

    const render = async (props = {}) => {
        let tree
        await act(async () => {
            tree = renderer.create(<Host {...props} />)
        })
        return tree
    }

    const update = async (tree, props = {}) => {
        await act(async () => {
            tree.update(<Host {...props} />)
        })
    }

    describe('deciding whether there is anything to celebrate', () => {
        it('celebrates a project that was cleared today, once', async () => {
            markProjectEmptyInboxDayReached(USER, PROJECT, todayKey)

            const tree = await render()

            expect(latest.celebrationRunId).toBe(1)
            expect(hasCelebratedProjectEmptyInboxDay(USER, PROJECT, todayKey)).toBe(true)

            // Re-rendering the board must not throw a second sweep.
            await update(tree)
            expect(latest.celebrationRunId).toBe(1)
        })

        /**
         * The rule the whole feature turns on. The account this is built for has 78 projects, 64 of
         * them guides, and most of them are empty on most days — so "the list is empty" cannot mean
         * "the project was cleared", or opening any of them would sweep.
         */
        it('stays silent for a project that was simply empty all day', async () => {
            await render()

            expect(latest.celebrationRunId).toBe(0)
            expect(hasCelebratedProjectEmptyInboxDay(USER, PROJECT, todayKey)).toBe(false)
        })

        it('sees the clearing happen while the board is open', async () => {
            setTodayCount(2)
            const tree = await render()
            expect(latest.celebrationRunId).toBe(0)

            setTodayCount(0)
            await update(tree)

            // It recorded the transition itself rather than waiting for the app-wide detector:
            // effects run child-before-parent, so that one has not run yet on this tick.
            expect(hasReachedProjectEmptyInboxDay(USER, PROJECT, todayKey)).toBe(true)
            expect(latest.celebrationRunId).toBe(1)
        })

        it('records the clearing even on a board that may not celebrate it', async () => {
            setTodayCount(3)
            const tree = await render({ enabled: false })

            setTodayCount(0)
            await update(tree, { enabled: false })

            // The project WAS cleared, so the record stands and the project's own board can still
            // celebrate it later...
            expect(hasReachedProjectEmptyInboxDay(USER, PROJECT, todayKey)).toBe(true)
            // ...but this surface spent nothing.
            expect(latest.celebrationRunId).toBe(0)
            expect(hasCelebratedProjectEmptyInboxDay(USER, PROJECT, todayKey)).toBe(false)
        })

        /**
         * A count that becomes `undefined` is an absent answer, not a cleared project:
         * `clearSidebarTasksAmount` wipes the whole map on an account switch. Recording that as a
         * completion would celebrate work nobody did, tomorrow.
         */
        it('does not read a vanishing count as a completed project', async () => {
            setTodayCount(4)
            const tree = await render()

            setTodayCount(undefined)
            await update(tree)

            expect(hasReachedProjectEmptyInboxDay(USER, PROJECT, todayKey)).toBe(false)
        })

        /**
         * After a reload a project with nothing due today gets no key for this user at all, so its
         * count reads `undefined` rather than `0`. That is the ordinary shape of "cleared this
         * morning, opened this afternoon", which is the main case the record exists for.
         */
        it('still celebrates on a later visit, when the count has gone from absent to unknown', async () => {
            markProjectEmptyInboxDayReached(USER, PROJECT, todayKey)
            setTodayCount(undefined)

            await render()

            expect(latest.celebrationRunId).toBe(1)
        })

        it('hands the day back when the run is torn down before it could be seen', async () => {
            markProjectEmptyInboxDayReached(USER, PROJECT, todayKey)
            const tree = await render()
            expect(hasCelebratedProjectEmptyInboxDay(USER, PROJECT, todayKey)).toBe(true)

            await act(async () => {
                tree.unmount()
            })

            // Nothing was on screen long enough to count, so tomorrow's answer is not "already
            // celebrated" — the AT-2445 lesson, one level down.
            expect(hasCelebratedProjectEmptyInboxDay(USER, PROJECT, todayKey)).toBe(false)
        })

        it('keeps the day once the run has been on screen long enough', async () => {
            markProjectEmptyInboxDayReached(USER, PROJECT, todayKey)
            const tree = await render()

            await act(async () => {
                jest.advanceTimersByTime(PROJECT_CELEBRATION_CLAIM_SETTLE_MS + 50)
            })
            await act(async () => {
                tree.unmount()
            })

            expect(hasCelebratedProjectEmptyInboxDay(USER, PROJECT, todayKey)).toBe(true)
        })
    })

    describe('holding the project line while the sweep plays', () => {
        it('does not hold a line that is not going anywhere', async () => {
            markProjectEmptyInboxDayReached(USER, PROJECT, todayKey)

            await render({ lineWouldLeave: false })

            // The selected-project board keeps its header regardless; the hold is taken but changes
            // nothing there, and what matters is that a sweep still runs.
            expect(latest.celebrationRunId).toBe(1)
        })

        it('keeps a leaving line on the board for the sweep, then lets it go', async () => {
            markProjectEmptyInboxDayReached(USER, PROJECT, todayKey)
            setTodayCount(1)
            const tree = await render({ lineWouldLeave: false })

            // The last task of the project is completed: the count empties and the board decides to
            // drop the block, in the same commit.
            setTodayCount(0)
            await update(tree, { lineWouldLeave: true })

            expect(latest.celebrationRunId).toBe(1)
            expect(latest.holdProjectLine).toBe(true)

            // The hold outlives the sweep...
            await act(async () => {
                jest.advanceTimersByTime(SWEEP_TOTAL_MS)
            })
            expect(latest.holdProjectLine).toBe(true)

            // ...and then expires, so the project leaves the board exactly as it always did.
            await act(async () => {
                jest.advanceTimersByTime(PROJECT_LINE_EXIT_HOLD_MS)
            })
            expect(latest.holdProjectLine).toBe(false)
        })

        /**
         * The ordering case the probe exists for. `thereAreNotTasksInFirstDay` (which drives the
         * hide) and `sidebarNumbers` (which the records are keyed on) are written by two different
         * Firestore listeners and land in whatever order the network gives them. When the hide wins,
         * the line would be gone before we knew the project had been cleared.
         */
        it('waits a beat for the count when the board hides the line first', async () => {
            setTodayCount(1)
            const tree = await render({ lineWouldLeave: false })

            // The hide lands first, with the count still stale.
            await update(tree, { lineWouldLeave: true })
            expect(latest.celebrationRunId).toBe(0)
            // Nothing decided yet, but the line is held so it is still there to sweep.
            expect(latest.holdProjectLine).toBe(true)

            // The count arrives on the next tick, inside the probe window.
            setTodayCount(0)
            await update(tree, { lineWouldLeave: true })

            expect(latest.celebrationRunId).toBe(1)
            expect(latest.holdProjectLine).toBe(true)
        })

        it('releases the line promptly when nothing comes of the probe', async () => {
            setTodayCount(1)
            const tree = await render({ lineWouldLeave: false })

            await update(tree, { lineWouldLeave: true })
            expect(latest.holdProjectLine).toBe(true)

            await act(async () => {
                jest.advanceTimersByTime(PROJECT_SWEEP_PROBE_MS + 10)
            })

            expect(latest.holdProjectLine).toBe(false)
            expect(latest.celebrationRunId).toBe(0)
        })

        /**
         * A project hidden from All Projects renders no header at all, so there is nothing to sweep.
         * Crucially the day must stay UNSPENT, or opening the project's own board later would show
         * nothing — which is the whole "cleared it from My Day, arrived here later" case.
         */
        it('never celebrates a line that was already gone when the board mounted', async () => {
            markProjectEmptyInboxDayReached(USER, PROJECT, todayKey)

            await render({ lineWouldLeave: true })

            expect(latest.celebrationRunId).toBe(0)
            expect(latest.holdProjectLine).toBe(false)
            expect(hasCelebratedProjectEmptyInboxDay(USER, PROJECT, todayKey)).toBe(false)
        })

        /**
         * Every other reason a project block disappears — a priority filter being applied is the
         * common one — must be instant. A board that took a beat to react to a filter would read as
         * lag, and this hook is in the path of all 78 project blocks.
         */
        it('does not delay a line leaving for any other reason', async () => {
            const tree = await render({ enabled: false, lineWouldLeave: false })

            await update(tree, { enabled: false, lineWouldLeave: true })

            expect(latest.holdProjectLine).toBe(false)
        })

        it('takes no hold when there will be no visible sweep', async () => {
            AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))
            markProjectEmptyInboxDayReached(USER, PROJECT, todayKey)
            setTodayCount(1)
            const tree = await render({ lineWouldLeave: false })

            setTodayCount(0)
            await update(tree, { lineWouldLeave: true })

            expect(latest.holdProjectLine).toBe(false)
        })

        /**
         * "I don't see the animation on the project lines" — the follow-up defect.
         *
         * The board drops a cleared project's block, and the hook used to treat "the line is on
         * screen" as a PRECONDITION for celebrating. But in All Projects that is also a CONSEQUENCE
         * of the probe giving up: once the row was dropped, the same still-mounted hook refused the
         * clearing it had been waiting for, permanently — the project never renders a line again
         * that day, so the run was not delayed, it was deleted. Two independent Firestore listeners
         * feed this decision, so losing the race is ordinary rather than exotic.
         *
         * A clearing this hook WATCHED is proof the line was there a moment ago, so it must still
         * play — and taking the hold is what puts the row back for it.
         */
        it('still sweeps a clearing that lands after the board already dropped the line', async () => {
            setTodayCount(1)
            const tree = await render({ lineWouldLeave: false })

            // The hide lands first and the probe runs out with the count still stale.
            await update(tree, { lineWouldLeave: true })
            await act(async () => {
                jest.advanceTimersByTime(PROJECT_SWEEP_PROBE_MS + 10)
            })
            expect(latest.holdProjectLine).toBe(false)
            expect(latest.celebrationRunId).toBe(0)

            // Only now does the count listener report the clearing.
            setTodayCount(0)
            await update(tree, { lineWouldLeave: true })

            expect(latest.celebrationRunId).toBe(1)
            // ...and the row comes back for exactly one sweep, then goes.
            expect(latest.holdProjectLine).toBe(true)
            await act(async () => {
                jest.advanceTimersByTime(PROJECT_LINE_EXIT_HOLD_MS + 10)
            })
            expect(latest.holdProjectLine).toBe(false)
        })

        /**
         * The cure above is bounded, so it cannot resurrect a row long after the moment passed. The
         * day must stay unspent when it declines, or the project's own board would later show
         * nothing.
         */
        it('lets a clearing go once the moment has passed, without spending the day', async () => {
            setTodayCount(1)
            const tree = await render({ lineWouldLeave: false })

            await update(tree, { lineWouldLeave: true })
            // Let the probe run out first, so the line has actually left and the grace is measured
            // from that commit rather than from the end of one big timer batch.
            await act(async () => {
                jest.advanceTimersByTime(PROJECT_SWEEP_PROBE_MS + 10)
            })
            expect(latest.holdProjectLine).toBe(false)

            await act(async () => {
                jest.advanceTimersByTime(PROJECT_LATE_CLEARING_GRACE_MS + 100)
            })

            setTodayCount(0)
            await update(tree, { lineWouldLeave: true })

            expect(latest.celebrationRunId).toBe(0)
            expect(latest.holdProjectLine).toBe(false)
            expect(hasCelebratedProjectEmptyInboxDay(USER, PROJECT, todayKey)).toBe(false)
            // The evidence survives, so opening the project's own board still celebrates it.
            expect(hasReachedProjectEmptyInboxDay(USER, PROJECT, todayKey)).toBe(true)
        })

        /**
         * A day spent on a run nobody was shown is a celebration that silently never happens
         * (AT-2445). The sweep renders nothing at all under reduced motion, so the claim must not be
         * made — react-native-web also resolves the preference to `true` whenever `matchMedia` is
         * missing, so this branch is reachable by an environment that merely cannot answer.
         */
        it('never spends the day on a sweep that cannot be seen', async () => {
            matchMediaReducedMotion = true
            AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))
            markProjectEmptyInboxDayReached(USER, PROJECT, todayKey)
            setTodayCount(0)

            await render()

            expect(latest.celebrationRunId).toBe(0)
            expect(latest.holdProjectLine).toBe(false)
            expect(hasCelebratedProjectEmptyInboxDay(USER, PROJECT, todayKey)).toBe(false)
            // The evidence survives, so the day is still there to be celebrated with motion on.
            expect(hasReachedProjectEmptyInboxDay(USER, PROJECT, todayKey)).toBe(true)
        })

        /**
         * The two timers are started from different components — the sweep from the overlay inside
         * `ProjectHeader`, the hold from `OpenTasksByProject` — so nothing guarantees their order.
         * The hold has to be the longer of the two or the line can leave mid-sweep.
         */
        it('holds the line for longer than the sweep needs', () => {
            expect(PROJECT_LINE_EXIT_HOLD_MS).toBeGreaterThan(SWEEP_TOTAL_MS)
            // And the refund window outlasts the hold, so a run that played in full is never undone.
            expect(PROJECT_CELEBRATION_CLAIM_SETTLE_MS).toBeGreaterThan(PROJECT_LINE_EXIT_HOLD_MS)
        })
    })
})
