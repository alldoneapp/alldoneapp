'use strict'

const admin = require('firebase-admin')
const { getEnvFunctions } = require('../envFunctionsHelper.js')
const {
    CALENDAR_PROVIDER_MICROSOFT,
    CONNECTION_SERVICE_CALENDAR,
    CONNECTION_SERVICE_EMAIL,
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
    resolveCalendarConnection,
    resolveEmailConnection,
} = require('../Integrations/providerConnections')
const { FieldValue, Timestamp } = require('firebase-admin/firestore')

/**
 * The Microsoft twin of GoogleAuthRevokedError. Before AT-2491 this path threw a plain
 * Error, so `isAuthError` in emailLine/emailLineErrors.js had to recognise it by string —
 * and the message that actually arrives for a dead refresh token is Microsoft's own
 * "AADSTS700082: The refresh token has expired due to inactivity", which matches none of
 * its signatures. A revoked Microsoft mailbox therefore surfaced as a generic `internal`
 * error and the client was never told to offer a reconnect.
 */
class MicrosoftAuthRevokedError extends Error {
    constructor(message = 'Microsoft OAuth access was revoked or expired. Please reconnect.') {
        super(message)
        this.name = 'MicrosoftAuthRevokedError'
        this.code = 'EMAIL_AUTH_EXPIRED'
        this.reconnectRequired = true
    }
}

// AADSTS codes that unambiguously mean "this user must sign in again". Deliberately a
// short allowlist rather than the previous /AADSTS/i catch-all: that pattern also matched
// our-fault and transient failures — AADSTS7000215 is a wrong client secret, AADSTS50053 is
// a locked account, and one bad deploy would have disconnected every Microsoft account in
// the product. Same reasoning as Google's isInvalidGrantError.
const MICROSOFT_RECONNECT_ERROR_CODES = new Set([
    50076, // MFA required for this resource
    50078, // re-authentication required
    50173, // refresh token revoked (password change / admin revoke)
    50432, // grant revoked
    65001, // user or admin has not consented
    70000, // invalid grant
    700082, // refresh token expired due to inactivity
    700084, // refresh token issued to a single-page app cannot be used here
    700003, // token not valid for this authorization
])

/**
 * Whether a token-endpoint failure means the grant is dead and only a fresh consent can
 * fix it. Decided structurally where possible — `postTokenRequest` attaches Microsoft's
 * parsed `error` / `error_codes` — because `error_description` is prose and matching it is
 * how the over-broad pattern got there in the first place. `invalid_grant` is the OAuth2
 * code for exactly this condition; a bad client secret comes back as `invalid_client` and
 * is therefore correctly ignored.
 */
function isMicrosoftReconnectRequiredError(error) {
    if (!error) return false
    if (error instanceof MicrosoftAuthRevokedError) return true
    if (error.oauthError === 'invalid_grant') return true
    if (Array.isArray(error.oauthErrorCodes)) {
        if (error.oauthErrorCodes.some(code => MICROSOFT_RECONNECT_ERROR_CODES.has(Number(code)))) return true
    }
    // Structured fields are absent when the endpoint answers with something unparseable.
    // Fall back to the one string that is a protocol token rather than prose.
    return /\binvalid_grant\b/i.test(String(error.message || ''))
}

// Microsoft services already use 'email'/'calendar', matching the connection model.
function microsoftServiceToConnectionService(service) {
    return service === 'calendar' ? CONNECTION_SERVICE_CALENDAR : CONNECTION_SERVICE_EMAIL
}

function isConnectionId(value) {
    return typeof value === 'string' && /^(email|calendar)_(google|microsoft)_[0-9a-f]{8}$/.test(value)
}

async function loadUserDataForConnections(userId) {
    const userDoc = await admin.firestore().collection('users').doc(userId).get()
    return userDoc.exists ? userDoc.data() || {} : {}
}

