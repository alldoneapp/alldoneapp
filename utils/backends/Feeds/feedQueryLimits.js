/**
 * Query limits for the global "Updates" feed listeners (`feedsStore/{projectId}/...`).
 *
 * The Updates page mounts one `GlobalProject` per project, and each of those opens two
 * `feedsStore` listeners (the "followed" and the "all" tab). Those listeners used to be hard-coded
 * to `limit(200)` while the list underneath them can only ever display
 * `ALL_PROJECTS_FEEDS_AMOUNT_TO_DISPLAY` (5) / `STANDARD_FEEDS_AMOUNT_TO_DISPLAY` (20) feeds at
 * first paint, and `MAX_FEEDS_AMOUNT_TO_DISPLAY` (99) after "show more". For a large dogfooding
 * account that is tens of thousands of documents downloaded to render a few hundred rows.
 *
 * `getFeedsQueryLimit` turns that fixed 200 into the number of documents the list can actually
 * consume. See the comment on `needsClientSideFilter` for why the old head-room is still kept for
 * the "viewing another user's feed" case.
 */

// The most feeds a single project's list can ever display: the "show more" ceiling, and the point
// at which `watchNewFeedsTabRedux` truncates the snapshot anyway.
export const MAX_NUMBER_OF_FEEDS_TO_SHOW = 99

// The legacy fixed limit. Still used when the snapshot has to be narrowed client side, because
// then an unknown number of the fetched documents get dropped before they reach the list.
export const MAX_NUMBER_OF_FEEDS_TO_REVIEW = 200

/**
 * @param visibleAmount        how many feeds the list can currently display for this project.
 * @param needsClientSideFilter whether the snapshot is narrowed again in JS after it arrives.
 *                              When it is not, the query result *is* the list input, so fetching
 *                              more than `visibleAmount` documents can never change what is
 *                              rendered - the extra documents are sliced off untouched.
 */
export const getFeedsQueryLimit = (visibleAmount, needsClientSideFilter) => {
    if (needsClientSideFilter) return MAX_NUMBER_OF_FEEDS_TO_REVIEW

    const requested = Number.isFinite(visibleAmount) ? Math.ceil(visibleAmount) : MAX_NUMBER_OF_FEEDS_TO_SHOW

    // Firestore rejects `limit(0)` / negative limits, and a caller asking for nothing still needs a
    // live listener so the list leaves its loading state.
    if (requested < 1) return 1

    return Math.min(requested, MAX_NUMBER_OF_FEEDS_TO_SHOW)
}
