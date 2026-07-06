const { google } = require('googleapis')
const admin = require('firebase-admin')
const { getEnvFunctions } = require('../envFunctionsHelper.js')
const {
    CONNECTION_SERVICE_CALENDAR,
    CONNECTION_SERVICE_EMAIL,
    EMAIL_PROVIDER_GOOGLE,
    buildCalendarConnectionUpdate,
    buildConnectionId,
    buildEmailConnectionUpdate,
    findConnectionsForProject,
    getConnection,
    getConnectionsMapField,
    hasExistingDefaultConnection: hasExistingResolvedDefaultConnection,
    listCalendarConnections,
    listEmailConnections,
    resolveCalendarConnection,
    resolveEmailConnection,
} = require('../Integrations/providerConnections')

// Google OAuth uses service ids 'gmail'/'calendar'; the connection model uses
// 'email'/'calendar'.
function googleServiceToConnectionService(service) {
    return service === 'calendar' ? CONNECTION_SERVICE_CALENDAR : CONNECTION_SERVICE_EMAIL
}

// Account-level connection ids look like email_google_3f2a9c1b / calendar_microsoft_....
function isConnectionId(value) {
    return typeof value === 'string' && /^(email|calendar)_(google|microsoft)_[0-9a-f]{8}$/.test(value)
}

async function loadUserDataForConnections(userId) {
    const userDoc = await admin.firestore().collection('users').doc(userId).get()
    return userDoc.exists ? userDoc.data() || {} : {}
}

// Helper function to get the correct base URL based on environment
function getBaseUrl() {
    if (process.env.FUNCTIONS_EMULATOR) {
        return 'http://localhost:5000'
    }

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

    if (projectId === 'alldonealeph') {
        return 'https://my.alldone.app'
    }
    if (projectId === 'alldonestaging') {
        return 'https://mystaging.alldone.app'
    }

    return 'https://my.alldone.app'
}

// Get OAuth2 client with credentials
function getOAuth2Client() {
    const envFunctions = getEnvFunctions()
    const clientId = envFunctions.GOOGLE_OAUTH_CLIENT_ID
    const clientSecret = envFunctions.GOOGLE_OAUTH_CLIENT_SECRET
    const baseUrl = getBaseUrl()

    // Debug logging
    console.log('🔐 OAuth Configuration:', {
        clientId: clientId ? `${clientId.substring(0, 20)}...` : 'MISSING',
        clientSecret: clientSecret ? 'SET' : 'MISSING',
        baseUrl,
    })

    if (!clientId || !clientSecret) {
        console.error('❌ Missing OAuth credentials!', {
            clientId: !!clientId,
            clientSecret: !!clientSecret,
            envFunctions: Object.keys(envFunctions),
        })
        throw new Error('OAuth credentials not configured')
    }

    // Redirect URI points to our callback function
    const redirectUri = `${baseUrl}/googleOAuthCallback`

    return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

// Scopes required for Calendar
const CALENDAR_SCOPES = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/userinfo.email',
]

// Scopes required for Gmail
const GMAIL_SCOPES = [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.labels',
    'https://www.googleapis.com/auth/userinfo.email',
]

/**
 * Initiate OAuth flow
 * Returns the authorization URL to redirect the user to
 * @param {string} userId - The user ID
 * @param {string} projectId - The project ID
 * @param {string} service - 'calendar' or 'gmail' (optional, defaults to both for backward compatibility if needed, but we should enforce it)
 */
