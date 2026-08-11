'use strict'

const EMAIL_PROVIDER_GOOGLE = 'google'
const EMAIL_PROVIDER_MICROSOFT = 'microsoft'
const CALENDAR_PROVIDER_GOOGLE = 'google'
const CALENDAR_PROVIDER_MICROSOFT = 'microsoft'

function normalizeProvider(value, fallback = '') {
    const provider = typeof value === 'string' ? value.trim().toLowerCase() : ''
    if (provider === EMAIL_PROVIDER_GOOGLE || provider === EMAIL_PROVIDER_MICROSOFT) return provider
    return fallback
}

function normalizeEmailAddress(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function resolveEmailConnection(connection = {}) {
    if (connection.email) {
        const provider = normalizeProvider(
            connection.emailProvider,
            connection.gmail || connection.gmailEmail ? EMAIL_PROVIDER_GOOGLE : ''
        )
        return {
            connected: true,
            provider,
            emailAddress:
                normalizeEmailAddress(connection.emailAddress) ||
                normalizeEmailAddress(connection.gmailEmail) ||
                normalizeEmailAddress(connection.email),
            isDefault: connection.emailDefault === true || connection.gmailDefault === true,
        }
    }

    if (connection.gmail) {
        return {
            connected: true,
            provider: EMAIL_PROVIDER_GOOGLE,
            emailAddress: normalizeEmailAddress(connection.gmailEmail),
            isDefault: connection.gmailDefault === true,
        }
    }

    return {
        connected: false,
        provider: '',
        emailAddress: '',
        isDefault: false,
    }
}

function resolveCalendarConnection(connection = {}) {
    if (!connection.calendar) {
        return {
            connected: false,
            provider: '',
            emailAddress: '',
            isDefault: false,
        }
    }

    return {
        connected: true,
        provider: normalizeProvider(connection.calendarProvider, CALENDAR_PROVIDER_GOOGLE),
        emailAddress: normalizeEmailAddress(connection.calendarEmail),
        isDefault: connection.calendarDefault === true,
    }
}

function buildEmailConnectionUpdate(projectId, provider, emailAddress, isDefault = false) {
    const normalizedProvider = normalizeProvider(provider)
    const normalizedEmail = normalizeEmailAddress(emailAddress)
    const updateData = {
        [`apisConnected.${projectId}.email`]: true,
        [`apisConnected.${projectId}.emailProvider`]: normalizedProvider,
        [`apisConnected.${projectId}.emailAddress`]: normalizedEmail,
        [`apisConnected.${projectId}.emailDefault`]: !!isDefault,
    }

    if (normalizedProvider === EMAIL_PROVIDER_GOOGLE) {
        updateData[`apisConnected.${projectId}.gmail`] = true
        updateData[`apisConnected.${projectId}.gmailEmail`] = normalizedEmail
        updateData[`apisConnected.${projectId}.gmailDefault`] = !!isDefault
    } else {
        updateData[`apisConnected.${projectId}.gmail`] = false
        updateData[`apisConnected.${projectId}.gmailDefault`] = false
    }

    return updateData
}

function buildCalendarConnectionUpdate(projectId, provider, emailAddress, isDefault = false) {
    return {
        [`apisConnected.${projectId}.calendar`]: true,
        [`apisConnected.${projectId}.calendarProvider`]: normalizeProvider(provider, CALENDAR_PROVIDER_GOOGLE),
        [`apisConnected.${projectId}.calendarEmail`]: normalizeEmailAddress(emailAddress),
        [`apisConnected.${projectId}.calendarDefault`]: !!isDefault,
    }
}

function hasExistingDefaultConnection(apisConnected = {}, resolver) {
    return Object.values(apisConnected).some(connection => resolver(connection).isDefault)
}

// ---------------------------------------------------------------------------
// Account-level connections (users/{uid}.emailConnections / .calendarConnections)
//
// Each connection is keyed by a deterministic id derived from (service, provider,
// account email) so reconnecting the same account always lands on the same entry.
// Every consumer goes through the list/get/find resolvers below, which synthesize
// connections from the legacy per-project `apisConnected` map when the new maps are
// empty — that single fallback keeps the system correct in any interleaving of
// (functions deployed, migration run, web deployed).
// ---------------------------------------------------------------------------

const CONNECTION_SERVICE_EMAIL = 'email'
const CONNECTION_SERVICE_CALENDAR = 'calendar'

// FNV-1a 32-bit, hex-encoded. Deliberately dependency-free so the client mirror in
// utils/IntegrationProviders.js produces byte-identical ids (no node crypto on RN web).
function hashEmailForConnectionId(email = '') {
    let hash = 0x811c9dc5
    for (let index = 0; index < email.length; index++) {
        hash ^= email.charCodeAt(index)
        hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0
    }
    return hash.toString(16).padStart(8, '0')
}

// e.g. email_google_3f2a9c1b — safe as a Firestore field-path segment and doc-id fragment.
function buildConnectionId(service, provider, emailAddress) {
    const normalizedService = service === CONNECTION_SERVICE_CALENDAR ? service : CONNECTION_SERVICE_EMAIL
    const normalizedProvider = normalizeProvider(provider, EMAIL_PROVIDER_GOOGLE)
    const normalizedEmail = normalizeEmailAddress(emailAddress)
    return `${normalizedService}_${normalizedProvider}_${hashEmailForConnectionId(normalizedEmail)}`
}

function getConnectionsMapField(service) {
    return service === CONNECTION_SERVICE_CALENDAR ? 'calendarConnections' : 'emailConnections'
}

function normalizeStoredConnection(service, connectionId, stored = {}) {
    return {
        connectionId,
        service,
        provider: normalizeProvider(stored.provider, EMAIL_PROVIDER_GOOGLE),
        emailAddress: normalizeEmailAddress(stored.emailAddress),
        defaultProjectId: typeof stored.defaultProjectId === 'string' ? stored.defaultProjectId : '',
        isDefaultAccount: stored.isDefaultAccount === true,
        authInvalid: stored.authInvalid === true,
        legacy: false,
    }
}

// Synthesize account-level connections from the legacy apisConnected map. Entries for
// the same (provider, email) across several projects collapse into one connection whose
// defaultProjectId is the project holding the legacy default flag (else the first seen).
function synthesizeConnectionsFromApisConnected(service, userData = {}) {
    const apisConnected = userData.apisConnected || {}
    const resolver = service === CONNECTION_SERVICE_CALENDAR ? resolveCalendarConnection : resolveEmailConnection
    const byId = new Map()

    Object.keys(apisConnected).forEach(projectId => {
        const resolved = resolver(apisConnected[projectId] || {})
        if (!resolved.connected || !resolved.emailAddress) return
        const connectionId = buildConnectionId(service, resolved.provider, resolved.emailAddress)
        const existing = byId.get(connectionId)
        if (!existing) {
            byId.set(connectionId, {
                connectionId,
                service,
                provider: resolved.provider,
                emailAddress: resolved.emailAddress,
                defaultProjectId: projectId,
                isDefaultAccount: resolved.isDefault,
                authInvalid: false,
                legacy: true,
            })
        } else if (resolved.isDefault && !existing.isDefaultAccount) {
            existing.isDefaultAccount = true
            existing.defaultProjectId = projectId
        }
    })

    return [...byId.values()]
}

function listConnections(service, userData = {}) {
    const stored = userData[getConnectionsMapField(service)]
    if (stored && typeof stored === 'object' && Object.keys(stored).length > 0) {
        return Object.keys(stored).map(connectionId =>
            normalizeStoredConnection(service, connectionId, stored[connectionId] || {})
        )
    }
    return synthesizeConnectionsFromApisConnected(service, userData)
}

function listEmailConnections(userData = {}) {
    return listConnections(CONNECTION_SERVICE_EMAIL, userData)
}

function listCalendarConnections(userData = {}) {
    return listConnections(CONNECTION_SERVICE_CALENDAR, userData)
}

function getConnection(userData = {}, service, connectionId) {
    if (!connectionId) return null
    return listConnections(service, userData).find(connection => connection.connectionId === connectionId) || null
}

// Materialize the full account-level map for a single authoritative write: stored
// entries keep their extra fields (connectedAt, …); legacy-synthesized connections are
// included so a partial write can never shadow connections that only exist in
// apisConnected.
function materializeConnectionsMap(service, userData = {}) {
    const stored = userData[getConnectionsMapField(service)] || {}
    const map = {}
    listConnections(service, userData).forEach(connection => {
        const existing = stored[connection.connectionId] || {}
        map[connection.connectionId] = {
            ...existing,
            provider: connection.provider,
            emailAddress: connection.emailAddress,
            defaultProjectId: connection.defaultProjectId,
            isDefaultAccount: connection.isDefaultAccount,
            authInvalid: connection.authInvalid,
        }
    })
    return map
}

// Connections whose defaultProjectId is the given project. Under the legacy fallback
// this resolves the project's own apisConnected entry, so pre-migration callers that
// still pass a projectId keep working.
function findConnectionsForProject(userData = {}, service, projectId) {
    if (!projectId) return []
    const connections = listConnections(service, userData)
    const matches = connections.filter(connection => connection.defaultProjectId === projectId)
    if (matches.length > 0) return matches

    // Legacy shape: an apisConnected entry may exist for this project even though the
    // grouped synthesis assigned the connection's defaultProjectId to another project.
    const apisConnected = userData.apisConnected || {}
    const resolver = service === CONNECTION_SERVICE_CALENDAR ? resolveCalendarConnection : resolveEmailConnection
    const resolved = resolver(apisConnected[projectId] || {})
    if (!resolved.connected || !resolved.emailAddress) return []
    const connectionId = buildConnectionId(service, resolved.provider, resolved.emailAddress)
    return connections.filter(connection => connection.connectionId === connectionId)
}

module.exports = {
    CALENDAR_PROVIDER_GOOGLE,
    CALENDAR_PROVIDER_MICROSOFT,
    CONNECTION_SERVICE_CALENDAR,
    CONNECTION_SERVICE_EMAIL,
    EMAIL_PROVIDER_GOOGLE,
    EMAIL_PROVIDER_MICROSOFT,
    buildCalendarConnectionUpdate,
    buildConnectionId,
    buildEmailConnectionUpdate,
    findConnectionsForProject,
    getConnection,
    getConnectionsMapField,
    hasExistingDefaultConnection,
    listCalendarConnections,
    listEmailConnections,
    materializeConnectionsMap,
    normalizeEmailAddress,
    normalizeProvider,
    resolveCalendarConnection,
    resolveEmailConnection,
}
