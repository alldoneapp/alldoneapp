import React from 'react'
import renderer, { act } from 'react-test-renderer'
import moment from 'moment'
import { Text } from 'react-native'

import useTodayEmptyInboxCelebration from './useTodayEmptyInboxCelebration'
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
    })

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
        act(() => firstVisit.unmount())

        // Tab away and back: the board remounts and must not replay.
        let secondVisit
        act(() => {
            secondVisit = renderer.create(<CelebrationHarness days={[todayKey]} />)
        })

        expect(runIdOf(secondVisit)).toBe(0)
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