async function initiateOAuth(userId, projectId, service, returnUrl, connectionId = null) {
    const oauth2Client = getOAuth2Client()

    // Determine scopes based on service
    let scopes = []
    if (service === 'calendar') {
        scopes = CALENDAR_SCOPES
    } else if (service === 'gmail') {
        scopes = GMAIL_SCOPES
    } else {
        // Fallback or error? Let's default to combined for safety if not specified,
        // but the goal is separation.
        // For now, if no service specified, we might want to throw error or default to calendar?
        // Let's assume service is required for the new flow.
        if (!service) {
            console.warn('[oauth] No service specified, defaulting to Calendar scopes')
            scopes = CALENDAR_SCOPES
        } else {
            throw new Error(`Invalid service specified: ${service}`)
        }
    }

    // A reconnect targets an existing account-level connection; keep its default project.
    // A fresh connect requires a projectId, which becomes the connection's default project.
    if (isConnectionId(connectionId)) {
        const userData = await loadUserDataForConnections(userId)
        const connection = getConnection(userData, googleServiceToConnectionService(service), connectionId)
        if (connection && !projectId) {
            projectId = connection.defaultProjectId
        }
    }
    if (!projectId) {
        throw new Error('A default project is required to connect a Google account')
    }

    // Store state in Firestore to verify callback
    // We include the service in the state so we know what we are connecting
    const state = `${userId}:${projectId}:${service || 'calendar'}:${Date.now()}`
    const stateDoc = {
        userId,
        projectId,
        service: service || 'calendar',
        connectionId: isConnectionId(connectionId) ? connectionId : null,
        returnUrl: returnUrl || null,
        createdAt: admin.firestore.Timestamp.now(),
        expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 10 * 60 * 1000)), // 10 minutes
    }

    await admin.firestore().collection('googleOAuthStates').doc(state).set(stateDoc)

    // Generate authorization URL
    console.log('[oauth] 🚀 Initiating OAuth flow...')
    console.log('[oauth] 📋 Service:', service)
    console.log('[oauth] 📋 Requested scopes:', scopes)
    console.log('[oauth] 🔗 Return URL:', returnUrl)

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline', // Required to get refresh token
        scope: scopes,
        state: state,
        prompt: 'consent', // Force consent to ensure we get refresh token
    })

    return authUrl
}

/**
 * Handle OAuth callback
 * Exchange authorization code for tokens and store them
 */
async function handleOAuthCallback(code, state) {
    // Verify state
    const stateDoc = await admin.firestore().collection('googleOAuthStates').doc(state).get()

    if (!stateDoc.exists) {
        throw new Error('Invalid or expired state parameter')
    }

    const { userId, projectId, service, expiresAt, returnUrl } = stateDoc.data()

    // Check if state is expired
    if (expiresAt.toDate() < new Date()) {
        await admin.firestore().collection('googleOAuthStates').doc(state).delete()
        throw new Error('State parameter expired')
    }

    // Exchange code for tokens
    console.log('[oauth] Exchanging code for tokens...')
    console.log('[oauth] 📝 Service:', service)

    const oauth2Client = getOAuth2Client()
    const { tokens } = await oauth2Client.getToken(code)

    if (!tokens.access_token) {
        console.error('[oauth] ❌ No access token received from Google')
        throw new Error('No access token received from Google')
    }

    // Get user's email from Google
    oauth2Client.setCredentials(tokens)

    // We need to explicitly set the access token for the userinfo request
    const oauth2 = google.oauth2({
        version: 'v2',
        auth: oauth2Client,
    })

    let userInfoResponse
    let userInfo
    try {
        userInfoResponse = await oauth2Client.request({
            url: 'https://www.googleapis.com/oauth2/v2/userinfo',
        })
        userInfo = userInfoResponse.data
    } catch (error) {
        console.error('[oauth] ❌ Error fetching user info:', error)
        throw error
    }

    console.log('[oauth] 👤 Google User Info received:', {
        email: userInfo.email,
        id: userInfo.id,
    })

    // Store tokens keyed by the account-level connection id — reconnecting the same
    // account always lands on the same doc, deduping for free.
    const connectionService = googleServiceToConnectionService(service)
    const connectionId = buildConnectionId(connectionService, EMAIL_PROVIDER_GOOGLE, userInfo.email)
    const tokenDocId = `googleAuth_${connectionId}`

    const tokenData = {
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        tokenExpiry: tokens.expiry_date ? admin.firestore.Timestamp.fromMillis(tokens.expiry_date) : null,
        scopes: tokens.scope ? tokens.scope.split(' ') : [],
        email: userInfo.email,
        createdAt: admin.firestore.Timestamp.now(),
        lastUsed: admin.firestore.Timestamp.now(),
        service: service,
        connectionId,
    }

    await admin.firestore().collection('users').doc(userId).collection('private').doc(tokenDocId).set(tokenData)

    const userRef = admin.firestore().collection('users').doc(userId)
    const userDoc = await userRef.get()
    const userData = userDoc.exists ? userDoc.data() || {} : {}
    const existingApisConnected = userData.apisConnected || {}

    // Upsert the account-level connection. An existing entry (reconnect) keeps its
    // defaultProjectId and default-account flag; a new one takes the project chosen at
    // connect time and becomes the default account when none exists yet.
    const mapField = getConnectionsMapField(connectionService)
    const existingConnections =
        connectionService === CONNECTION_SERVICE_CALENDAR
            ? listCalendarConnections(userData)
            : listEmailConnections(userData)
    const existingEntry = (userData[mapField] || {})[connectionId] || null
    const hasAnyDefaultAccount = existingConnections.some(connection => connection.isDefaultAccount)
    const now = admin.firestore.Timestamp.now()

    const updateData = {
        [`${mapField}.${connectionId}.provider`]: EMAIL_PROVIDER_GOOGLE,
        [`${mapField}.${connectionId}.emailAddress`]: String(userInfo.email || '').toLowerCase(),
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

    // Keep the legacy per-project shape updated during the transition so not-yet-updated
    // clients still see the connection. (No cross-provider token deletes anymore — a
    // Google and a Microsoft account can coexist as separate connections.)
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
                EMAIL_PROVIDER_GOOGLE,
                userInfo.email,
                !hasExistingDefaultCalendar
            )
        )
    } else if (service === 'gmail') {
        const hasExistingDefaultEmail = hasExistingDefaultConnection(existingApisConnected, resolveEmailConnection)
        Object.assign(
            updateData,
            buildEmailConnectionUpdate(legacyProjectId, EMAIL_PROVIDER_GOOGLE, userInfo.email, !hasExistingDefaultEmail)
        )
    }

    await userRef.update(updateData)

    // Clean up state
    await admin.firestore().collection('googleOAuthStates').doc(state).delete()

    return {
        userId,
        projectId,
        service,
        connectionId,
        email: userInfo.email,
        returnUrl,
    }
}

