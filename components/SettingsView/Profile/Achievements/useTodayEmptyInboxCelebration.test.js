import React from 'react'
import renderer, { act } from 'react-test-renderer'
import moment from 'moment'
import { AccessibilityInfo, Text } from 'react-native'

import useTodayEmptyInboxCelebration, { CELEBRATION_CLAIM_SETTLE_MS } from './useTodayEmptyInboxCelebration'
import { CELEBRATION_TOTAL_MS } from './emptyInboxDotMotion'
import { resetEmptyInboxCelebrationSessionMarkers } from './emptyInboxCelebrationMarker'

function CelebrationHarness({ days, enabled = true, userId = 'user-1', amount }) {
    const runId = useTodayEmptyInboxCelebration(days, enabled, userId, amount)
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

    /**
     * AT-2506 — "when empty inbox for today is reached we should ALWAYS play the animation".
     *
     * Once per day was the wrong unit. Reaching inbox zero is an event, and it happens repeatedly
     * for anyone who works their inbox: clear it, new tasks land, clear it again. The cases below
     * are the two halves of the new rule and they pull in opposite directions on purpose — a
     * clearing must always animate, an arrival must never replay — so each is written so that it
     * fails if the other one is implemented alone.
     */
    describe('always plays when the inbox is reached again (AT-2506)', () => {
        it('celebrates every clearing, not only the first of the day', () => {
            let tree
            act(() => {
                tree = renderer.create(<CelebrationHarness days={[todayKey]} amount={3} />)
            })
            // A board that still has tasks celebrates nothing, even on a day already earned.
            expect(runIdOf(tree)).toBe(0)

            act(() => tree.update(<CelebrationHarness days={[todayKey]} amount={0} />))
            expect(runIdOf(tree)).toBe(1)
            playOutCelebration()

            // New tasks arrive and are cleared again. Before AT-2506 the marker swallowed this and
            // every clearing for the rest of the day.
            act(() => tree.update(<CelebrationHarness days={[todayKey]} amount={2} />))
            act(() => tree.update(<CelebrationHarness days={[todayKey]} amount={0} />))
            expect(runIdOf(tree)).toBe(2)
            playOutCelebration()

            act(() => tree.update(<CelebrationHarness days={[todayKey]} amount={1} />))
            act(() => tree.update(<CelebrationHarness days={[todayKey]} amount={0} />))
            expect(runIdOf(tree)).toBe(3)
        })

        // The other half of the rule. A clearing is an event; landing on a board that was already
        // empty is not one, so a reload, a tab switch or a hop between My Day and All Projects must
        // still be silent.
        it('does not replay for a board that was already empty when it mounted', () => {
            let firstVisit
            act(() => {
                firstVisit = renderer.create(<CelebrationHarness days={[todayKey]} amount={4} />)
            })
            act(() => firstVisit.update(<CelebrationHarness days={[todayKey]} amount={0} />))
            expect(runIdOf(firstVisit)).toBe(1)
            playOutCelebration()
            act(() => firstVisit.unmount())

            let secondVisit
            act(() => {
                secondVisit = renderer.create(<CelebrationHarness days={[todayKey]} amount={0} />)
            })

            expect(runIdOf(secondVisit)).toBe(0)
        })

        // `didReachEmptyInbox` refuses an absent previous count, which is what every watcher starts
        // at and what `unwatchOpenTasksAmount` writes while the listeners are rebuilt. Without that,
        // mounting on an empty board would look identical to clearing it.
        it('does not read an unknown or unwatched count as a clearing', () => {
            let tree
            act(() => {
                tree = renderer.create(<CelebrationHarness days={[todayKey]} amount={undefined} />)
            })
            act(() => tree.update(<CelebrationHarness days={[todayKey]} amount={0} />))
            expect(runIdOf(tree)).toBe(1)
            playOutCelebration()

            // A Later/Someday toggle rebuilds the watchers: the amount goes to `null` and back to
            // zero without a single task having been completed.
            act(() => tree.update(<CelebrationHarness days={[todayKey]} amount={null} />))
            act(() => tree.update(<CelebrationHarness days={[todayKey]} amount={0} />))

            expect(runIdOf(tree)).toBe(1)
        })

        // The transition still has to be a real inbox-zero moment: a surface that may not celebrate
        // keeps its count history, but neither animates nor spends the day.
        it('records the count history of a disabled surface without celebrating on it', () => {
            let tree
            act(() => {
                tree = renderer.create(<CelebrationHarness days={[todayKey]} enabled={false} amount={2} />)
            })
            act(() => tree.update(<CelebrationHarness days={[todayKey]} enabled={false} amount={0} />))
            expect(runIdOf(tree)).toBe(0)

            // The day is still owed, and the board that IS allowed to celebrate gets it.
            let board
            act(() => {
                board = renderer.create(<CelebrationHarness days={[todayKey]} amount={0} />)
            })
            expect(runIdOf(board)).toBe(1)
        })

        // A clearing before the achievement day has been written (the Firestore round trip) is not
        // celebrated on its own — the day is the evidence that inbox zero was genuinely reached.
        it('waits for the achievement day even when it watched the clearing', () => {
            let tree
            act(() => {
                tree = renderer.create(<CelebrationHarness days={[]} amount={1} />)
            })
            act(() => tree.update(<CelebrationHarness days={[]} amount={0} />))
            expect(runIdOf(tree)).toBe(0)

            act(() => tree.update(<CelebrationHarness days={[todayKey]} amount={0} />))
            expect(runIdOf(tree)).toBe(1)
        })
    })

    /**
     * AT-2506 — the day may only be claimed for a run that can be SEEN.
     *
     * This hook had no reduced-motion check while every motion it starts stands down under one, so
     * a reduced-motion user spent the day on nothing and the marker suppressed every later view of
     * it. The per-project sweep has always guarded this; this was the outlier.
     */
    describe('never spends a day on a run nobody can see (AT-2506)', () => {
        const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
        const originalMatchMedia = window.matchMedia

        afterEach(() => {
            AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
            window.matchMedia = originalMatchMedia
        })

        const withReducedMotion = () => {
            window.matchMedia = jest.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
        }

        it('celebrates nothing and keeps the day owed under reduced motion', () => {
            withReducedMotion()

            let reduced
            act(() => {
                reduced = renderer.create(<CelebrationHarness days={[todayKey]} />)
            })
            expect(runIdOf(reduced)).toBe(0)
            playOutCelebration()
            act(() => reduced.unmount())

            // Same browser profile, motion allowed again (the preference was turned off, or the
            // user opened a window where `matchMedia` can actually answer). The day is still owed.
            window.matchMedia = originalMatchMedia

            let motionAllowed
            act(() => {
                motionAllowed = renderer.create(<CelebrationHarness days={[todayKey]} />)
            })
            expect(runIdOf(motionAllowed)).toBe(1)
        })

        /**
         * The nastier variant, and the reason `reducedMotion` is a dependency of the effect rather
         * than a render-time short circuit: react-native-web answers `isReduceMotionEnabled()` from
         * a PROMISE and resolves it to TRUE whenever `window.matchMedia` is missing. So an
         * environment that merely cannot answer the question flips the preference a microtask after
         * the claim was already made, and the day has to be handed back.
         */
        it('hands the day back when the preference only resolves after the claim', async () => {
            AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))

            let tree
            await act(async () => {
                tree = renderer.create(<CelebrationHarness days={[todayKey]} />)
            })
            act(() => tree.unmount())

            AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled

            let later
            act(() => {
                later = renderer.create(<CelebrationHarness days={[todayKey]} />)
            })
            expect(runIdOf(later)).toBe(1)
        })
    })
})