if (!global.fetch) require('isomorphic-fetch')
const fetchImpl = global.fetch
const MICROSOFT_AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0'
const CALENDAR_SCOPES = ['User.Read', 'offline_access', 'Calendars.ReadWrite']
const EMAIL_SCOPES = ['User.Read', 'offline_access', 'Mail.ReadWrite']

function getBaseUrl() {
    if (process.env.FUNCTIONS_EMULATOR) return 'http://localhost:5000'

    let projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
    if (!projectId) {
        try {
            const cfg = process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG) : null
            if (cfg && cfg.projectId) projectId = cfg.projectId
        } catch (_) {}
    }
    if (!projectId) {
        try {
            projectId = (admin.app() && admin.app().options && admin.app().options.projectId) || undefined
        } catch (_) {}
    }

    if (projectId === 'alldonealeph') return 'https://my.alldone.app'
    if (projectId === 'alldonestaging') return 'https://mystaging.alldone.app'
    return 'https://my.alldone.app'
}

function getMicrosoftOAuthConfig() {
    const envFunctions = getEnvFunctions()
    const clientId = envFunctions.MICROSOFT_OAUTH_CLIENT_ID
    const clientSecret = envFunctions.MICROSOFT_OAUTH_CLIENT_SECRET
    const redirectUri = `${getBaseUrl()}/microsoftOAuthCallback`

    if (!clientId || !clientSecret) {
        throw new Error('Microsoft OAuth credentials not configured')
    }

    return { clientId, clientSecret, redirectUri }
}

function getScopes(service) {
    if (service === 'calendar') return CALENDAR_SCOPES
    if (service === 'email') return EMAIL_SCOPES
    throw new Error(`Invalid Microsoft service specified: ${service}`)
}

function tokenDocRef(userId, projectId, service) {
    return admin
        .firestore()
        .collection('users')
        .doc(userId)
        .collection('private')
        .doc(`microsoftAuth_${projectId}_${service}`)
}

function connectionTokenDocRef(userId, connectionId) {
    return admin.firestore().collection('users').doc(userId).collection('private').doc(`microsoftAuth_${connectionId}`)
}

// Resolve the token doc for a connection id or a legacy (projectId, service) pair:
// account-level doc first, then the legacy per-project doc of the (default) project.
async function resolveTokenDoc(userId, connectionIdOrProjectId, service) {
    if (isConnectionId(connectionIdOrProjectId)) {
        const connectionId = connectionIdOrProjectId
        const resolvedService = service || (connectionId.startsWith('calendar_') ? 'calendar' : 'email')
        const connectionRef = connectionTokenDocRef(userId, connectionId)
        const connectionDoc = await connectionRef.get()
        if (connectionDoc.exists)
            return { ref: connectionRef, doc: connectionDoc, connectionId, service: resolvedService }

        const userData = await loadUserDataForConnections(userId)
        const connection = getConnection(userData, microsoftServiceToConnectionService(resolvedService), connectionId)
        if (connection?.defaultProjectId) {
            const legacyRef = tokenDocRef(userId, connection.defaultProjectId, resolvedService)
            const legacyDoc = await legacyRef.get()
            if (legacyDoc.exists) return { ref: legacyRef, doc: legacyDoc, connectionId, service: resolvedService }
        }
        return { ref: connectionRef, doc: connectionDoc, connectionId, service: resolvedService }
    }

    const projectId = connectionIdOrProjectId
    let connectionId = null
    if (projectId && service) {
        const userData = await loadUserDataForConnections(userId)
        const [match] = findConnectionsForProject(userData, microsoftServiceToConnectionService(service), projectId)
        if (match && match.provider === EMAIL_PROVIDER_MICROSOFT) {
            connectionId = match.connectionId
            const connectionRef = connectionTokenDocRef(userId, connectionId)
            const connectionDoc = await connectionRef.get()
            if (connectionDoc.exists) return { ref: connectionRef, doc: connectionDoc, connectionId, service }
        }
    }
    const legacyRef = tokenDocRef(userId, projectId, service)
    const legacyDoc = await legacyRef.get()
    return { ref: legacyRef, doc: legacyDoc, connectionId, service }
}