/**
 * Get a fresh access token for the user
 * Automatically refreshes if expired
 * @param {string} userId
 * @param {string} connectionIdOrProjectId - account-level connection id (preferred) or
 *   a legacy projectId
 * @param {string} service - 'calendar' or 'gmail' (legacy projectId form only)
 */
async function getAccessToken(userId, connectionIdOrProjectId, service) {
    let tokenDoc = null
    let docRef = null
    let connectionId = null
    let projectId = null

    const privateCollection = admin.firestore().collection('users').doc(userId).collection('private')

    if (isConnectionId(connectionIdOrProjectId)) {
        connectionId = connectionIdOrProjectId
        service = service || (connectionId.startsWith('calendar_') ? 'calendar' : 'gmail')
    } else {
        projectId = connectionIdOrProjectId
        // Resolve the account-level connection for this project so migrated users hit
        // the connection-keyed token doc even when callers still pass a projectId.
        if (projectId && service) {
            const userData = await loadUserDataForConnections(userId)
            const [match] = findConnectionsForProject(userData, googleServiceToConnectionService(service), projectId)
            if (match && match.provider === EMAIL_PROVIDER_GOOGLE) connectionId = match.connectionId
        }
    }

    // 0. Account-level connection token
    if (connectionId) {
        const connectionDocRef = privateCollection.doc(`googleAuth_${connectionId}`)
        const connectionDoc = await connectionDocRef.get()
        if (connectionDoc.exists) {
            tokenDoc = connectionDoc
            docRef = connectionDocRef
        } else if (!projectId) {
            // Connection-id callers may still need the legacy docs of the connection's
            // default project (pre-migration users).
            const userData = await loadUserDataForConnections(userId)
            const connection = getConnection(userData, googleServiceToConnectionService(service), connectionId)
            projectId = connection?.defaultProjectId || null
        }
    }

    // 1. Try service-specific token
    if ((!tokenDoc || !tokenDoc.exists) && projectId && service) {
        docRef = privateCollection.doc(`googleAuth_${projectId}_${service}`)
        tokenDoc = await docRef.get()
    }

    // 2. Fallback to legacy project-specific token (combined)
    if ((!tokenDoc || !tokenDoc.exists) && projectId) {
        // Only fallback if we are looking for a project-specific token
        // We check the legacy doc `googleAuth_${projectId}`
        const legacyDocRef = privateCollection.doc(`googleAuth_${projectId}`)
        const legacyDoc = await legacyDocRef.get()

        if (legacyDoc.exists) {
            tokenDoc = legacyDoc
            docRef = legacyDocRef
        }
    }

    // 3. Fallback to global token (legacy)
    if (!tokenDoc || !tokenDoc.exists) {
        const globalDocRef = privateCollection.doc('googleAuth')
        const globalDoc = await globalDocRef.get()

        if (globalDoc.exists) {
            tokenDoc = globalDoc
            docRef = globalDocRef
        }
    }

    if (!tokenDoc || !tokenDoc.exists) {
        throw new Error(`User not authenticated with Google for ${service || 'any service'}`)
    }

    const tokenData = tokenDoc.data()
    const oauth2Client = getOAuth2Client()

    // Set credentials
    oauth2Client.setCredentials({
        refresh_token: tokenData.refreshToken,
        access_token: tokenData.accessToken,
        expiry_date: tokenData.tokenExpiry ? tokenData.tokenExpiry.toMillis() : null,
    })

    // Get access token (will auto-refresh if expired)
    let token
    try {
        const response = await oauth2Client.getAccessToken()
        token = response.token
    } catch (error) {
        // Handle invalid_grant (refresh token revoked or expired)
        if (error.response && error.response.data && error.response.data.error === 'invalid_grant') {
            console.warn(
                `[oauth] ⚠️ Invalid grant for user ${userId} (project: ${projectId}, service: ${service}, connection: ${connectionId}). Removing invalid token.`
            )

            // Delete the invalid token to prevent infinite loops
            await docRef.delete()

            // Also update the user's apisConnected flag to false
            const userRef = admin.firestore().collection('users').doc(userId)
            const updateData = {}
            if (connectionId) {
                // Flag the account-level connection so the UI can offer a reconnect.
                const mapField = getConnectionsMapField(googleServiceToConnectionService(service))
                updateData[`${mapField}.${connectionId}.authInvalid`] = true
            }
            if (projectId && service === 'calendar') {
                updateData[`apisConnected.${projectId}.calendar`] = false
                updateData[`apisConnected.${projectId}.calendarDefault`] = false
                updateData[`apisConnected.${projectId}.calendarProvider`] = admin.firestore.FieldValue.delete()
            } else if (projectId && service === 'gmail') {
                updateData[`apisConnected.${projectId}.gmail`] = false
                updateData[`apisConnected.${projectId}.gmailDefault`] = false
                updateData[`apisConnected.${projectId}.email`] = false
                updateData[`apisConnected.${projectId}.emailDefault`] = false
                updateData[`apisConnected.${projectId}.emailProvider`] = admin.firestore.FieldValue.delete()
                updateData[`apisConnected.${projectId}.emailAddress`] = admin.firestore.FieldValue.delete()
            } else if (projectId) {
                // Legacy fallback
                updateData[`apisConnected.${projectId}.calendar`] = false
                updateData[`apisConnected.${projectId}.calendarDefault`] = false
                updateData[`apisConnected.${projectId}.gmail`] = false
                updateData[`apisConnected.${projectId}.gmailDefault`] = false
            }

            if (Object.keys(updateData).length > 0) {
                await userRef.update(updateData)
            }

            throw new Error('Google OAuth token is invalid or revoked. Please reconnect.')
        }
        throw error
    }

    // Update last used timestamp and potentially new access token
    const updateData = {
        lastUsed: admin.firestore.Timestamp.now(),
    }

    // If token was refreshed, update it
    const credentials = oauth2Client.credentials
    if (credentials.access_token !== tokenData.accessToken) {
        updateData.accessToken = credentials.access_token
        if (credentials.expiry_date) {
            updateData.tokenExpiry = admin.firestore.Timestamp.fromMillis(credentials.expiry_date)
        }
    }

    await docRef.update(updateData)

    return token
}

