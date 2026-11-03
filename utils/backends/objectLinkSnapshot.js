export const shouldProcessObjectLinkSnapshot = (objectData, metadata) => {
    return objectData != null || metadata?.fromCache !== true
}

// Backoff for re-opening a link chip's listener after it FAILED (AT-2950). A failed listener is
// final in the SDK, and a `permission-denied` can be a transient rules-evaluation error
// (AT-2484), so a chip retries a few times before settling on its fallback text. Returns null
// once the attempts are spent, so a genuine denial costs three extra reads and no more.
export const OBJECT_LINK_RETRY_DELAYS_MS = [2000, 10000, 30000]

export const getObjectLinkRetryDelay = failedAttempts => {
    return Number.isInteger(failedAttempts) &&
        failedAttempts >= 0 &&
        failedAttempts < OBJECT_LINK_RETRY_DELAYS_MS.length
        ? OBJECT_LINK_RETRY_DELAYS_MS[failedAttempts]
        : null
}
