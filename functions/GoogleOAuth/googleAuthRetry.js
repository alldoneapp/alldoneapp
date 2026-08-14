'use strict'

// Dependency-free so any Google API caller can require it without pulling in
// firebase-admin/googleapis (and so it is testable as real code, not as a mock).

/**
 * A 401 from a Google *API* (Gmail, Calendar): the access token was rejected. This is
 * recoverable — force-refresh the token and retry.
 *
 * Errors flagged `reconnectRequired` are deliberately excluded: they mean the refresh token
 * itself is dead, so retrying can only burn quota and risk a loop.
 */
function isExpiredAccessTokenError(error) {
    if (!error || error.reconnectRequired) return false
    const status = Number(error.status ?? error.response?.status ?? error.code)
    return status === 401
}

/**
 * Runs a Google API call and, if it fails purely because the access token was rejected,
 * force-refreshes and retries EXACTLY once.
 *
 * @param {(forceRefresh: boolean) => Promise<any>} buildClient - returns the API client;
 *   called a second time with `true` for the retry.
 * @param {(client: any) => Promise<any>} run - the operation. It can execute twice, so it
 *   must be idempotent or read-only.
 *
 * There is no loop: at most one retry. If the forced refresh fails because the refresh token
 * is revoked, `buildClient` throws a typed reconnect error which propagates unchanged.
 */
async function runWithGoogleAuthRetry(buildClient, run) {
    const client = await buildClient(false)
    try {
        return await run(client)
    } catch (error) {
        if (!isExpiredAccessTokenError(error)) throw error
        console.warn('[oauth] Google API rejected the access token (401). Refreshing and retrying once.')
        const refreshedClient = await buildClient(true)
        return await run(refreshedClient)
    }
}

module.exports = {
    isExpiredAccessTokenError,
    runWithGoogleAuthRetry,
}