// Revoke an account-level connection: revoke with Google, delete its token doc(s),
// remove the connection map entry, and clear every legacy apisConnected entry that
// pointed at this account.
async function revokeConnectionAccess(userId, connectionId) {
    const connectionService = connectionId.startsWith('calendar_')
        ? CONNECTION_SERVICE_CALENDAR
        : CONNECTION_SERVICE_EMAIL
    const mapField = getConnectionsMapField(connectionService)
    const legacyService = connectionService === CONNECTION_SERVICE_CALENDAR ? 'calendar' : 'gmail'
    const userData = await loadUserDataForConnections(userId)
    const connection = getConnection(userData, connectionService, connectionId)

    const privateCollection = admin.firestore().collection('users').doc(userId).collection('private')
    const docRef = privateCollection.doc(`googleAuth_${connectionId}`)
    const tokenDoc = await docRef.get()

    let tokenData = tokenDoc.exists ? tokenDoc.data() : null
    let legacyDocRef = null
    if (!tokenData && connection?.defaultProjectId) {
        legacyDocRef = privateCollection.doc(`googleAuth_${connection.defaultProjectId}_${legacyService}`)
        const legacyDoc = await legacyDocRef.get()
        if (legacyDoc.exists) tokenData = legacyDoc.data()
        else legacyDocRef = null
    }

    if (tokenData?.refreshToken) {
        try {
            await getOAuth2Client().revokeToken(tokenData.refreshToken)
        } catch (error) {
            console.error('Error revoking token with Google:', error)
            // Continue anyway to clean up our stored tokens
        }
    }
    if (tokenDoc.exists) await docRef.delete()
    if (legacyDocRef) await legacyDocRef.delete()

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
            updateData[`apisConnected.${legacyProjectId}.calendarEmail`] = admin.firestore.FieldValue.delete()
            updateData[`apisConnected.${legacyProjectId}.calendarProvider`] = admin.firestore.FieldValue.delete()
            updateData[`apisConnected.${legacyProjectId}.calendarDefault`] = false
        } else {
            updateData[`apisConnected.${legacyProjectId}.gmail`] = false
            updateData[`apisConnected.${legacyProjectId}.gmailEmail`] = admin.firestore.FieldValue.delete()
            updateData[`apisConnected.${legacyProjectId}.gmailDefault`] = false
            updateData[`apisConnected.${legacyProjectId}.email`] = false
            updateData[`apisConnected.${legacyProjectId}.emailProvider`] = admin.firestore.FieldValue.delete()
            updateData[`apisConnected.${legacyProjectId}.emailAddress`] = admin.firestore.FieldValue.delete()
            updateData[`apisConnected.${legacyProjectId}.emailDefault`] = false
        }
    })

    await admin.firestore().collection('users').doc(userId).update(updateData)
    return { success: true, message: 'Access revoked successfully' }
}

