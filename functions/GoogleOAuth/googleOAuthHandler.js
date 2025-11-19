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

// Scopes required for Calendar and Gmail
const SCOPES = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.labels',
]

/**
 * Initiate OAuth flow
 * Returns the authorization URL to redirect the user to
 */
async function initiateOAuth(userId, projectId) {
    const oauth2Client = getOAuth2Client()

    // Store state in Firestore to verify callback
    const state = `${userId}:${projectId}:${Date.now()}`
    const stateDoc = {
        userId,
        projectId,
        createdAt: admin.firestore.Timestamp.now(),
        expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 10 * 60 * 1000)), // 10 minutes
    }

    await admin.firestore().collection('googleOAuthStates').doc(state).set(stateDoc)

    // Generate authorization URL
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline', // Required to get refresh token
        scope: SCOPES,
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

    const { userId, projectId, expiresAt } = stateDoc.data()

    // Check if state is expired
    if (expiresAt.toDate() < new Date()) {
        await admin.firestore().collection('googleOAuthStates').doc(state).delete()
        throw new Error('State parameter expired')
    }

    // Exchange code for tokens
    console.log('[oauth] Exchanging code for tokens...')
    const oauth2Client = getOAuth2Client()
    const { tokens } = await oauth2Client.getToken(code)

    console.log('[oauth] 🔑 OAuth Tokens received:', {
        hasAccessToken: !!tokens.access_token,
        accessTokenLength: tokens.access_token ? tokens.access_token.length : 0,
        hasRefreshToken: !!tokens.refresh_token,
        expiryDate: tokens.expiry_date,
        scopes: tokens.scope,
        tokenType: tokens.token_type,
    })

    if (!tokens.access_token) {
        console.error('[oauth] ❌ No access token received from Google')
        throw new Error('No access token received from Google')
    }

    // Get user's email from Google
    oauth2Client.setCredentials(tokens)
    // We need to explicitly set the access token for the userinfo request
    // Although setCredentials sets it on the client, the oauth2 service instance might need it explicitly if not sharing the auth client correctly
    const oauth2 = google.oauth2({
        version: 'v2',
        auth: oauth2Client,
    })

    // The tokens object contains access_token which is what we need
    console.log('[oauth] Fetching user info from Google...')
    const { data: userInfo } = await oauth2.userinfo.get()

    console.log('[oauth] 👤 Google User Info received:', {
        email: userInfo.email,
        id: userInfo.id,
        verified_email: userInfo.verified_email,
    })

    // Store tokens in Firestore (in user's private subcollection)
    const tokenData = {
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        tokenExpiry: tokens.expiry_date ? admin.firestore.Timestamp.fromMillis(tokens.expiry_date) : null,
        scopes: SCOPES,
        email: userInfo.email,
        createdAt: admin.firestore.Timestamp.now(),
        lastUsed: admin.firestore.Timestamp.now(),
    }

    await admin.firestore().collection('users').doc(userId).collection('private').doc('googleAuth').set(tokenData)

    // Update user's apisConnected flag
    const userRef = admin.firestore().collection('users').doc(userId)
    await userRef.update({
        [`apisConnected.${projectId}.calendar`]: true,
        [`apisConnected.${projectId}.gmail`]: true,
        [`apisConnected.${projectId}.calendarEmail`]: userInfo.email,
    })

    // Clean up state
    await admin.firestore().collection('googleOAuthStates').doc(state).delete()

    return {
        userId,
        projectId,
        email: userInfo.email,
    }
}

/**
 * Get a fresh access token for the user
 * Automatically refreshes if expired
 */
async function getAccessToken(userId) {
    const tokenDoc = await admin
        .firestore()
        .collection('users')
        .doc(userId)
        .collection('private')
        .doc('googleAuth')
        .get()

    if (!tokenDoc.exists) {
        throw new Error('User not authenticated with Google')
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
    const { token } = await oauth2Client.getAccessToken()

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

    await admin.firestore().collection('users').doc(userId).collection('private').doc('googleAuth').update(updateData)

    return token
}

/**
 * Revoke Google OAuth access and delete stored tokens
 */
async function revokeAccess(userId, projectId) {
    const tokenDoc = await admin
        .firestore()
        .collection('users')
        .doc(userId)
        .collection('private')
        .doc('googleAuth')
        .get()

    if (!tokenDoc.exists) {
        return { success: true, message: 'No tokens to revoke' }
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
    await admin.firestore().collection('users').doc(userId).collection('private').doc('googleAuth').delete()

    // Update user's apisConnected flags
    if (projectId) {
        const userRef = admin.firestore().collection('users').doc(userId)
        await userRef.update({
            [`apisConnected.${projectId}.calendar`]: false,
            [`apisConnected.${projectId}.gmail`]: false,
            [`apisConnected.${projectId}.calendarEmail`]: admin.firestore.FieldValue.delete(),
        })
    } else {
        // If no projectId provided, remove all calendar connections
        const userDoc = await admin.firestore().collection('users').doc(userId).get()
        const userData = userDoc.data()
        const apisConnected = userData.apisConnected || {}

        const updates = {}
        Object.keys(apisConnected).forEach(pid => {
            if (apisConnected[pid].calendar || apisConnected[pid].gmail) {
                updates[`apisConnected.${pid}.calendar`] = false
                updates[`apisConnected.${pid}.gmail`] = false
                updates[`apisConnected.${pid}.calendarEmail`] = admin.firestore.FieldValue.delete()
            }
        })

        if (Object.keys(updates).length > 0) {
            await admin.firestore().collection('users').doc(userId).update(updates)
        }
    }

    return { success: true, message: 'Access revoked successfully' }
}

/**
 * Check if user has valid Google OAuth credentials
 */
async function hasValidCredentials(userId) {
    const tokenDoc = await admin
        .firestore()
        .collection('users')
        .doc(userId)
        .collection('private')
        .doc('googleAuth')
        .get()

    if (!tokenDoc.exists) {
        return false
    }

    const tokenData = tokenDoc.data()
    return !!tokenData.refreshToken
}

module.exports = {
    initiateOAuth,
    handleOAuthCallback,
    getAccessToken,
    revokeAccess,
    hasValidCredentials,
    getOAuth2Client,
}
