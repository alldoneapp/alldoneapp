import { isEqual } from 'lodash'

const isEmptyList = value => Array.isArray(value) && value.length === 0

// A field the document has never had and an empty list mean the same thing, also inside the
// per-part maps of a note (linkedParentsInTitleIds / linkedParentsInContentIds). Without this a
// newly introduced backlink field (linkedParentArtifactsIds) would rewrite every object once.
export const sameBacklinks = (stored, next) => {
    if (isEqual(stored, next)) return true
    if (stored === undefined) return isEmptyList(next)
    if (!stored || !next || typeof stored !== 'object' || typeof next !== 'object') return false
    if (Array.isArray(stored) || Array.isArray(next)) return false
    const keys = new Set([...Object.keys(stored), ...Object.keys(next)])
    return [...keys].every(
        key => sameBacklinks(stored[key], next[key]) || (next[key] === undefined && isEmptyList(stored[key]))
    )
}

/**
 * Write recomputed backlink fields only when they actually differ (AT-2340).
 *
 * `setLinkedParentObjects` runs on every note autosave (through
 * `scanLinkedObjects`) and used to `update()` unconditionally. The autosave
 * already writes the note document once (preview + edition data), so a note
 * whose links had not changed — the overwhelmingly common case, i.e. typing
 * prose — produced TWO document versions per save, and therefore two
 * `onUpdateNote` invocations, two full note-content downloads from Firebase
 * Storage and two search re-indexes, server-side, for every save.
 *
 * The comparison is made against the LOCAL CACHE (`source: 'cache'`): the object
 * is being watched by a live listener while this runs, so the cached copy is
 * current; a cache read costs no network round trip, no billed read, and works
 * offline. Every uncertain case — no cached copy, a read error, a document that
 * does not exist — falls through to writing, because a redundant write is cheap
 * and visible while a skipped necessary write silently loses backlinks.
 *
 * `force` skips the comparison entirely and writes at once. It exists for the
 * `beforeunload` / editor-teardown path: the cache read is asynchronous, and a
 * page being torn down may never run its continuation, so a write deferred
 * behind it could simply be dropped. A redundant write there is the safe
 * trade — it is one write, once, when a note is closed.
 *
 * @param {object} ref Firestore DocumentReference for the object being updated
 * @param {object} updateObject the recomputed backlink fields
 * @param {{force?: boolean}} options
 * @returns {Promise<boolean>} whether a write was issued (for tests/telemetry)
 */
export const writeLinkedParentsIfChanged = async (ref, updateObject, { force = false } = {}) => {
    const write = async () => {
        try {
            await ref.update(updateObject)
        } catch (error) {
            console.warn('Backlink update failed', error)
        }
        return true
    }

    if (force) return write()

    let current = null
    try {
        const snapshot = await ref.get({ source: 'cache' })
        current = snapshot && snapshot.exists ? snapshot.data() : null
    } catch (error) {
        // Not in the cache (or the cache is unavailable): we cannot prove the
        // write is redundant, so make it.
        return write()
    }

    if (!current) return write()

    const unchanged = Object.keys(updateObject).every(key => sameBacklinks(current[key], updateObject[key]))
    if (unchanged) return false

    return write()
}
