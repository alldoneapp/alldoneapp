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
    resolveCalendarConnection,
    resolveEmailConnection,
} = require('../Integrations/providerConnections')

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
        throw new Error(data.error_description || data.error || `Microsoft token request failed: ${response.status}`)
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
            createdAt: admin.firestore.Timestamp.now(),
            expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 10 * 60 * 1000)),
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
            ? admin.firestore.Timestamp.fromMillis(Date.now() + Number(tokenData.expires_in) * 1000)
            : null,
        scopes: typeof tokenData.scope === 'string' ? tokenData.scope.split(' ') : getScopes(service),
        email,
        microsoftUserId: userInfo.id || null,
        createdAt: admin.firestore.Timestamp.now(),
        lastUsed: admin.firestore.Timestamp.now(),
        provider: 'microsoft',
        service,
        connectionId,
    })

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
    const now = admin.firestore.Timestamp.now()

    const updateData = {
        [`${mapField}.${connectionId}.provider`]: EMAIL_PROVIDER_MICROSOFT,
        [`${mapField}.${connectionId}.emailAddress`]: email,
        [`${mapField}.${connectionId}.defaultProjectId`]: existingEntry?.defaultProjectId || projectId,
        [`${mapField}.${connectionId}.isDefaultAccount`]: existingEntry
            ? existingEntry.isDefaultAccount === true
            : !hasAnyDefaultAccount,
        [`${mapField}.${connectionId}.authInvalid`]: false,
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

async function getAccessToken(userId, projectId, service) {
    const { ref, doc: tokenDoc, connectionId, service: resolvedService } = await resolveTokenDoc(
        userId,
        projectId,
        service
    )
    service = resolvedService || service
    if (!tokenDoc.exists) throw new Error(`User not authenticated with Microsoft for ${service}`)

    const data = tokenDoc.data() || {}
    const expiresAt = data.tokenExpiry?.toMillis ? data.tokenExpiry.toMillis() : 0
    if (data.accessToken && expiresAt - Date.now() > 2 * 60 * 1000) {
        await ref.update({ lastUsed: admin.firestore.Timestamp.now() })
        return data.accessToken
    }

    if (!data.refreshToken) throw new Error('Microsoft OAuth refresh token is missing. Please reconnect.')

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
        // Flag the account-level connection on a dead refresh token so the UI can offer
        // a reconnect.
        if (connectionId && /invalid_grant|AADSTS/i.test(error?.message || '')) {
            const mapField = getConnectionsMapField(microsoftServiceToConnectionService(service))
            await admin
                .firestore()
                .collection('users')
                .doc(userId)
                .update({ [`${mapField}.${connectionId}.authInvalid`]: true })
                .catch(() => null)
        }
        throw error
    }

    const updateData = {
        accessToken: refreshed.access_token,
        lastUsed: admin.firestore.Timestamp.now(),
    }
    if (refreshed.refresh_token) updateData.refreshToken = refreshed.refresh_token
    if (refreshed.expires_in) {
        updateData.tokenExpiry = admin.firestore.Timestamp.fromMillis(Date.now() + Number(refreshed.expires_in) * 1000)
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

    const updateData = { [`${mapField}.${connectionId}`]: admin.firestore.FieldValue.delete() }
    const resolver =
        connectionService === CONNECTION_SERVICE_CALENDAR ? resolveCalendarConnection : resolveEmailConnection
    const apisConnected = userData.apisConnected || {}
    Object.keys(apisConnected).forEach(legacyProjectId => {
        const resolved = resolver(apisConnected[legacyProjectId] || {})
        if (!resolved.connected || !resolved.emailAddress) return
        if (buildConnectionId(connectionService, resolved.provider, resolved.emailAddress) !== connectionId) return
        if (connectionService === CONNECTION_SERVICE_CALENDAR) {
            updateData[`apisConnected.${legacyProjectId}.calendar`] = false
            updateData[`apisConnected.${legacyProjectId}.calendarProvider`] = admin.firestore.FieldValue.delete()
            updateData[`apisConnected.${legacyProjectId}.calendarEmail`] = admin.firestore.FieldValue.delete()
            updateData[`apisConnected.${legacyProjectId}.calendarDefault`] = false
        } else {
            updateData[`apisConnected.${legacyProjectId}.email`] = false
            updateData[`apisConnected.${legacyProjectId}.emailProvider`] = admin.firestore.FieldValue.delete()
            updateData[`apisConnected.${legacyProjectId}.emailAddress`] = admin.firestore.FieldValue.delete()
            updateData[`apisConnected.${legacyProjectId}.emailDefault`] = false
            updateData[`apisConnected.${legacyProjectId}.gmail`] = false
            updateData[`apisConnected.${legacyProjectId}.gmailDefault`] = false
            updateData[`apisConnected.${legacyProjectId}.gmailEmail`] = admin.firestore.FieldValue.delete()
        }
    })

    await admin.firestore().collection('users').doc(userId).update(updateData)
    return { success: true, message: 'Microsoft access disconnected successfully' }
}

async function revokeAccess(userId, projectId, service) {
    if (isConnectionId(projectId)) {
        return await revokeConnectionAccess(userId, projectId)
    }

    await tokenDocRef(userId, projectId, service)
        .delete()
        .catch(() => null)

    const updateData = {}
    if (service === 'calendar') {
        updateData[`apisConnected.${projectId}.calendar`] = false
        updateData[`apisConnected.${projectId}.calendarProvider`] = admin.firestore.FieldValue.delete()
        updateData[`apisConnected.${projectId}.calendarEmail`] = admin.firestore.FieldValue.delete()
        updateData[`apisConnected.${projectId}.calendarDefault`] = false
    } else if (service === 'email') {
        updateData[`apisConnected.${projectId}.email`] = false
        updateData[`apisConnected.${projectId}.emailProvider`] = admin.firestore.FieldValue.delete()
        updateData[`apisConnected.${projectId}.emailAddress`] = admin.firestore.FieldValue.delete()
        updateData[`apisConnected.${projectId}.emailDefault`] = false
        updateData[`apisConnected.${projectId}.gmail`] = false
        updateData[`apisConnected.${projectId}.gmailDefault`] = false
        updateData[`apisConnected.${projectId}.gmailEmail`] = admin.firestore.FieldValue.delete()
    }

    if (Object.keys(updateData).length > 0) {
        await admin.firestore().collection('users').doc(userId).update(updateData)
    }

    return { success: true, message: 'Microsoft access disconnected successfully' }
}

async function getCredentialStatus(userId, projectId, service) {
    const { doc: tokenDoc, service: resolvedService } = await resolveTokenDoc(userId, projectId, service)
    service = resolvedService || service
    if (!tokenDoc.exists) {
        return { hasCredentials: false, email: null, scopes: [], hasModifyScope: false }
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
    __private__: {
        getScopes,
        normalizeMicrosoftEmail,
    },
}
