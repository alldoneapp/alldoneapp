/**
 * AT-2418 — "has this user already been shown today's empty-inbox celebration?"
 *
 * The celebration has to fire on the moment it is EARNED (you clear the last task while looking at
 * the board) and also the first time you OPEN the empty-inbox screen that day (you cleared the last
 * task from My Day, or from your phone, and only get to the board later). Those are the same event
 * seen from two places, so the "once" has to be remembered somewhere outside the component — the
 * previous implementation compared the achievement flag against its own previous render, which is
 * why it only ever fired for whoever happened to be watching the right screen at the right
 * millisecond and never again.
 *
 * The mechanism — a module-level session map plus localStorage, keyed by scope and day — moved to
 * `dayCelebrationMarker` in AT-2492, unchanged, so the per-project celebration could reuse it with
 * its own namespace. Its header carries the full rationale. This file remains the single home of
 * the ALL-PROJECTS scope: the storage key, the "one entry per account" cap, and the fact that the
 * scope key is the bare user id, so a second account on the same browser gets its own answer.
 *
 * The two stores must stay separate. They answer different questions, and a shared namespace would
 * let clearing one project spend the celebration that clearing every project was going to show.
 */

import createDayCelebrationMarker from './dayCelebrationMarker'

const STORAGE_KEY = 'alldone.emptyInboxDayCelebration'
const MAX_TRACKED_USERS = 8

const marker = createDayCelebrationMarker(STORAGE_KEY, MAX_TRACKED_USERS)

export const hasCelebratedEmptyInboxDay = (userId, dayKey) => marker.hasCelebratedDay(userId, dayKey)

export const markEmptyInboxDayCelebrated = (userId, dayKey) => marker.markDayCelebrated(userId, dayKey)

export const releaseEmptyInboxDayCelebration = (userId, dayKey) => marker.releaseDayCelebration(userId, dayKey)

/**
 * AT-2506 — "did the inbox just go from having tasks to having none?", the one rule every
 * empty-inbox transition detector in the app applies.
 *
 * It lives here, in the all-projects marker, because AT-2506 gives it a second job. It used to be
 * only the per-project rule (`didProjectReachEmptyInbox`, which now delegates to it) deciding
 * whether to WRITE a reached-record; it is now also what re-arms a celebration that has already
 * been spent today, in both scopes. Two copies of a rule that decides whether an animation plays is
 * exactly how the two scopes would drift apart.
 *
 * Deliberately STRICT, and both halves matter:
 *
 *   • the previous count must be a real number greater than zero. An `undefined` previous count is
 *     an absent answer, not a full inbox — every list watcher in this app starts there, and
 *     `clearSidebarTasksAmount` / `unwatchOpenTasksAmount` put it back there on teardown and on
 *     every watcher rebuild. Treating that as "had tasks" would celebrate on every mount.
 *   • the new count must be exactly `0`. `null` is what `unwatchOpenTasksAmount` writes while the
 *     listeners are rebuilt, and it means "not counted", so it can never mean "cleared".
 *
 * The direction of the error is deliberate: a missed transition costs a repeat celebration and
 * falls back to the once-per-day marker, while a false one congratulates work nobody did.
 */
export const didReachEmptyInbox = (previousCount, nextCount) =>
    Number.isFinite(previousCount) && previousCount > 0 && nextCount === 0

// Tests only: the session map is module state by design, so it outlives a component tree.
export const resetEmptyInboxCelebrationSessionMarkers = () => marker.resetSessionMarkers()