/**
 * Revoke Google OAuth access and delete stored tokens
 * Accepts an account-level connection id or a legacy (projectId, service) pair.
 */
async function revokeAccess(userId, projectId, service) {
    if (isConnectionId(projectId)) {
        return await revokeConnectionAccess(userId, projectId)
    }

    let tokenDoc = null
    let docRef = null

    // 1. Try service-specific token
    if (projectId && service) {
        docRef = admin
            .firestore()
            .collection('users')
            .doc(userId)
            .collection('private')
            .doc(`googleAuth_${projectId}_${service}`)
        tokenDoc = await docRef.get()
    }

    // If not found, check if we have a legacy token that covers this
    // Note: If we have a legacy token, revoking it will disconnect BOTH services if they share it.
    // This is a known limitation of migrating from combined to separate.
    // However, if the user connects separately, they get separate tokens.

    if (!tokenDoc || !tokenDoc.exists) {
        // Check legacy project token
        if (projectId) {
            const legacyDocRef = admin
                .firestore()
                .collection('users')
                .doc(userId)
                .collection('private')
                .doc(`googleAuth_${projectId}`)
            const legacyDoc = await legacyDocRef.get()
            if (legacyDoc.exists) {
                docRef = legacyDocRef
                tokenDoc = legacyDoc
            }
        }
    }

    if (!tokenDoc || !tokenDoc.exists) {
        // Just update the flag to false if no token found, to be safe
        const userRef = admin.firestore().collection('users').doc(userId)
        const updateData = {}
        if (service === 'calendar') {
            updateData[`apisConnected.${projectId}.calendar`] = false
            updateData[`apisConnected.${projectId}.calendarEmail`] = admin.firestore.FieldValue.delete()
            updateData[`apisConnected.${projectId}.calendarProvider`] = admin.firestore.FieldValue.delete()
            updateData[`apisConnected.${projectId}.calendarDefault`] = false
        } else if (service === 'gmail') {
            updateData[`apisConnected.${projectId}.gmail`] = false
            updateData[`apisConnected.${projectId}.gmailEmail`] = admin.firestore.FieldValue.delete()
            updateData[`apisConnected.${projectId}.gmailDefault`] = false
            updateData[`apisConnected.${projectId}.email`] = false
            updateData[`apisConnected.${projectId}.emailProvider`] = admin.firestore.FieldValue.delete()
            updateData[`apisConnected.${projectId}.emailAddress`] = admin.firestore.FieldValue.delete()
            updateData[`apisConnected.${projectId}.emailDefault`] = false
        }
        if (Object.keys(updateData).length > 0) {
            await userRef.update(updateData)
        }
        return { success: true, message: 'No tokens found, but connection flags cleared' }
    }

    const tokenData = tokenDoc.data()
    const oauth2Client = getOAuth2Client()

    // Revoke the refresh token with Google
    try {
        if (tokenData.refreshToken) {
            await oauth2Client.revokeToken(tokenData.refreshToken)
        }
    } catch (error) {
        console.error('Error revoking token with Google:', error)
        // Continue anyway to clean up our stored tokens
    }

    // Delete stored tokens
    await docRef.delete()

    // Update user's apisConnected flags
    const userRef = admin.firestore().collection('users').doc(userId)
    const updateData = {}

    // If we deleted a legacy token, we must disconnect BOTH because we lost the token for both
    // If we deleted a service-specific token, we only disconnect that service

    const isLegacyToken = docRef.id === `googleAuth_${projectId}` || docRef.id === 'googleAuth'

    if (isLegacyToken) {
        // Disconnect both for this project
        updateData[`apisConnected.${projectId}.calendar`] = false
        updateData[`apisConnected.${projectId}.gmail`] = false
        updateData[`apisConnected.${projectId}.calendarEmail`] = admin.firestore.FieldValue.delete()
        updateData[`apisConnected.${projectId}.calendarProvider`] = admin.firestore.FieldValue.delete()
        updateData[`apisConnected.${projectId}.calendarDefault`] = false
        updateData[`apisConnected.${projectId}.gmailEmail`] = admin.firestore.FieldValue.delete()
        updateData[`apisConnected.${projectId}.gmailDefault`] = false
        updateData[`apisConnected.${projectId}.email`] = false
        updateData[`apisConnected.${projectId}.emailProvider`] = admin.firestore.FieldValue.delete()
        updateData[`apisConnected.${projectId}.emailAddress`] = admin.firestore.FieldValue.delete()
        updateData[`apisConnected.${projectId}.emailDefault`] = false
    } else {
        // Service specific
        if (service === 'calendar') {
            updateData[`apisConnected.${projectId}.calendar`] = false
            updateData[`apisConnected.${projectId}.calendarEmail`] = admin.firestore.FieldValue.delete()
            updateData[`apisConnected.${projectId}.calendarProvider`] = admin.firestore.FieldValue.delete()
            updateData[`apisConnected.${projectId}.calendarDefault`] = false
        } else if (service === 'gmail') {
            updateData[`apisConnected.${projectId}.gmail`] = false
            updateData[`apisConnected.${projectId}.gmailEmail`] = admin.firestore.FieldValue.delete()
            updateData[`apisConnected.${projectId}.gmailDefault`] = false
            updateData[`apisConnected.${projectId}.email`] = false
            updateData[`apisConnected.${projectId}.emailProvider`] = admin.firestore.FieldValue.delete()
            updateData[`apisConnected.${projectId}.emailAddress`] = admin.firestore.FieldValue.delete()
            updateData[`apisConnected.${projectId}.emailDefault`] = false
        }
    }

    if (Object.keys(updateData).length > 0) {
        await userRef.update(updateData)
    }

    return { success: true, message: 'Access revoked successfully' }
}