async function postTokenRequest(params) {
    const response = await fetchImpl(`${MICROSOFT_AUTHORITY}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        const error = new Error(
            data.error_description || data.error || `Microsoft token request failed: ${response.status}`
        )
        // Keep Microsoft's structured answer on the error so callers can classify it without
        // parsing the human-readable description (AT-2491).
        error.oauthError = data.error || null
        error.oauthErrorCodes = Array.isArray(data.error_codes) ? data.error_codes : []
        error.httpStatus = response.status
        throw error
    }
    return data
}

async function graphRequest(accessToken, path, options = {}) {
    const response = await fetchImpl(`${GRAPH_ROOT}${path}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {}),
        },
    })

    if (response.status === 204) return null
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(data.error?.message || `Microsoft Graph request failed: ${response.status}`)
    }
    return data
}

function normalizeMicrosoftEmail(userInfo = {}) {
    return String(userInfo.mail || userInfo.userPrincipalName || '')
        .trim()
        .toLowerCase()
}

async function initiateOAuth(userId, projectId, service, returnUrl, connectionId = null) {
    const { clientId, redirectUri } = getMicrosoftOAuthConfig()
    const scopes = getScopes(service)

    // A reconnect targets an existing account-level connection; keep its default project.
    if (isConnectionId(connectionId)) {
        const userData = await loadUserDataForConnections(userId)
        const connection = getConnection(userData, microsoftServiceToConnectionService(service), connectionId)
        if (connection && !projectId) {
            projectId = connection.defaultProjectId
        }
    }
    if (!projectId) {
        throw new Error('A default project is required to connect a Microsoft account')
    }

    const state = `${userId}:${projectId}:${service}:${Date.now()}`

    await admin
        .firestore()
        .collection('microsoftOAuthStates')
        .doc(state)
        .set({
            userId,
            projectId,
            service,
            connectionId: isConnectionId(connectionId) ? connectionId : null,
            returnUrl: returnUrl || null,
            createdAt: Timestamp.now(),
            expiresAt: Timestamp.fromDate(new Date(Date.now() + 10 * 60 * 1000)),
        })

    const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        response_mode: 'query',
        scope: scopes.join(' '),
        state,
        prompt: 'select_account',
    })

    return `${MICROSOFT_AUTHORITY}/authorize?${params.toString()}`
}

