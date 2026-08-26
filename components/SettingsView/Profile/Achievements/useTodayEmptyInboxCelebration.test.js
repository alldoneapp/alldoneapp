import React from 'react'
import renderer, { act } from 'react-test-renderer'
import moment from 'moment'
import { Text } from 'react-native'

import useTodayEmptyInboxCelebration, { CELEBRATION_CLAIM_SETTLE_MS } from './useTodayEmptyInboxCelebration'
import { CELEBRATION_TOTAL_MS } from './emptyInboxDotMotion'
import { resetEmptyInboxCelebrationSessionMarkers } from './emptyInboxCelebrationMarker'

function CelebrationHarness({ days, enabled = true, userId = 'user-1' }) {
    const runId = useTodayEmptyInboxCelebration(days, enabled, userId)
    return <Text>{runId}</Text>
}

const runIdOf = tree => tree.root.findByType(Text).props.children

describe('useTodayEmptyInboxCelebration', () => {
    const todayKey = moment().format('YYYY-MM-DD')
    const yesterdayKey = moment().subtract(1, 'day').format('YYYY-MM-DD')

    beforeEach(() => {
        resetEmptyInboxCelebrationSessionMarkers()
        localStorage.clear()
        // AT-2445: the day is only SPENT once its run has been on screen for the settle window, so
        // these tests have to be able to move that clock. `Date` stays real — the suite reads
        // "today" through moment and one test spies on `Date.now` to roll the day over.
        jest.useFakeTimers({ doNotFake: ['Date', 'performance'] })
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    // The run is played out, i.e. the user actually saw the celebration.
    const playOutCelebration = () => act(() => jest.advanceTimersByTime(CELEBRATION_CLAIM_SETTLE_MS))

    it('triggers when today is added to the persisted achievement days', () => {
        let tree
        act(() => {
            tree = renderer.create(<CelebrationHarness days={[yesterdayKey]} />)
        })
        expect(runIdOf(tree)).toBe(0)

        act(() => {
            tree.update(<CelebrationHarness days={[yesterdayKey, todayKey]} />)
        })
        expect(runIdOf(tree)).toBe(1)

        // An unrelated re-render (the array is rebuilt on every snapshot) must not re-fire it.
        act(() => {
            tree.update(<CelebrationHarness days={[todayKey, yesterdayKey]} />)
        })
        expect(runIdOf(tree)).toBe(1)
    })

    // AT-2418 — this is the case the previous implementation got wrong, and the reason the
    // animation had effectively disappeared. Clearing the last task from My Day, or from a phone,
    // means the board mounts with today ALREADY achieved; the old hook compared against its own
    // first render, decided nothing had changed, and never celebrated.
    it('triggers on the first view of a day that was already achieved elsewhere', () => {
        let tree
        act(() => {
            tree = renderer.create(<CelebrationHarness days={[todayKey]} />)
        })

        expect(runIdOf(tree)).toBe(1)
    })

    it('celebrates a day only once, across mounts', () => {
        let firstVisit
        act(() => {
            firstVisit = renderer.create(<CelebrationHarness days={[todayKey]} />)
        })
        expect(runIdOf(firstVisit)).toBe(1)
        playOutCelebration()
        act(() => firstVisit.unmount())

        // Tab away and back: the board remounts and must not replay.
        let secondVisit
        act(() => {
            secondVisit = renderer.create(<CelebrationHarness days={[todayKey]} />)
        })

        expect(runIdOf(secondVisit)).toBe(0)
    })

    /**
     * AT-2445 — the defect this task was filed for.
     *
     * The all-projects board used to render its empty-inbox block throughout its loading window,
     * because `openTasksAmount` starts at 0 and is reset to 0 whenever the count watchers are
     * rebuilt. That mount reached this hook, which claimed the day in a `useLayoutEffect` and was
     * torn down again a few frames later when the real counts arrived — so the day was spent by a
     * frame nobody saw, and the genuine empty-inbox moment later that day showed no animation at
     * all. The board no longer does that; this is the second line of defence.
     */
    it('hands the day back when the run is torn down before it can be seen', () => {
        let loadingFlash
        act(() => {
            loadingFlash = renderer.create(<CelebrationHarness days={[todayKey]} />)
        })
        expect(runIdOf(loadingFlash)).toBe(1)

        // The counts land, the board stops claiming to be empty, and the block goes away well
        // inside the settle window.
        act(() => jest.advanceTimersByTime(50))
        act(() => loadingFlash.unmount())

        // Later that day the inbox really is empty. The celebration is still owed.
        let realEmptyInbox
        act(() => {
            realEmptyInbox = renderer.create(<CelebrationHarness days={[todayKey]} />)
        })

        expect(runIdOf(realEmptyInbox)).toBe(1)
    })

    it('does not hand back a day that was celebrated in an earlier session', () => {
        let firstSession
        act(() => {
            firstSession = renderer.create(<CelebrationHarness days={[todayKey]} />)
        })
        playOutCelebration()
        act(() => firstSession.unmount())

        // A reload: the session map is gone, only the persisted marker survives. A mount that is
        // torn down immediately must not be able to refund a day it never claimed.
        resetEmptyInboxCelebrationSessionMarkers()

        let afterReload
        act(() => {
            afterReload = renderer.create(<CelebrationHarness days={[todayKey]} />)
        })
        expect(runIdOf(afterReload)).toBe(0)
        act(() => afterReload.unmount())

        let laterStill
        act(() => {
            laterStill = renderer.create(<CelebrationHarness days={[todayKey]} />)
        })

        expect(runIdOf(laterStill)).toBe(0)
    })

    // The settle window is what decides "was this seen?", so it can never be shorter than the
    // celebration it is measuring — otherwise a run cut off halfway counts as watched.
    it('keeps the refund window at least as long as the celebration itself', () => {
        expect(CELEBRATION_CLAIM_SETTLE_MS).toBeGreaterThanOrEqual(CELEBRATION_TOTAL_MS)
    })

    it('re-arms on the next day', () => {
        let today
        act(() => {
            today = renderer.create(<CelebrationHarness days={[todayKey]} />)
        })
        expect(runIdOf(today)).toBe(1)

        // The hook reads "today" from the clock, so the next day is simulated by moving the clock,
        // not by moving the data.
        const tomorrow = moment().add(1, 'day')
        const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(tomorrow.valueOf())

        try {
            let nextDay
            act(() => {
                nextDay = renderer.create(<CelebrationHarness days={[todayKey, tomorrow.format('YYYY-MM-DD')]} />)
            })

            expect(runIdOf(nextDay)).toBe(1)
        } finally {
            dateSpy.mockRestore()
        }
    })

    it('keeps separate answers per account on a shared browser', () => {
        let karsten
        act(() => {
            karsten = renderer.create(<CelebrationHarness days={[todayKey]} userId="user-1" />)
        })
        expect(runIdOf(karsten)).toBe(1)

        let colleague
        act(() => {
            colleague = renderer.create(<CelebrationHarness days={[todayKey]} userId="user-2" />)
        })

        expect(runIdOf(colleague)).toBe(1)
    })

    it('does not trigger outside the task-list achievement overview', () => {
        let tree
        act(() => {
            tree = renderer.create(<CelebrationHarness days={[]} enabled={false} />)
        })
        act(() => {
            tree.update(<CelebrationHarness days={[todayKey]} enabled={false} />)
        })

        expect(runIdOf(tree)).toBe(0)
    })

    // The same overview renders in Settings → Profile with `celebrateNewDay` off. If that render
    // consumed the marker, opening your profile would silently spend the celebration the board was
    // about to show you.
    it('does not consume the once-per-day marker when disabled', () => {
        let profileCard
        act(() => {
            profileCard = renderer.create(<CelebrationHarness days={[todayKey]} enabled={false} />)
        })
        expect(runIdOf(profileCard)).toBe(0)

        let board
        act(() => {
            board = renderer.create(<CelebrationHarness days={[todayKey]} enabled />)
        })

        expect(runIdOf(board)).toBe(1)
    })
})