// Resolve the account-level token doc id for a (projectId, service) or connection-id
// argument; returns null when no connection matches.
async function resolveConnectionTokenDocId(userId, connectionIdOrProjectId, service) {
    if (isConnectionId(connectionIdOrProjectId)) {
        return `googleAuth_${connectionIdOrProjectId}`
    }
    if (!connectionIdOrProjectId || !service) return null
    const userData = await loadUserDataForConnections(userId)
    const [match] = findConnectionsForProject(
        userData,
        googleServiceToConnectionService(service),
        connectionIdOrProjectId
    )
    return match && match.provider === EMAIL_PROVIDER_GOOGLE ? `googleAuth_${match.connectionId}` : null
}

/**
 * Check if user has valid Google OAuth credentials
 * Accepts an account-level connection id or a legacy (projectId, service) pair.
 */
async function hasValidCredentials(userId, projectId, service) {
    let tokenDoc = null

    // 0. Check account-level connection token
    const connectionTokenDocId = await resolveConnectionTokenDocId(userId, projectId, service)
    if (connectionTokenDocId) {
        tokenDoc = await admin
            .firestore()
            .collection('users')
            .doc(userId)
            .collection('private')
            .doc(connectionTokenDocId)
            .get()
        if (tokenDoc.exists) return true
    }
    if (isConnectionId(projectId)) {
        // Pre-migration connection-id callers fall through to the legacy docs of the
        // connection's default project.
        const userData = await loadUserDataForConnections(userId)
        const connectionService = projectId.startsWith('calendar_')
            ? CONNECTION_SERVICE_CALENDAR
            : CONNECTION_SERVICE_EMAIL
        const connection = getConnection(userData, connectionService, projectId)
        service = service || (connectionService === CONNECTION_SERVICE_CALENDAR ? 'calendar' : 'gmail')
        projectId = connection?.defaultProjectId || null
    }

    // 1. Check service specific
    if (projectId && service) {
        tokenDoc = await admin
            .firestore()
            .collection('users')
            .doc(userId)
            .collection('private')
            .doc(`googleAuth_${projectId}_${service}`)
            .get()
    }

    if (tokenDoc && tokenDoc.exists) return true

    // 2. Check legacy project
    if (projectId) {
        tokenDoc = await admin
            .firestore()
            .collection('users')
            .doc(userId)
            .collection('private')
            .doc(`googleAuth_${projectId}`)
            .get()
    }

    if (tokenDoc && tokenDoc.exists) return true

    // 3. Check global
    tokenDoc = await admin.firestore().collection('users').doc(userId).collection('private').doc('googleAuth').get()

    if (tokenDoc && tokenDoc.exists) return true

    return false
}