async function handleOAuthCallback(code, state) {
    const stateRef = admin.firestore().collection('microsoftOAuthStates').doc(state)
    const stateDoc = await stateRef.get()
    if (!stateDoc.exists) throw new Error('Invalid or expired Microsoft state parameter')

    const { userId, projectId, service, expiresAt, returnUrl } = stateDoc.data()
    if (expiresAt.toDate() < new Date()) {
        await stateRef.delete()
        throw new Error('Microsoft state parameter expired')
    }

    const { clientId, clientSecret, redirectUri } = getMicrosoftOAuthConfig()
    const tokenData = await postTokenRequest({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: getScopes(service).join(' '),
    })

    if (!tokenData.access_token) throw new Error('No access token received from Microsoft')

    const userInfo = await graphRequest(tokenData.access_token, '/me?$select=id,mail,userPrincipalName,displayName')
    const email = normalizeMicrosoftEmail(userInfo)
    if (!email) throw new Error('Microsoft account email was not returned')

    // Store tokens keyed by the account-level connection id — reconnecting the same
    // account always lands on the same doc, deduping for free.
    const connectionService = microsoftServiceToConnectionService(service)
    const connectionId = buildConnectionId(connectionService, EMAIL_PROVIDER_MICROSOFT, email)

    await connectionTokenDocRef(userId, connectionId).set({
        refreshToken: tokenData.refresh_token || '',
        accessToken: tokenData.access_token,
        tokenExpiry: tokenData.expires_in
            ? Timestamp.fromMillis(Date.now() + Number(tokenData.expires_in) * 1000)
            : null,
        scopes: typeof tokenData.scope === 'string' ? tokenData.scope.split(' ') : getScopes(service),
        email,
        microsoftUserId: userInfo.id || null,
        createdAt: Timestamp.now(),
        lastUsed: Timestamp.now(),
        provider: 'microsoft',
        service,
        connectionId,
    })

    // Microsoft Graph has just named the mailbox these credentials belong to — the one
    // moment ownership is actually proven. Record it so the Anna email channel can trust
    // this connection when it resolves an inbound sender (AT-2483).
    if (connectionService === CONNECTION_SERVICE_EMAIL) {
        const { recordEmailIdentityAttestation } = require('../Email/emailIdentityAttestation')
        await recordEmailIdentityAttestation({
            userId,
            email,
            provider: EMAIL_PROVIDER_MICROSOFT,
            connectionId,
            source: 'microsoft_oauth_connect',
        })
    }

    const userRef = admin.firestore().collection('users').doc(userId)
    const userDoc = await userRef.get()
    const userData = userDoc.exists ? userDoc.data() || {} : {}
    const existingApisConnected = userData.apisConnected || {}

    // Upsert the account-level connection (reconnect keeps defaultProjectId + default flag).
    const mapField = getConnectionsMapField(connectionService)
    const existingConnections =
        connectionService === CONNECTION_SERVICE_CALENDAR
            ? listCalendarConnections(userData)
            : listEmailConnections(userData)
    const existingEntry = (userData[mapField] || {})[connectionId] || null
    const hasAnyDefaultAccount = existingConnections.some(connection => connection.isDefaultAccount)
    const now = Timestamp.now()

    const updateData = {
        [`${mapField}.${connectionId}.provider`]: EMAIL_PROVIDER_MICROSOFT,
        [`${mapField}.${connectionId}.emailAddress`]: email,
        [`${mapField}.${connectionId}.defaultProjectId`]: existingEntry?.defaultProjectId || projectId,
        [`${mapField}.${connectionId}.isDefaultAccount`]: existingEntry
            ? existingEntry.isDefaultAccount === true
            : !hasAnyDefaultAccount,
        [`${mapField}.${connectionId}.authInvalid`]: false,
        // A fresh consent clears the reconnect-required state on the map the client reads,
        // not only the boolean (AT-2491).
        [`${mapField}.${connectionId}.authInvalidAt`]: FieldValue.delete(),
        [`${mapField}.${connectionId}.updatedAt`]: now,
    }
    if (!existingEntry) {
        updateData[`${mapField}.${connectionId}.connectedAt`] = now
    }

    // Keep the legacy per-project shape updated during the transition. (No cross-provider
    // token deletes anymore — Google and Microsoft accounts coexist as separate connections.)
    const legacyProjectId = existingEntry?.defaultProjectId || projectId
    if (service === 'calendar') {
        const hasExistingDefaultCalendar = hasExistingDefaultConnection(
            existingApisConnected,
            resolveCalendarConnection
        )
        Object.assign(
            updateData,
            buildCalendarConnectionUpdate(
                legacyProjectId,
                CALENDAR_PROVIDER_MICROSOFT,
                email,
                !hasExistingDefaultCalendar
            )
        )
    } else {
        const hasExistingDefaultEmail = hasExistingDefaultConnection(existingApisConnected, resolveEmailConnection)
        Object.assign(
            updateData,
            buildEmailConnectionUpdate(legacyProjectId, EMAIL_PROVIDER_MICROSOFT, email, !hasExistingDefaultEmail)
        )
    }

    await userRef.update(updateData)
    await stateRef.delete()

    return { userId, projectId, service, connectionId, email, returnUrl }
}

