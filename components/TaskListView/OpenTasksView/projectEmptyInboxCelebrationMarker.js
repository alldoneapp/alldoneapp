/**
 * AT-2492 — "has this user already been shown today's *project* empty-inbox celebration for project
 * P?"
 *
 * Same rule and same mechanism as the all-projects marker (`emptyInboxCelebrationMarker`), in its
 * own namespace. Two stores rather than one, deliberately: the small celebration may never spend the
 * big one, and the big one may never suppress the small one. They are answers to different
 * questions — "did you clear this project today" and "did you clear everything today" — and a user
 * routinely earns both within a second of each other, when the last task of the last project falls.
 *
 * Scope is user AND project, so clearing three projects in a day gets three celebrations, and each
 * of them exactly once.
 *
 * The cap is far higher than the all-projects one because the key density is: one entry per account
 * there, one per account and project here. The reporting dogfooding account has 78 projects, so 120
 * leaves room for a user who clears every project they own on the same day and still bounds the map
 * for as long as the browser profile lives. Overflowing it only costs a replay of a ~1.5s
 * animation.
 */

import createDayCelebrationMarker from '../../SettingsView/Profile/Achievements/dayCelebrationMarker'
import { didReachEmptyInbox } from '../../SettingsView/Profile/Achievements/emptyInboxCelebrationMarker'

const CELEBRATION_STORAGE_KEY = 'alldone.projectEmptyInboxDayCelebration'
const REACHED_STORAGE_KEY = 'alldone.projectEmptyInboxDayReached'
const MAX_TRACKED_PROJECT_SCOPES = 120

const marker = createDayCelebrationMarker(CELEBRATION_STORAGE_KEY, MAX_TRACKED_PROJECT_SCOPES)

/**
 * The second store, and the reason this feature is not simply "celebrate whenever the list is
 * empty": a project that has had no task due today since the day began has not been CLEARED, and
 * congratulating it is noise. The dogfooding account has 78 projects, 64 of them guides — most of
 * them are empty most days, and opening one would otherwise throw confetti for work nobody did.
 *
 * This mirrors how the all-projects achievement already works, one layer down. There, the transition
 * is detected by `useReachEmptyInbox` and persisted as an achievement DAY on the user document, and
 * the celebration hook keys off that record rather than off the live count — which is what lets it
 * fire when you open the board hours after clearing your last task. The per-project moment gets the
 * same two-part shape with localStorage in place of Firestore, because AT-2492 is purely visual (no
 * streak, no achievement history) and a Firestore write on the task-completion path is exactly what
 * AT-2340 exists to avoid.
 *
 * The cost of the local store is that the record does not follow the user across devices: clear a
 * project on your phone and open it on your laptop, and the laptop never saw the transition, so it
 * does not celebrate. That is the right way for this to degrade — a missed small flourish, never a
 * celebration for something that did not happen.
 */
const reached = createDayCelebrationMarker(REACHED_STORAGE_KEY, MAX_TRACKED_PROJECT_SCOPES)

/**
 * `null` for an incomplete scope rather than a partial key, so a missing project id can never
 * collide with another project's marker (or, worse, with the bare user id the all-projects store
 * uses — the two live in different localStorage keys, but a half-built key is a bug either way).
 */
export const getProjectCelebrationScopeKey = (userId, projectId) =>
    userId && projectId ? `${userId}|${projectId}` : null

export const hasCelebratedProjectEmptyInboxDay = (userId, projectId, dayKey) =>
    marker.hasCelebratedDay(getProjectCelebrationScopeKey(userId, projectId), dayKey)

export const markProjectEmptyInboxDayCelebrated = (userId, projectId, dayKey) =>
    marker.markDayCelebrated(getProjectCelebrationScopeKey(userId, projectId), dayKey)

export const releaseProjectEmptyInboxDayCelebration = (userId, projectId, dayKey) =>
    marker.releaseDayCelebration(getProjectCelebrationScopeKey(userId, projectId), dayKey)

/**
 * The transition rule, in one place because several callers apply it and they must agree exactly:
 * the board's own hook (which sees the moment when you clear the last task while looking at the
 * project), the app-wide detector (which sees it when you clear it from My Day, All Projects or a
 * chat) and — since AT-2506 — the all-projects celebration, which re-arms on it.
 *
 * AT-2506 moved the rule itself up to `emptyInboxCelebrationMarker.didReachEmptyInbox` so the two
 * scopes cannot drift; this name is kept because every per-project call site reads better with it,
 * and because the reasoning for the strictness (see there) was written about project counts.
 */
export const didProjectReachEmptyInbox = didReachEmptyInbox

/**
 * The celebration gate is deliberately LOOSER than the transition rule above: "not a positive
 * count". After a reload the watchers rebuild and a project with nothing due today gets no key for
 * this user, so its count is `undefined` rather than `0` — and refusing to celebrate on `undefined`
 * would break the main "arrived later" case this whole record exists for. It is safe to be loose
 * here because the reached-record is the real evidence and the empty block being on screen is the
 * second.
 */
export const projectTodayListLooksClear = count => !(count > 0)

/** Did project P's today list go from "has tasks" to "clear" at some point today, on this device? */
export const hasReachedProjectEmptyInboxDay = (userId, projectId, dayKey) =>
    reached.hasCelebratedDay(getProjectCelebrationScopeKey(userId, projectId), dayKey)

export const markProjectEmptyInboxDayReached = (userId, projectId, dayKey) =>
    reached.markDayCelebrated(getProjectCelebrationScopeKey(userId, projectId), dayKey)

// Tests only: the session maps are module state by design, so they outlive a component tree.
export const resetProjectEmptyInboxCelebrationSessionMarkers = () => {
    marker.resetSessionMarkers()
    reached.resetSessionMarkers()
}
