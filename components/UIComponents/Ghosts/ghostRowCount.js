/**
 * AT-2382 — how many ghost rows a "Show more" press should draw.
 *
 * The product rule is "match the batch that was just requested, but never flood the
 * viewport". Both halves matter: matching the batch is what makes the ghost occupy
 * roughly the space the real rows will need, so the arriving data does not shove the
 * page; the cap is what stops an unbounded expansion (the notes list re-subscribes with
 * NO limit, and "earlier done tasks" asks for 15 at a time) from painting a screenful of
 * grey.
 *
 * Deliberately a pure function with no react/redux imports: it is called from class
 * components, hooks and plain render branches alike.
 */

// Above this the ghost stops being an affordance and becomes the content.
export const GHOST_MAX_ROWS = 6
// What to draw when the caller genuinely cannot know the batch size. Three rows is enough
// to read as "a list is coming" rather than "one thing is coming".
export const GHOST_DEFAULT_ROWS = 3

export const resolveGhostRowCount = (requestedBatchSize, options = {}) => {
    const { fallback = GHOST_DEFAULT_ROWS, max = GHOST_MAX_ROWS, min = 1 } = options

    // `Number(null)` is 0 and `Number(undefined)` is NaN — an unknown batch must resolve
    // to the fallback in BOTH cases, so test the value before converting it.
    const parsed = requestedBatchSize == null ? NaN : Number(requestedBatchSize)
    // `Infinity` is a caller saying "this query has no limit" (the notes expansion
    // re-subscribes without one). That is a known-huge batch, not an unknown one, so it
    // belongs at the cap rather than at the smaller fallback.
    const batch = parsed === Infinity ? max : Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback

    return Math.max(min, Math.min(max, batch))
}
