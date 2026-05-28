'use strict'

const admin = require('firebase-admin')
const { getEnvFunctions } = require('../envFunctionsHelper.js')
const {
    CALENDAR_PROVIDER_MICROSOFT,
    EMAIL_PROVIDER_MICROSOFT,
    buildCalendarConnectionUpdate,
    buildEmailConnectionUpdate,
    hasExistingDefaultConnection,
    resolveCalendarConnection,
    resolveEmailConnection,
} = require('../Integrations/providerConnections')

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

async function initiateOAuth(userId, projectId, service, returnUrl) {
    const { clientId, redirectUri } = getMicrosoftOAuthConfig()
    const scopes = getScopes(service)
    const state = `${userId}:${projectId}:${service}:${Date.now()}`

    await admin
        .firestore()
        .collection('microsoftOAuthStates')
        .doc(state)
        .set({
            userId,
            projectId,
            service,
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

    await tokenDocRef(userId, projectId, service).set({
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
    })

    const userRef = admin.firestore().collection('users').doc(userId)
    const userDoc = await userRef.get()
    const existingApisConnected = userDoc.exists ? userDoc.data()?.apisConnected || {} : {}
    const updateData = {}

    if (service === 'calendar') {
        const hasExistingDefaultCalendar = hasExistingDefaultConnection(
            existingApisConnected,
            resolveCalendarConnection
        )
        Object.assign(
            updateData,
            buildCalendarConnectionUpdate(projectId, CALENDAR_PROVIDER_MICROSOFT, email, !hasExistingDefaultCalendar)
        )
        await admin
            .firestore()
            .collection('users')
            .doc(userId)
            .collection('private')
            .doc(`googleAuth_${projectId}_calendar`)
            .delete()
            .catch(() => null)
    } else {
        const hasExistingDefaultEmail = hasExistingDefaultConnection(existingApisConnected, resolveEmailConnection)
        Object.assign(
            updateData,
            buildEmailConnectionUpdate(projectId, EMAIL_PROVIDER_MICROSOFT, email, !hasExistingDefaultEmail)
        )
        await admin
            .firestore()
            .collection('users')
            .doc(userId)
            .collection('private')
            .doc(`googleAuth_${projectId}_gmail`)
            .delete()
            .catch(() => null)
    }

    await userRef.update(updateData)
    await stateRef.delete()

    return { userId, projectId, service, email, returnUrl }
}

async function getAccessToken(userId, projectId, service) {
    const ref = tokenDocRef(userId, projectId, service)
    const tokenDoc = await ref.get()
    if (!tokenDoc.exists) throw new Error(`User not authenticated with Microsoft for ${service}`)

    const data = tokenDoc.data() || {}
    const expiresAt = data.tokenExpiry?.toMillis ? data.tokenExpiry.toMillis() : 0
    if (data.accessToken && expiresAt - Date.now() > 2 * 60 * 1000) {
        await ref.update({ lastUsed: admin.firestore.Timestamp.now() })
        return data.accessToken
    }

    if (!data.refreshToken) throw new Error('Microsoft OAuth refresh token is missing. Please reconnect.')

    const { clientId, clientSecret, redirectUri } = getMicrosoftOAuthConfig()
    const refreshed = await postTokenRequest({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: data.refreshToken,
        redirect_uri: redirectUri,
        grant_type: 'refresh_token',
        scope: getScopes(service).join(' '),
    })

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

async function revokeAccess(userId, projectId, service) {
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
    const tokenDoc = await tokenDocRef(userId, projectId, service).get()
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
