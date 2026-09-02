/**
 * AT-2492 — "has this user already been shown celebration X on day D?", as a reusable scope.
 *
 * This is AT-2418's `emptyInboxCelebrationMarker` with its one hardcoded storage key and its one
 * hardcoded scope (the user id) lifted out, and nothing else changed. It exists because a second
 * celebration now needs exactly the same rule with a different scope: the all-projects moment is
 * remembered per USER, and the per-project moment of AT-2492 per USER AND PROJECT. The two must not
 * share a namespace — spending one may never spend the other, which is the whole point of making the
 * smaller celebration a separate thing rather than a second render of the big one.
 *
 * Everything load-bearing is inherited verbatim from AT-2418, and is repeated here because it is the
 * reason this file is shaped the way it is:
 *
 *   • a module-level SESSION map is what actually enforces "once" while the tab is open. It works
 *     when storage is unavailable (Safari private mode throws on access rather than returning null),
 *     and the degraded behaviour without it is the celebration replaying on every mount of the
 *     board — a tab switch away and back would replay it.
 *   • localStorage carries the answer across a reload. Deliberately NOT the user document: this is a
 *     "did I already show you this animation on this device" flag, not user data, and a Firestore
 *     write on the empty-inbox path is exactly the kind of write AT-2340 exists to avoid.
 *
 * Keyed by scope AND day, so a day rollover re-arms it. The map is capped because it is written from
 * a screen a dogfooding user reaches daily; an uncapped map would grow for as long as the browser
 * profile lives. The cap is per-store because the natural key density differs by an order of
 * magnitude between them — one entry per account versus one per account and project.
 */

const safeStorage = () => {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null
    } catch (error) {
        // Safari in private mode throws on access rather than returning null.
        return null
    }
}

/**
 * @param {string} storageKey localStorage key. Must be unique per celebration — two celebrations
 *   sharing one would let the cheaper of them spend the more valuable one.
 * @param {number} maxTrackedScopes Bound on the persisted map.
 */
export default function createDayCelebrationMarker(storageKey, maxTrackedScopes) {
    // Survives storage being unavailable, and is the reason a private-mode window still only sees
    // the celebration once per session rather than on every mount.
    const sessionMarkers = {}

    const readStoredMarkers = () => {
        const storage = safeStorage()
        if (!storage) return {}

        try {
            const parsed = JSON.parse(storage.getItem(storageKey))
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
        } catch (error) {
            // A corrupt entry must not break the screen it is read from; a lost marker only costs
            // one extra replay of a short animation.
            return {}
        }
    }

    const hasCelebratedDay = (scopeKey, dayKey) => {
        if (!scopeKey || !dayKey) return false
        if (sessionMarkers[scopeKey] === dayKey) return true

        return readStoredMarkers()[scopeKey] === dayKey
    }

    const markDayCelebrated = (scopeKey, dayKey) => {
        if (!scopeKey || !dayKey) return

        sessionMarkers[scopeKey] = dayKey

        const storage = safeStorage()
        if (!storage) return

        const markers = readStoredMarkers()
        if (markers[scopeKey] === dayKey) return

        // Re-inserting at the end makes the object's own key order a recency order, so slicing from
        // the end drops the scopes that have not been seen for longest.
        delete markers[scopeKey]
        const bounded = [...Object.entries(markers), [scopeKey, dayKey]].slice(-maxTrackedScopes)

        try {
            storage.setItem(storageKey, JSON.stringify(Object.fromEntries(bounded)))
        } catch (error) {
            // Quota or private mode. The session map above already answered for this tab.
        }
    }

    /**
     * Give the day back when the celebration was claimed but never played (AT-2445).
     *
     * The marker is claimed in a `useLayoutEffect`, i.e. BEFORE the first frame of the animation,
     * which is deliberate (AT-2418: a passive effect would paint the finished end state and then
     * jump it back to the start). The consequence is that a mount torn down before the run finishes
     * has still spent the day.
     *
     * Releasing is only ever safe for a marker THIS session claimed and did not play out. It
     * therefore checks the session map first: a marker restored from a previous session's
     * localStorage means the animation demonstrably ran, and must not be handed back.
     */
    const releaseDayCelebration = (scopeKey, dayKey) => {
        if (!scopeKey || !dayKey) return
        if (sessionMarkers[scopeKey] !== dayKey) return

        delete sessionMarkers[scopeKey]

        const storage = safeStorage()
        if (!storage) return

        const markers = readStoredMarkers()
        if (markers[scopeKey] !== dayKey) return

        delete markers[scopeKey]

        try {
            storage.setItem(storageKey, JSON.stringify(markers))
        } catch (error) {
            // Quota or private mode. The session map above is already released, which is what
            // answers for this tab.
        }
    }

    // Tests only: the session map is module state by design, so it outlives a component tree.
    const resetSessionMarkers = () => {
        Object.keys(sessionMarkers).forEach(key => delete sessionMarkers[key])
    }

    return { hasCelebratedDay, markDayCelebrated, releaseDayCelebration, resetSessionMarkers }
}
