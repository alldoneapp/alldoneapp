const { google } = require('googleapis')
const admin = require('firebase-admin')
const { getEnvFunctions } = require('../envFunctionsHelper.js')

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
    'https://www.googleapis.com/auth/gmail.readonly',
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
async function initiateOAuth(userId, projectId, service) {
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

    // Store state in Firestore to verify callback
    // We include the service in the state so we know what we are connecting
    const state = `${userId}:${projectId}:${service || 'calendar'}:${Date.now()}`
    const stateDoc = {
        userId,
        projectId,
        service: service || 'calendar',
        createdAt: admin.firestore.Timestamp.now(),
        expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 10 * 60 * 1000)), // 10 minutes
    }

    await admin.firestore().collection('googleOAuthStates').doc(state).set(stateDoc)

    // Generate authorization URL
    console.log('[oauth] 🚀 Initiating OAuth flow...')
    console.log('[oauth] 📋 Service:', service)
    console.log('[oauth] 📋 Requested scopes:', scopes)

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

    const { userId, projectId, service, expiresAt } = stateDoc.data()

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

    // Store tokens in Firestore (in user's private subcollection)
    // Use service-specific document ID
    const tokenDocId = `googleAuth_${projectId}_${service}`

    const tokenData = {
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        tokenExpiry: tokens.expiry_date ? admin.firestore.Timestamp.fromMillis(tokens.expiry_date) : null,
        scopes: tokens.scope ? tokens.scope.split(' ') : [],
        email: userInfo.email,
        createdAt: admin.firestore.Timestamp.now(),
        lastUsed: admin.firestore.Timestamp.now(),
        service: service,
    }

    await admin.firestore().collection('users').doc(userId).collection('private').doc(tokenDocId).set(tokenData)

    // Update user's apisConnected flag
    const userRef = admin.firestore().collection('users').doc(userId)

    const updateData = {}
    if (service === 'calendar') {
        updateData[`apisConnected.${projectId}.calendar`] = true
        updateData[`apisConnected.${projectId}.calendarEmail`] = userInfo.email
    } else if (service === 'gmail') {
        updateData[`apisConnected.${projectId}.gmail`] = true
    }

    await userRef.update(updateData)

    // Clean up state
    await admin.firestore().collection('googleOAuthStates').doc(state).delete()

    return {
        userId,
        projectId,
        service,
        email: userInfo.email,
    }
}

/**
 * Get a fresh access token for the user
 * Automatically refreshes if expired
 * @param {string} userId
 * @param {string} projectId
 * @param {string} service - 'calendar' or 'gmail'
 */
async function getAccessToken(userId, projectId, service) {
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

    // 2. Fallback to legacy project-specific token (combined)
    if ((!tokenDoc || !tokenDoc.exists) && projectId) {
        // Only fallback if we are looking for a project-specific token
        // We check the legacy doc `googleAuth_${projectId}`
        const legacyDocRef = admin
            .firestore()
            .collection('users')
            .doc(userId)
            .collection('private')
            .doc(`googleAuth_${projectId}`)
        const legacyDoc = await legacyDocRef.get()

        if (legacyDoc.exists) {
            tokenDoc = legacyDoc
            docRef = legacyDocRef
        }
    }

    // 3. Fallback to global token (legacy)
    if (!tokenDoc || !tokenDoc.exists) {
        const globalDocRef = admin.firestore().collection('users').doc(userId).collection('private').doc('googleAuth')
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
                `[oauth] ⚠️ Invalid grant for user ${userId} (project: ${projectId}, service: ${service}). Removing invalid token.`
            )

            // Delete the invalid token to prevent infinite loops
            await docRef.delete()

            // Also update the user's apisConnected flag to false
            const userRef = admin.firestore().collection('users').doc(userId)
            const updateData = {}
            if (service === 'calendar') {
                updateData[`apisConnected.${projectId}.calendar`] = false
            } else if (service === 'gmail') {
                updateData[`apisConnected.${projectId}.gmail`] = false
            } else if (projectId) {
                // Legacy fallback
                updateData[`apisConnected.${projectId}.calendar`] = false
                updateData[`apisConnected.${projectId}.gmail`] = false
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

/**
 * Revoke Google OAuth access and delete stored tokens
 */
async function revokeAccess(userId, projectId, service) {
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
        } else if (service === 'gmail') {
            updateData[`apisConnected.${projectId}.gmail`] = false
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
    } else {
        // Service specific
        if (service === 'calendar') {
            updateData[`apisConnected.${projectId}.calendar`] = false
            updateData[`apisConnected.${projectId}.calendarEmail`] = admin.firestore.FieldValue.delete()
        } else if (service === 'gmail') {
            updateData[`apisConnected.${projectId}.gmail`] = false
        }
    }

    if (Object.keys(updateData).length > 0) {
        await userRef.update(updateData)
    }

    return { success: true, message: 'Access revoked successfully' }
}

/**
 * Check if user has valid Google OAuth credentials
 */
async function hasValidCredentials(userId, projectId, service) {
    let tokenDoc = null

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

module.exports = {
    initiateOAuth,
    handleOAuthCallback,
    getAccessToken,
    revokeAccess,
    hasValidCredentials,
    getOAuth2Client,
}
