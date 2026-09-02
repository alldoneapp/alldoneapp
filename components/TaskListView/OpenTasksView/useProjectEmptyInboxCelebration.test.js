import React from 'react'
import renderer, { act } from 'react-test-renderer'
import moment from 'moment'
import { Text } from 'react-native'
import { useSelector } from 'react-redux'

import useProjectEmptyInboxCelebration, { PROJECT_CELEBRATION_CLAIM_SETTLE_MS } from './useProjectEmptyInboxCelebration'
import { PROJECT_CONGRATS_TOTAL_MS } from './projectEmptyInboxCongratsMotion'
import {
    hasCelebratedProjectEmptyInboxDay,
    hasReachedProjectEmptyInboxDay,
    markProjectEmptyInboxDayReached,
    resetProjectEmptyInboxCelebrationSessionMarkers,
} from './projectEmptyInboxCelebrationMarker'

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))

/**
 * AT-2492 — the decision: may clearing THIS project's today list be celebrated, and has it been
 * already?
 *
 * The hook is deliberately mounted in today's `OpenTasksByDate` section rather than in the empty
 * block, because the block only exists once the list is already clear. Everything below is really
 * one question asked from both ends: the celebration must fire for a project the user actually
 * cleared, and must never fire for one that simply had nothing in it.
 */

const PINNED_NOW = new Date('2026-09-02T10:00:00Z')
const todayKey = moment(PINNED_NOW).format('YYYY-MM-DD')

const USER = 'user-1'
const PROJECT = 'project-a'

function Harness({ projectId = PROJECT, userId = USER, enabled = true }) {
    const runId = useProjectEmptyInboxCelebration(projectId, userId, enabled)
    return <Text>{runId}</Text>
}

const runIdOf = tree => tree.root.findByType(Text).props.children