/**
 * The Microsoft twin of markGoogleAuthInvalid. The token document is KEPT (it carries the
 * account email and scopes the reconnect UI reads) but every secret is removed, and both
 * the document and the account-level connection map are flagged with the moment it broke.
 *
 * Before AT-2491 only the map was written, and only when a connectionId happened to be
 * resolved — so a pre-migration user was never flagged at all — and a single nested field
 * write on a user with no stored map would create a one-entry map that shadows every
 * connection living only in the legacy apisConnected shape. Both are fixed here by
 * mirroring the Google implementation.
 */
async function markMicrosoftAuthInvalid(userId, { ref, connectionId, service, userData } = {}) {
    const invalidAt = Timestamp.now()

    if (ref) {
        await ref
            .update({
                accessToken: FieldValue.delete(),
                refreshToken: FieldValue.delete(),
                tokenExpiry: FieldValue.delete(),
                authInvalid: true,
                authInvalidAt: invalidAt,
            })
            .catch(error => {
                console.error('[msoauth] Failed to flag invalid token document:', error?.message || error)
            })
    }

    if (!connectionId) return

    const connectionService = microsoftServiceToConnectionService(service)
    const mapField = getConnectionsMapField(connectionService)
    const resolvedUserData = userData || (await loadUserDataForConnections(userId).catch(() => ({})))
    const storedMap = resolvedUserData?.[mapField]
    const hasStoredMap = storedMap && typeof storedMap === 'object' && Object.keys(storedMap).length > 0

    let updateData = null
    if (hasStoredMap) {
        updateData = {
            [`${mapField}.${connectionId}.authInvalid`]: true,
            [`${mapField}.${connectionId}.authInvalidAt`]: invalidAt,
        }
    } else {
        const materialized = materializeConnectionsMap(connectionService, resolvedUserData || {})
        if (materialized[connectionId]) {
            materialized[connectionId].authInvalid = true
            materialized[connectionId].authInvalidAt = invalidAt
            updateData = { [mapField]: materialized }
        }
    }

    if (!updateData) return
    await admin
        .firestore()
        .collection('users')
        .doc(userId)
        .update(updateData)
        .catch(error => {
            console.error('[msoauth] Failed to flag invalid connection:', error?.message || error)
        })
}

// A token document survives revocation (it still carries the account email the reconnect UI
// needs), so `exists` alone no longer means "usable".
function isUsableMicrosoftTokenDoc(tokenDoc) {
    if (!tokenDoc || !tokenDoc.exists) return false
    return (tokenDoc.data() || {}).authInvalid !== true
}

async function getAccessToken(userId, projectId, service, options = {}) {
    const {
        ref,
        doc: tokenDoc,
        connectionId,
        service: resolvedService,
    } = await resolveTokenDoc(userId, projectId, service)
    service = resolvedService || service
    if (!tokenDoc.exists) throw new Error(`User not authenticated with Microsoft for ${service}`)

    const data = tokenDoc.data() || {}

    // Already known dead — fail fast and typed, never re-attempt a refresh token the
    // provider has already rejected. Without this the handler retried a revoked grant on
    // every single call for as long as the connection existed.
    if (data.authInvalid === true) throw new MicrosoftAuthRevokedError()

    const expiresAt = data.tokenExpiry?.toMillis ? data.tokenExpiry.toMillis() : 0
    // `forceRefresh` bypasses the cached access token. An unexpired access token says
    // nothing about whether the REFRESH token still works, and a dead refresh token is the
    // whole failure mode the health check exists to find (AT-2491).
    if (!options.forceRefresh && data.accessToken && expiresAt - Date.now() > 2 * 60 * 1000) {
        await ref.update({ lastUsed: Timestamp.now() })
        return data.accessToken
    }

    if (!data.refreshToken) {
        console.warn(
            `[msoauth] ⚠️ No refresh token stored for user ${userId} (service: ${service}, connection: ${connectionId}). Reconnect required.`
        )
        await markMicrosoftAuthInvalid(userId, { ref, connectionId, service })
        throw new MicrosoftAuthRevokedError('Microsoft OAuth refresh token is missing. Please reconnect.')
    }

    const { clientId, clientSecret, redirectUri } = getMicrosoftOAuthConfig()
    let refreshed
    try {
        refreshed = await postTokenRequest({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: data.refreshToken,
            redirect_uri: redirectUri,
            grant_type: 'refresh_token',
            scope: getScopes(service).join(' '),
        })
    } catch (error) {
        if (isMicrosoftReconnectRequiredError(error)) {
            console.warn(
                `[msoauth] ⚠️ Dead refresh token for user ${userId} (service: ${service}, connection: ${connectionId}). Flagging connection for reconnect.`
            )
            await markMicrosoftAuthInvalid(userId, { ref, connectionId, service })
            throw new MicrosoftAuthRevokedError()
        }
        // Transient or our-fault failure (throttling, a bad client secret, Microsoft being
        // down): keep the credentials intact and let the caller fail normally.
        throw error
    }

    const updateData = {
        accessToken: refreshed.access_token,
        lastUsed: Timestamp.now(),
    }
    if (refreshed.refresh_token) updateData.refreshToken = refreshed.refresh_token
    if (refreshed.expires_in) {
        updateData.tokenExpiry = Timestamp.fromMillis(Date.now() + Number(refreshed.expires_in) * 1000)
    }
    if (typeof refreshed.scope === 'string') updateData.scopes = refreshed.scope.split(' ')

    await ref.update(updateData)
    return refreshed.access_token
}

