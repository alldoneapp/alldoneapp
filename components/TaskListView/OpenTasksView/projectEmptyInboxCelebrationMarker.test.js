import {
    didProjectReachEmptyInbox,
    getProjectCelebrationScopeKey,
    hasCelebratedProjectEmptyInboxDay,
    hasReachedProjectEmptyInboxDay,
    markProjectEmptyInboxDayCelebrated,
    markProjectEmptyInboxDayReached,
    projectTodayListLooksClear,
    releaseProjectEmptyInboxDayCelebration,
    resetProjectEmptyInboxCelebrationSessionMarkers,
} from './projectEmptyInboxCelebrationMarker'
import {
    hasCelebratedEmptyInboxDay,
    markEmptyInboxDayCelebrated,
    resetEmptyInboxCelebrationSessionMarkers,
} from '../../SettingsView/Profile/Achievements/emptyInboxCelebrationMarker'

/**
 * AT-2492 — the per-project marker pair.
 *
 * Two things are worth pinning here and they are both about ISOLATION rather than about storage
 * mechanics (those are inherited from `dayCelebrationMarker`, whose own suite covers them): the
 * small celebration must not be able to spend the big one, and "did this project reach empty" must
 * not be confused with "did we already celebrate it" — they are two stores precisely because a
 * project reaches empty once and is celebrated once, and reading one for the other would either
 * celebrate nothing or celebrate forever.
 */

const TODAY = '2026-09-02'
const YESTERDAY = '2026-09-01'

describe('projectEmptyInboxCelebrationMarker (AT-2492)', () => {
    beforeEach(() => {
        resetProjectEmptyInboxCelebrationSessionMarkers()
        resetEmptyInboxCelebrationSessionMarkers()
        localStorage.clear()
    })

    describe('scope', () => {
        it('keys on the user AND the project', () => {
            markProjectEmptyInboxDayCelebrated('user-1', 'project-a', TODAY)

            expect(hasCelebratedProjectEmptyInboxDay('user-1', 'project-a', TODAY)).toBe(true)
            // Clearing one project says nothing about another...
            expect(hasCelebratedProjectEmptyInboxDay('user-1', 'project-b', TODAY)).toBe(false)
            // ...nor about the same project for a second account on this browser.
            expect(hasCelebratedProjectEmptyInboxDay('user-2', 'project-a', TODAY)).toBe(false)
            // ...nor about the same project tomorrow.
            expect(hasCelebratedProjectEmptyInboxDay('user-1', 'project-a', YESTERDAY)).toBe(false)
        })

        it('refuses to build a partial scope key', () => {
            expect(getProjectCelebrationScopeKey('user-1', undefined)).toBeNull()
            expect(getProjectCelebrationScopeKey(undefined, 'project-a')).toBeNull()

            markProjectEmptyInboxDayCelebrated('user-1', undefined, TODAY)
            expect(hasCelebratedProjectEmptyInboxDay('user-1', undefined, TODAY)).toBe(false)
        })
    })

    /**
     * The whole reason the per-project celebration got its own localStorage namespace. A user
     * routinely earns both within a second of each other — the last task of the last project — and
     * whichever fired first would otherwise silently consume the other.
     */
    it('cannot spend, or be spent by, the all-projects celebration', () => {
        markEmptyInboxDayCelebrated('user-1', TODAY)

        expect(hasCelebratedProjectEmptyInboxDay('user-1', 'project-a', TODAY)).toBe(false)

        resetProjectEmptyInboxCelebrationSessionMarkers()
        resetEmptyInboxCelebrationSessionMarkers()
        localStorage.clear()

        markProjectEmptyInboxDayCelebrated('user-1', 'project-a', TODAY)
        expect(hasCelebratedEmptyInboxDay('user-1', TODAY)).toBe(false)
    })

    it('keeps "reached" and "celebrated" in separate stores', () => {
        markProjectEmptyInboxDayReached('user-1', 'project-a', TODAY)

        expect(hasReachedProjectEmptyInboxDay('user-1', 'project-a', TODAY)).toBe(true)
        // Reaching empty is the PRECONDITION for celebrating, never the record of it.
        expect(hasCelebratedProjectEmptyInboxDay('user-1', 'project-a', TODAY)).toBe(false)

        markProjectEmptyInboxDayCelebrated('user-1', 'project-a', TODAY)
        // ...and celebrating must not erase the fact that it was reached, or a refunded claim could
        // never be re-earned within the same day.
        expect(hasReachedProjectEmptyInboxDay('user-1', 'project-a', TODAY)).toBe(true)
    })

    it('hands the day back when a claimed celebration never played', () => {
        markProjectEmptyInboxDayCelebrated('user-1', 'project-a', TODAY)
        releaseProjectEmptyInboxDayCelebration('user-1', 'project-a', TODAY)

        expect(hasCelebratedProjectEmptyInboxDay('user-1', 'project-a', TODAY)).toBe(false)
        // Releasing one project cannot release another's.
        markProjectEmptyInboxDayCelebrated('user-1', 'project-b', TODAY)
        releaseProjectEmptyInboxDayCelebration('user-1', 'project-a', TODAY)
        expect(hasCelebratedProjectEmptyInboxDay('user-1', 'project-b', TODAY)).toBe(true)
    })

    describe('didProjectReachEmptyInbox', () => {
        it('is true only for a real count falling to a real zero', () => {
            expect(didProjectReachEmptyInbox(1, 0)).toBe(true)
            expect(didProjectReachEmptyInbox(7, 0)).toBe(true)
        })

        /**
         * The two ways a count becomes absent, and neither is a cleared project.
         * `clearSidebarTasksAmount` wipes the whole map on a user or project-list change, and a
         * project that has had nothing due today since the day began never gets a key for this user
         * at all. Marking either as reached would authorise confetti for work nobody did — the exact
         * noise this record exists to prevent on a 78-project account.
         */
        it('is false when the count merely went away', () => {
            expect(didProjectReachEmptyInbox(3, undefined)).toBe(false)
            expect(didProjectReachEmptyInbox(3, null)).toBe(false)
        })

        it('is false without a prior positive count', () => {
            expect(didProjectReachEmptyInbox(undefined, 0)).toBe(false)
            expect(didProjectReachEmptyInbox(0, 0)).toBe(false)
        })

        it('is false while the project still has tasks', () => {
            expect(didProjectReachEmptyInbox(3, 1)).toBe(false)
        })
    })

    /**
     * Deliberately looser than the transition rule. After a reload the count watchers rebuild and a
     * project with nothing due today gets no key for this user, so it reads `undefined` rather than
     * `0` — and the "I cleared it this morning and came back this afternoon" case, which is the main
     * reason the reached-record is persisted at all, would never celebrate if this were strict.
     */
    describe('projectTodayListLooksClear', () => {
        it('accepts both a real zero and an absent count', () => {
            expect(projectTodayListLooksClear(0)).toBe(true)
            expect(projectTodayListLooksClear(undefined)).toBe(true)
        })

        it('rejects any positive count', () => {
            expect(projectTodayListLooksClear(1)).toBe(false)
        })
    })
})