describe('useProjectEmptyInboxCelebration (AT-2492)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        resetProjectEmptyInboxCelebrationSessionMarkers()
        localStorage.clear()
        jest.useFakeTimers()
        jest.setSystemTime(PINNED_NOW)
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    // One project's today count, as `sidebarNumbers` carries it.
    const withCount = count =>
        useSelector.mockImplementation(selector =>
            selector({ sidebarNumbers: count === undefined ? {} : { [PROJECT]: { [USER]: count } } })
        )

    const render = (props = {}) => {
        let tree
        act(() => {
            tree = renderer.create(<Harness {...props} />)
        })
        return tree
    }

    const update = (tree, props = {}) =>
        act(() => {
            tree.update(<Harness {...props} />)
        })

    // The run is played out, i.e. the user actually saw it and the day is spent for real.
    const playOut = () => act(() => jest.advanceTimersByTime(PROJECT_CELEBRATION_CLAIM_SETTLE_MS))

    describe('the moment it is earned', () => {
        it('celebrates when the last task of the project is cleared while the board is open', () => {
            withCount(2)
            const tree = render()
            expect(runIdOf(tree)).toBe(0)

            withCount(0)
            update(tree)

            expect(runIdOf(tree)).toBe(1)
            expect(hasReachedProjectEmptyInboxDay(USER, PROJECT, todayKey)).toBe(true)
        })

        /**
         * The hook cannot lean on the app-wide detector for this case. Effects run child-before-
         * parent, so on the very tick the count reaches zero the detector mounted above has NOT yet
         * written its record — if this hook only read that record, the live case would silently
         * never fire and only the "come back later" case would work.
         */
        it('detects the transition itself rather than waiting for the app-wide detector', () => {
            withCount(1)
            const tree = render()

            withCount(0)
            update(tree)

            expect(runIdOf(tree)).toBe(1)
        })
    })

    describe('the moment it is discovered later', () => {
        /**
         * You cleared the project from My Day or the All Projects board and only open it later. The
         * detector recorded the transition when it happened; this hook mounts with the list already
         * empty and no transition of its own to see.
         */
        it('celebrates on first sight of a project that was cleared elsewhere', () => {
            markProjectEmptyInboxDayReached(USER, PROJECT, todayKey)
            withCount(0)

            expect(runIdOf(render())).toBe(1)
        })

        /**
         * After a reload the count watchers rebuild, and a project with nothing due today gets no
         * key for this user at all — so its count is `undefined`, not `0`. This is the ordinary
         * shape of the "cleared this morning, opened this afternoon" case.
         */
        it('celebrates when the count is absent rather than zero', () => {
            markProjectEmptyInboxDayReached(USER, PROJECT, todayKey)
            withCount(undefined)

            expect(runIdOf(render())).toBe(1)
        })
    })

    describe('what it refuses to celebrate', () => {
        /**
         * THE case this feature would otherwise get wrong. The reporting account has 78 projects, 64
         * of them guides, and most are empty on most days. Without the reached-record, opening any
         * one of them would throw confetti for work nobody did.
         */
        it('stays quiet for a project that simply never had a task today', () => {
            withCount(0)
            const tree = render()

            expect(runIdOf(tree)).toBe(0)
            expect(hasCelebratedProjectEmptyInboxDay(USER, PROJECT, todayKey)).toBe(false)
        })

        it('stays quiet while the project still has tasks, even once it was cleared earlier', () => {
            markProjectEmptyInboxDayReached(USER, PROJECT, todayKey)
            withCount(3)

            expect(runIdOf(render())).toBe(0)
        })

        /**
         * `enabled` is false on every surface that may not spend the day — a non-today date section,
         * the All Projects board, an assistant's board, an active task filter, and the whole loading
         * window before the empty block is on screen.
         */
        it('does not spend the day on a surface that may not celebrate', () => {
            withCount(2)
            const tree = render({ enabled: false })

            withCount(0)
            update(tree, { enabled: false })

            expect(runIdOf(tree)).toBe(0)
            expect(hasCelebratedProjectEmptyInboxDay(USER, PROJECT, todayKey)).toBe(false)
            // ...but the moment still HAPPENED, so it is recorded and the board can celebrate it
            // when it is next allowed to.
            expect(hasReachedProjectEmptyInboxDay(USER, PROJECT, todayKey)).toBe(true)
        })

        it('celebrates a cleared project exactly once, across mounts', () => {
            markProjectEmptyInboxDayReached(USER, PROJECT, todayKey)
            withCount(0)

            const first = render()
            expect(runIdOf(first)).toBe(1)
            playOut()
            act(() => first.unmount())

            expect(runIdOf(render())).toBe(0)
        })

        it('does not re-fire on unrelated re-renders during the same run', () => {
            markProjectEmptyInboxDayReached(USER, PROJECT, todayKey)
            withCount(0)

            const tree = render()
            update(tree)
            update(tree)

            expect(runIdOf(tree)).toBe(1)
        })
    })

    /**
     * AT-2445's refund, one level down: the marker is claimed before the first frame, so a mount
     * torn down mid-run has spent a day it never showed. Losing a small flourish is cheap; silently
     * never showing it again that day is the bug.
     */
    it('hands the day back when the run is torn down before it played', () => {
        markProjectEmptyInboxDayReached(USER, PROJECT, todayKey)
        withCount(0)

        const first = render()
        expect(runIdOf(first)).toBe(1)
        act(() => first.unmount())

        expect(hasCelebratedProjectEmptyInboxDay(USER, PROJECT, todayKey)).toBe(false)
        expect(runIdOf(render())).toBe(1)
    })

    /**
     * The refund window is a local constant so this hook stays ignorant of the animation, which is
     * exactly why the relationship needs pinning from here: a settle shorter than the run would
     * count a celebration the user only half saw as spent.
     */
    it('keeps the refund window longer than the celebration it protects', () => {
        expect(PROJECT_CELEBRATION_CLAIM_SETTLE_MS).toBeGreaterThan(PROJECT_CONGRATS_TOTAL_MS)
    })
})
