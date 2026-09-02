'use strict'

const {
    CONNECTION_SERVICE_CALENDAR,
    CONNECTION_SERVICE_EMAIL,
    EMAIL_PROVIDER_MICROSOFT,
    getConnection,
} = require('./providerConnections')

/**
 * Does this connection still work?
 *
 * The distinction that makes this worth a callable at all: `getCredentialStatus` only
 * re-reads the stored `authInvalid` flag, and that flag is written only when something
 * actually tried to USE the account. An account nobody has touched since the grant died —
 * labeling disabled, no email line, a calendar with no recent sync — therefore reads as
 * perfectly healthy right up until the next background job happens to run. Settings >
 * Integrations answers the question for real by forcing a token refresh, which is the exact
 * code path that discovers and records a dead grant (AT-2491).
 *
 * Two consequences worth knowing. The check is not read-only by design: verifying is what
 * FLAGS a broken account, so opening the page is what makes the reconnect state appear. And
 * an already-flagged connection is answered from the flag without a network call, because a
 * revoked grant cannot be un-revoked by asking again — only a fresh consent clears it.
 */

const HEALTH_OK = 'connected'
const HEALTH_RECONNECT_REQUIRED = 'reconnect_required'
const HEALTH_UNKNOWN = 'unknown'

function connectionServiceFor(connectionId) {
    return String(connectionId || '').startsWith('calendar_') ? CONNECTION_SERVICE_CALENDAR : CONNECTION_SERVICE_EMAIL
}

function isReconnectRequiredError(error) {
    if (!error) return false
    // Both providers' revoked-grant errors carry this, and `isAuthError` recognises the
    // wider family the email line already maps to a reconnect state.
    if (error.code === 'EMAIL_AUTH_EXPIRED' || error.reconnectRequired === true) return true
    const { isAuthError } = require('../Email/emailLine/emailLineErrors')
    return isAuthError(error)
}

/**
 * @returns {Promise<{connectionId, status, healthy, authInvalid, email, checkedAt}>}
 *   `status` is one of connected | reconnect_required | unknown. `unknown` means we could
 *   not find out (provider down, our own misconfiguration) and must NOT be rendered as a
 *   broken account — telling a user to reconnect a working mailbox because Google was
 *   briefly unreachable is worse than saying nothing.
 */
async function checkConnectionHealth(userId, connectionId, { userData = null } = {}) {
    const connectionService = connectionServiceFor(connectionId)
    const result = {
        connectionId,
        status: HEALTH_UNKNOWN,
        healthy: false,
        authInvalid: false,
        email: null,
        checkedAt: Date.now(),
    }

    const resolvedUserData =
        userData ||
        (await require('firebase-admin')
            .firestore()
            .collection('users')
            .doc(userId)
            .get()
            .then(doc => (doc.exists ? doc.data() || {} : {}))
            .catch(() => ({})))

    const connection = getConnection(resolvedUserData, connectionService, connectionId)
    if (!connection) return result
    result.email = connection.emailAddress || null

    // Already known dead: answer from the flag. Forcing a refresh here would be a guaranteed
    // failed round trip per page open, and both handlers fail fast on it anyway.
    if (connection.authInvalid === true) {
        result.status = HEALTH_RECONNECT_REQUIRED
        result.authInvalid = true
        return result
    }

    const isMicrosoft = connection.provider === EMAIL_PROVIDER_MICROSOFT
    const isCalendar = connectionService === CONNECTION_SERVICE_CALENDAR

    try {
        if (isMicrosoft) {
            const { getAccessToken } = require('../MicrosoftOAuth/microsoftOAuthHandler')
            await getAccessToken(userId, connectionId, isCalendar ? 'calendar' : 'email', { forceRefresh: true })
        } else {
            const { getAccessToken } = require('../GoogleOAuth/googleOAuthHandler')
            await getAccessToken(userId, connectionId, isCalendar ? 'calendar' : 'gmail', { forceRefresh: true })
        }
        result.status = HEALTH_OK
        result.healthy = true
        return result
    } catch (error) {
        if (isReconnectRequiredError(error)) {
            // The refresh attempt has already recorded the flag on the user document, so the
            // client's live listener updates the card without needing this answer.
            result.status = HEALTH_RECONNECT_REQUIRED
            result.authInvalid = true
            return result
        }
        console.warn(`[connectionHealth] Could not verify ${connectionId} for ${userId}: ${error?.message || error}`)
        return result
    }
}

module.exports = {
    checkConnectionHealth,
    HEALTH_OK,
    HEALTH_RECONNECT_REQUIRED,
    HEALTH_UNKNOWN,
    __private__: { connectionServiceFor, isReconnectRequiredError },
}