async function getCredentialStatus(userId, projectId, service) {
    let tokenDoc = null

    // 0. Check account-level connection token
    const connectionTokenDocId = await resolveConnectionTokenDocId(userId, projectId, service)
    if (connectionTokenDocId) {
        const connectionDoc = await admin
            .firestore()
            .collection('users')
            .doc(userId)
            .collection('private')
            .doc(connectionTokenDocId)
            .get()
        if (connectionDoc.exists) tokenDoc = connectionDoc
    }
    if (isConnectionId(projectId)) {
        const userData = await loadUserDataForConnections(userId)
        const connectionService = projectId.startsWith('calendar_')
            ? CONNECTION_SERVICE_CALENDAR
            : CONNECTION_SERVICE_EMAIL
        const connection = getConnection(userData, connectionService, projectId)
        service = service || (connectionService === CONNECTION_SERVICE_CALENDAR ? 'calendar' : 'gmail')
        projectId = connection?.defaultProjectId || null
    }

    if ((!tokenDoc || !tokenDoc.exists) && projectId && service) {
        tokenDoc = await admin
            .firestore()
            .collection('users')
            .doc(userId)
            .collection('private')
            .doc(`googleAuth_${projectId}_${service}`)
            .get()
    }

    if ((!tokenDoc || !tokenDoc.exists) && projectId) {
        tokenDoc = await admin
            .firestore()
            .collection('users')
            .doc(userId)
            .collection('private')
            .doc(`googleAuth_${projectId}`)
            .get()
    }

    if (!tokenDoc || !tokenDoc.exists) {
        tokenDoc = await admin.firestore().collection('users').doc(userId).collection('private').doc('googleAuth').get()
    }

    if (!tokenDoc || !tokenDoc.exists) {
        return {
            hasCredentials: false,
            email: null,
            scopes: [],
            hasModifyScope: false,
        }
    }

    const tokenData = tokenDoc.data() || {}
    const scopes = Array.isArray(tokenData.scopes) ? tokenData.scopes : []

    return {
        hasCredentials: true,
        email: tokenData.email || null,
        scopes,
        hasModifyScope: scopes.includes('https://www.googleapis.com/auth/gmail.modify'),
    }
}

module.exports = {
    initiateOAuth,
    handleOAuthCallback,
    getAccessToken,
    revokeAccess,
    hasValidCredentials,
    getCredentialStatus,
    getOAuth2Client,
    isConnectionId,
    __private__: {
        hasExistingDefaultConnection,
    },
}
function hasExistingDefaultConnection(apisConnected = {}, defaultFieldOrResolver) {
    if (typeof defaultFieldOrResolver === 'function') {
        return hasExistingResolvedDefaultConnection(apisConnected, defaultFieldOrResolver)
    }
    return Object.values(apisConnected).some(connection => connection?.[defaultFieldOrResolver] === true)
}
