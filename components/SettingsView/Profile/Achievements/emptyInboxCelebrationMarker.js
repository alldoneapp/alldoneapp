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

// Tests only: the session map is module state by design, so it outlives a component tree.
export const resetEmptyInboxCelebrationSessionMarkers = () => marker.resetSessionMarkers()
