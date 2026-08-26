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
 * TWO layers, and both are load-bearing:
 *
 *   • a module-level session map, which is what actually enforces "once" while the tab is open. It
 *     works even when storage is unavailable (Safari private mode throws on access rather than
 *     returning null), which matters because the degraded behaviour without it is the celebration
 *     replaying on every single mount of the board — a tab switch away and back would replay it.
 *   • localStorage, which carries the answer across a reload. Deliberately NOT the user document:
 *     this is a "did I already show you this animation on this device" flag, not user data, and a
 *     Firestore write on the empty-inbox path is exactly the kind of write AT-2340 exists to avoid.
 *
 * Keyed by user AND day, so a day rollover re-arms it and a second account on the same browser gets
 * its own answer. The map is capped because it is written from a screen a dogfooding user reaches
 * daily; an uncapped map keyed by user id would grow for as long as the browser profile lives.
 */

const STORAGE_KEY = 'alldone.emptyInboxDayCelebration'
const MAX_TRACKED_USERS = 8

// Survives storage being unavailable, and is the reason a private-mode window still only sees the
// celebration once per session rather than on every mount.
const sessionMarkers = {}

const safeStorage = () => {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null
    } catch (error) {
        // Safari in private mode throws on access rather than returning null.
        return null
    }
}

const readStoredMarkers = () => {
    const storage = safeStorage()
    if (!storage) return {}

    try {
        const parsed = JSON.parse(storage.getItem(STORAGE_KEY))
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch (error) {
        // A corrupt entry must not break the screen it is read from; a lost marker only costs one
        // extra replay of a 760ms animation.
        return {}
    }
}

export const hasCelebratedEmptyInboxDay = (userId, dayKey) => {
    if (!userId || !dayKey) return false
    if (sessionMarkers[userId] === dayKey) return true

    return readStoredMarkers()[userId] === dayKey
}

export const markEmptyInboxDayCelebrated = (userId, dayKey) => {
    if (!userId || !dayKey) return

    sessionMarkers[userId] = dayKey

    const storage = safeStorage()
    if (!storage) return

    const markers = readStoredMarkers()
    if (markers[userId] === dayKey) return

    // Re-inserting at the end makes the object's own key order a recency order, so slicing from the
    // end drops the accounts that have not been seen for longest.
    delete markers[userId]
    const bounded = [...Object.entries(markers), [userId, dayKey]].slice(-MAX_TRACKED_USERS)

    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(bounded)))
    } catch (error) {
        // Quota or private mode. The session map above already answered for this tab.
    }
}

/**
 * AT-2445 — give the day back when the celebration was claimed but never played.
 *
 * The marker is claimed in a `useLayoutEffect`, i.e. BEFORE the first frame of the animation, which
 * is deliberate (AT-2418: a passive effect would paint the finished green dot and then jump it back
 * to scale 0). The consequence is that a mount which is torn down again before the run finishes has
 * still spent the day. That used to happen on every visit to the all-projects board, because the
 * board rendered its empty-inbox block throughout the loading window; the board no longer does that,
 * and this is the second line of defence for every other way a mount can be cut short — a route
 * change, a tab switch, the last task being un-completed.
 *
 * Releasing is only ever safe for a marker this session claimed and did not play out. It therefore
 * checks the session map first: a marker restored from a previous session's localStorage means the
 * animation demonstrably ran, and must not be handed back.
 */
export const releaseEmptyInboxDayCelebration = (userId, dayKey) => {
    if (!userId || !dayKey) return
    if (sessionMarkers[userId] !== dayKey) return

    delete sessionMarkers[userId]

    const storage = safeStorage()
    if (!storage) return

    const markers = readStoredMarkers()
    if (markers[userId] !== dayKey) return

    delete markers[userId]

    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(markers))
    } catch (error) {
        // Quota or private mode. The session map above is already released, which is what answers
        // for this tab.
    }
}

// Tests only: the session map is module state by design, so it outlives a component tree.
export const resetEmptyInboxCelebrationSessionMarkers = () => {
    Object.keys(sessionMarkers).forEach(key => delete sessionMarkers[key])
}