// Revoke an account-level Microsoft connection: delete its token doc(s), remove the
// connection map entry, and clear every legacy apisConnected entry for this account.
async function revokeConnectionAccess(userId, connectionId) {
    const connectionService = connectionId.startsWith('calendar_')
        ? CONNECTION_SERVICE_CALENDAR
        : CONNECTION_SERVICE_EMAIL
    const mapField = getConnectionsMapField(connectionService)
    const legacyService = connectionService === CONNECTION_SERVICE_CALENDAR ? 'calendar' : 'email'
    const userData = await loadUserDataForConnections(userId)
    const connection = getConnection(userData, connectionService, connectionId)

    await connectionTokenDocRef(userId, connectionId)
        .delete()
        .catch(() => null)
    if (connection?.defaultProjectId) {
        await tokenDocRef(userId, connection.defaultProjectId, legacyService)
            .delete()
            .catch(() => null)
    }

    if (connectionService === CONNECTION_SERVICE_EMAIL && connection?.emailAddress) {
        const { removeEmailIdentityAttestation } = require('../Email/emailIdentityAttestation')
        await removeEmailIdentityAttestation({ userId, email: connection.emailAddress })
    }

    const updateData = { [`${mapField}.${connectionId}`]: FieldValue.delete() }
    const resolver =
        connectionService === CONNECTION_SERVICE_CALENDAR ? resolveCalendarConnection : resolveEmailConnection
    const apisConnected = userData.apisConnected || {}
    Object.keys(apisConnected).forEach(legacyProjectId => {
        const resolved = resolver(apisConnected[legacyProjectId] || {})
        if (!resolved.connected || !resolved.emailAddress) return
        if (buildConnectionId(connectionService, resolved.provider, resolved.emailAddress) !== connectionId) return
        if (connectionService === CONNECTION_SERVICE_CALENDAR) {
            updateData[`apisConnected.${legacyProjectId}.calendar`] = false
            updateData[`apisConnected.${legacyProjectId}.calendarProvider`] = FieldValue.delete()
            updateData[`apisConnected.${legacyProjectId}.calendarEmail`] = FieldValue.delete()
            updateData[`apisConnected.${legacyProjectId}.calendarDefault`] = false
        } else {
            updateData[`apisConnected.${legacyProjectId}.email`] = false
            updateData[`apisConnected.${legacyProjectId}.emailProvider`] = FieldValue.delete()
            updateData[`apisConnected.${legacyProjectId}.emailAddress`] = FieldValue.delete()
            updateData[`apisConnected.${legacyProjectId}.emailDefault`] = false
            updateData[`apisConnected.${legacyProjectId}.gmail`] = false
            updateData[`apisConnected.${legacyProjectId}.gmailDefault`] = false
            updateData[`apisConnected.${legacyProjectId}.gmailEmail`] = FieldValue.delete()
        }
    })

    await admin.firestore().collection('users').doc(userId).update(updateData)
    return { success: true, message: 'Microsoft access disconnected successfully' }
}

