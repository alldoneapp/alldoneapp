// These fields are derived and maintained by the Admin SDK projection triggers.
// Firestore rules intentionally reject client creates/updates that include them,
// so cross-project copies must let the destination trigger rebuild them against
// the destination project's membership.
export const SERVER_ACCESS_PROJECTION_FIELDS = [
    'readerIds',
    'roleIdsVisibleTo',
    'followedByVisibleTo',
    'followedReaderIds',
    'backlinkIdsVisibleTo',
]

export const withoutServerAccessProjection = data => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return data

    const sanitized = { ...data }
    SERVER_ACCESS_PROJECTION_FIELDS.forEach(field => delete sanitized[field])
    return sanitized
}

/**
 * Every cross-project destination write must MERGE, never overwrite.
 *
 * Stripping the projection is only half of what the strict rules ask for. A
 * plain `set()` is a create only while the destination id is free; the moment a
 * document already lives there the same call becomes an update that DELETES the
 * five projection fields, and `accessProjectionUnchanged()` rejects it —
 * `permission-denied`, with no hint that the destination was occupied.
 *
 * The destination id is occupied more often than "move" suggests. A calendar
 * task is keyed by its calendar event id, so an earlier instance of the same
 * meeting (routed, moved or completed in that project before) already holds the
 * id — which is exactly why the server-side mover in `assistantHelper.js`
 * refuses that case outright. And any move that failed after the destination
 * write leaves the id occupied for good, so the retry is denied too and the
 * object becomes permanently unmovable.
 *
 * Merging is safe because these payloads are complete object models: every
 * field the mover owns is rewritten, and the destination's own projection
 * survives untouched until its trigger recalculates it against the destination
 * project's membership. `moveInnerFeedsOnMoveObjectFromProject` reached the
 * same conclusion for the moved activity history.
 */
export const CROSS_PROJECT_DESTINATION_WRITE = { merge: true }
