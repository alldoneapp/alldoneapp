'use strict'

const admin = require('firebase-admin')
const {
    CONNECTION_SERVICE_EMAIL,
    findConnectionsForProject,
    getConnection,
    getConnectionsMapField,
    materializeConnectionsMap,
} = require('../../Integrations/providerConnections')
const { isAuthError } = require('./emailLineErrors')

function resolveEmailConnectionForKey(userData = {}, key = '', providedConnection = null) {
    if (providedConnection?.connectionId) return providedConnection
    if (typeof key === 'string' && key.startsWith('email_')) {
        return getConnection(userData, CONNECTION_SERVICE_EMAIL, key)
    }
    return findConnectionsForProject(userData, CONNECTION_SERVICE_EMAIL, key)[0] || null
}

function buildEmailAuthInvalidUpdate(userData = {}, key = '', providedConnection = null) {
    const connection = resolveEmailConnectionForKey(userData, key, providedConnection)
    if (!connection?.connectionId) return null

    const mapField = getConnectionsMapField(CONNECTION_SERVICE_EMAIL)
    const storedMap = userData[mapField]
    const hasStoredMap = storedMap && typeof storedMap === 'object' && Object.keys(storedMap).length > 0

    if (hasStoredMap) {
        return { [`${mapField}.${connection.connectionId}.authInvalid`]: true }
    }

    // A nested one-field update would create a partial account map and hide any other
    // connections that still exist only in the legacy apisConnected shape. Materialize
    // the complete map before setting the failed account's circuit-breaker flag.
    const materialized = materializeConnectionsMap(CONNECTION_SERVICE_EMAIL, userData)
    if (!materialized[connection.connectionId]) return null
    materialized[connection.connectionId].authInvalid = true
    return { [mapField]: materialized }
}

function isEmailConnectionAuthInvalid(userData = {}, key = '', providedConnection = null) {
    return resolveEmailConnectionForKey(userData, key, providedConnection)?.authInvalid === true
}

async function markEmailConnectionAuthInvalid(
    userId,
    { key, userData = {}, connection = null },
    { firestore = admin.firestore() } = {}
) {
    const update = buildEmailAuthInvalidUpdate(userData, key, connection)
    if (!update) return false
    await firestore.doc(`users/${userId}`).update(update)
    return true
}

async function getEmailLineSummaryResponse({
    userId,
    key,
    userData = {},
    connection = null,
    includeNeedsReply = false,
    getSummary = (...args) => require('./emailLineService').getEmailLineSummary(...args),
    persistAuthInvalid = markEmailConnectionAuthInvalid,
}) {
    // Once the account is known to be invalid, never touch the provider again. Reconnect
    // clears authInvalid and the next summary request resumes normally.
    if (isEmailConnectionAuthInvalid(userData, key, connection)) return { authExpired: true }

    try {
        return await getSummary(userId, key, { userData, includeNeedsReply })
    } catch (error) {
        if (!isAuthError(error)) throw error

        try {
            await persistAuthInvalid(userId, { key, userData, connection })
        } catch (persistError) {
            // The provider result is still a reconnect state, not an HTTP failure. Log the
            // persistence problem so it can be retried/diagnosed independently.
            console.error('[emailLine] Could not persist authInvalid after summary auth failure:', {
                key,
                error: persistError?.message || persistError,
            })
        }
        return { authExpired: true }
    }
}

module.exports = {
    buildEmailAuthInvalidUpdate,
    getEmailLineSummaryResponse,
    isEmailConnectionAuthInvalid,
    markEmailConnectionAuthInvalid,
    resolveEmailConnectionForKey,
}