async function revokeAccess(userId, projectId, service) {
    if (isConnectionId(projectId)) {
        return await revokeConnectionAccess(userId, projectId)
    }

    const legacyTokenRef = tokenDocRef(userId, projectId, service)
    const legacyTokenEmail =
        service === 'email'
            ? await legacyTokenRef
                  .get()
                  .then(doc => (doc.exists ? doc.data()?.email || '' : ''))
                  .catch(() => '')
            : ''
    await legacyTokenRef.delete().catch(() => null)

    if (legacyTokenEmail) {
        const { removeEmailIdentityAttestation } = require('../Email/emailIdentityAttestation')
        await removeEmailIdentityAttestation({ userId, email: legacyTokenEmail })
    }

    const updateData = {}
    if (service === 'calendar') {
        updateData[`apisConnected.${projectId}.calendar`] = false
        updateData[`apisConnected.${projectId}.calendarProvider`] = FieldValue.delete()
        updateData[`apisConnected.${projectId}.calendarEmail`] = FieldValue.delete()
        updateData[`apisConnected.${projectId}.calendarDefault`] = false
    } else if (service === 'email') {
        updateData[`apisConnected.${projectId}.email`] = false
        updateData[`apisConnected.${projectId}.emailProvider`] = FieldValue.delete()
        updateData[`apisConnected.${projectId}.emailAddress`] = FieldValue.delete()
        updateData[`apisConnected.${projectId}.emailDefault`] = false
        updateData[`apisConnected.${projectId}.gmail`] = false
        updateData[`apisConnected.${projectId}.gmailDefault`] = false
        updateData[`apisConnected.${projectId}.gmailEmail`] = FieldValue.delete()
    }

    if (Object.keys(updateData).length > 0) {
        await admin.firestore().collection('users').doc(userId).update(updateData)
    }

    return { success: true, message: 'Microsoft access disconnected successfully' }
}

async function getCredentialStatus(userId, projectId, service) {
    const { doc: tokenDoc, service: resolvedService } = await resolveTokenDoc(userId, projectId, service)
    service = resolvedService || service
    if (!isUsableMicrosoftTokenDoc(tokenDoc)) {
        return {
            hasCredentials: false,
            // Surface the account that needs reconnecting when we still know it, and say
            // WHY it is unusable — matching Google's status shape (AT-2491).
            email: (tokenDoc.exists && (tokenDoc.data() || {}).email) || null,
            scopes: [],
            hasModifyScope: false,
            provider: 'microsoft',
            authInvalid: !!(tokenDoc.exists && (tokenDoc.data() || {}).authInvalid === true),
        }
    }

    const data = tokenDoc.data() || {}
    const scopes = Array.isArray(data.scopes) ? data.scopes : []
    return {
        hasCredentials: true,
        email: data.email || null,
        scopes,
        hasModifyScope: service === 'email' ? scopes.includes('Mail.ReadWrite') : true,
        provider: 'microsoft',
    }
}

module.exports = {
    graphRequest,
    getAccessToken,
    getCredentialStatus,
    handleOAuthCallback,
    initiateOAuth,
    revokeAccess,
    MicrosoftAuthRevokedError,
    __private__: {
        getScopes,
        normalizeMicrosoftEmail,
        isMicrosoftReconnectRequiredError,
        isUsableMicrosoftTokenDoc,
        markMicrosoftAuthInvalid,
    },
}
