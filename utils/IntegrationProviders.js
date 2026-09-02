export const PROVIDER_GOOGLE = 'google'
export const PROVIDER_MICROSOFT = 'microsoft'

export function resolveEmailConnection(connection = {}) {
    if (connection?.email) {
        const provider = connection.emailProvider || (connection.gmail ? PROVIDER_GOOGLE : '')
        return {
            connected: true,
            provider,
            email: connection.emailAddress || connection.gmailEmail || '',
            isDefault: connection.emailDefault === true || connection.gmailDefault === true,
        }
    }

    if (connection?.gmail) {
        return {
            connected: true,
            provider: PROVIDER_GOOGLE,
            email: connection.gmailEmail || '',
            isDefault: connection.gmailDefault === true,
        }
    }

    return { connected: false, provider: '', email: '', isDefault: false }
}

export function resolveCalendarConnection(connection = {}) {
    if (!connection?.calendar) return { connected: false, provider: '', email: '', isDefault: false }
    return {
        connected: true,
        provider: connection.calendarProvider || PROVIDER_GOOGLE,
        email: connection.calendarEmail || '',
        isDefault: connection.calendarDefault === true,
    }
}

export function getProviderLabel(provider) {
    if (provider === PROVIDER_MICROSOFT) return 'Microsoft'
    return 'Google'
}

// ---------------------------------------------------------------------------
// Account-level connections — client mirror of functions/Integrations/
// providerConnections.js. Keep buildConnectionId byte-identical with the server.
// ---------------------------------------------------------------------------

export const CONNECTION_SERVICE_EMAIL = 'email'
export const CONNECTION_SERVICE_CALENDAR = 'calendar'

// FNV-1a 32-bit, hex-encoded — mirrors the server implementation exactly.
function hashEmailForConnectionId(email = '') {
    let hash = 0x811c9dc5
    for (let index = 0; index < email.length; index++) {
        hash ^= email.charCodeAt(index)
        hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0
    }
    return hash.toString(16).padStart(8, '0')
}

export function buildConnectionId(service, provider, emailAddress) {
    const normalizedService = service === CONNECTION_SERVICE_CALENDAR ? service : CONNECTION_SERVICE_EMAIL
    const normalizedProvider = provider === PROVIDER_MICROSOFT ? PROVIDER_MICROSOFT : PROVIDER_GOOGLE
    const normalizedEmail = typeof emailAddress === 'string' ? emailAddress.trim().toLowerCase() : ''
    return `${normalizedService}_${normalizedProvider}_${hashEmailForConnectionId(normalizedEmail)}`
}

function normalizeStoredConnection(service, connectionId, stored = {}) {
    return {
        connectionId,
        service,
        provider: stored.provider === PROVIDER_MICROSOFT ? PROVIDER_MICROSOFT : PROVIDER_GOOGLE,
        email: typeof stored.emailAddress === 'string' ? stored.emailAddress : '',
        defaultProjectId: typeof stored.defaultProjectId === 'string' ? stored.defaultProjectId : '',
        isDefaultAccount: stored.isDefaultAccount === true,
        authInvalid: stored.authInvalid === true,
        legacy: false,
    }
}

// Synthesize account-level connections from the legacy per-project apisConnected map so
// the UI works before the migration has run for this user.
function synthesizeConnectionsFromApisConnected(service, loggedUser = {}) {
    const apisConnected = loggedUser.apisConnected || {}
    const resolver = service === CONNECTION_SERVICE_CALENDAR ? resolveCalendarConnection : resolveEmailConnection
    const byId = new Map()

    Object.keys(apisConnected).forEach(projectId => {
        const resolved = resolver(apisConnected[projectId] || {})
        if (!resolved.connected || !resolved.email) return
        const connectionId = buildConnectionId(service, resolved.provider, resolved.email)
        const existing = byId.get(connectionId)
        if (!existing) {
            byId.set(connectionId, {
                connectionId,
                service,
                provider: resolved.provider,
                email: resolved.email,
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

function listConnections(service, loggedUser = {}) {
    const field = service === CONNECTION_SERVICE_CALENDAR ? 'calendarConnections' : 'emailConnections'
    const stored = loggedUser[field]
    if (stored && typeof stored === 'object' && Object.keys(stored).length > 0) {
        return Object.keys(stored).map(connectionId =>
            normalizeStoredConnection(service, connectionId, stored[connectionId] || {})
        )
    }
    return synthesizeConnectionsFromApisConnected(service, loggedUser)
}

export function listEmailConnections(loggedUser = {}) {
    return listConnections(CONNECTION_SERVICE_EMAIL, loggedUser)
}

export function listCalendarConnections(loggedUser = {}) {
    return listConnections(CONNECTION_SERVICE_CALENDAR, loggedUser)
}

export function getConnection(loggedUser = {}, service, connectionId) {
    if (!connectionId) return null
    return listConnections(service, loggedUser).find(connection => connection.connectionId === connectionId) || null
}

// Payload fragment for callables that accept either a legacy projectId or an
// account-level connectionId — pass the working key, get the right field name.
export function buildConnectionKeyPayload(key) {
    return /^(email|calendar)_(google|microsoft)_[0-9a-f]{8}$/.test(String(key || ''))
        ? { connectionId: key }
        : { projectId: key }
}

// Connections whose defaultProjectId is the given project (legacy fallback included).
export function getConnectionsForProject(loggedUser = {}, service, projectId) {
    if (!projectId) return []
    const connections = listConnections(service, loggedUser)
    const matches = connections.filter(connection => connection.defaultProjectId === projectId)
    if (matches.length > 0) return matches

    const apisConnected = loggedUser.apisConnected || {}
    const resolver = service === CONNECTION_SERVICE_CALENDAR ? resolveCalendarConnection : resolveEmailConnection
    const resolved = resolver(apisConnected[projectId] || {})
    if (!resolved.connected || !resolved.email) return []
    const connectionId = buildConnectionId(service, resolved.provider, resolved.email)
    return connections.filter(connection => connection.connectionId === connectionId)
}
