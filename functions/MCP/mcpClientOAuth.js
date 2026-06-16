/**
 * OAuth (authorization-code + PKCE) flow for connecting an assistant to an
 * external MCP server that requires OAuth. Runs server-side so the token
 * exchange isn't blocked by browser CORS, and so the per-server client secret
 * (if any) never reaches the browser.
 *
 * Flow:
 *   1. beginMcpOAuth  (callable)  -> discover + dynamic-register + build auth URL,
 *                                    stash a pending session keyed by `state`.
 *   2. user visits authorizationUrl in a popup, approves, and the AS redirects to
 *      mcpClientOAuthCallback (onRequest) with ?code&state.
 *   3. mcpClientOAuthCallback     -> exchange code for tokens, store on the session,
 *                                    postMessage the opener + close.
 *   4. completeMcpOAuth (callable)-> return the tokens (+ non-secret OAuth context
 *                                    needed for later refresh) and delete the session.
 *
 * The returned bundle is handed straight to connectAssistantMcpServer as the
 * server's `secret`.
 */

const admin = require('firebase-admin')
const { HttpsError } = require('firebase-functions/v2/https')
const { v4: uuidv4 } = require('uuid')
const { getBaseUrl } = require('../Utils/HelperFunctionsCloud')

const SESSION_TTL_MS = 10 * 60 * 1000 // 10 minutes to complete the dance
const CLIENT_NAME = 'Alldone Assistant'

let authModulePromise = null
function loadAuth() {
    if (!authModulePromise) {
        authModulePromise = import('@modelcontextprotocol/sdk/client/auth.js')
    }
    return authModulePromise
}

// Redirect URI is served from the web origin via a hosting rewrite to the
// mcpClientOAuthCallback function (see firebase.json). Same-origin as the app so
// the popup can postMessage the opener.
function getRedirectUri() {
    return `${getBaseUrl()}/mcpClientOAuthCallback`
}

function sessionRef(state) {
    return admin.firestore().doc(`mcpOAuthSessions/${state}`)
}

function expiresAtFromTokens(tokens) {
    const expiresIn = Number(tokens && tokens.expires_in)
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) return null
    return Date.now() + expiresIn * 1000
}

/**
 * Step 1 — discover the authorization server, obtain client credentials (either a
 * caller-supplied pre-registered client, or via Dynamic Client Registration), and
 * build the authorization URL. Returns { authorizationUrl, state }.
 *
 * @param clientId      Optional pre-registered OAuth client_id. When provided, DCR
 *                      is skipped (use this for servers that don't support RFC 7591).
 * @param clientSecret  Optional client secret for a confidential pre-registered client.
 *                      Leave blank for a public client (PKCE only).
 * @param scope         Optional space-separated scopes to request.
 */
async function beginMcpOAuth({ userId, serverUrl, clientId, clientSecret, scope }) {
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
    const url = String(serverUrl || '').trim()
    if (!url) throw new HttpsError('invalid-argument', 'A server URL is required.')
    const requestedScope = String(scope || '').trim() || undefined

    const auth = await loadAuth()
    const redirectUri = getRedirectUri()

    let serverInfo
    try {
        serverInfo = await auth.discoverOAuthServerInfo(url)
    } catch (err) {
        throw new HttpsError('failed-precondition', `OAuth discovery failed: ${String(err && err.message)}`)
    }
    const authorizationServerUrl = serverInfo.authorizationServerUrl
    const metadata = serverInfo.authorizationServerMetadata
    const resourceMetadata = serverInfo.resourceMetadata
    const resource = resourceMetadata && resourceMetadata.resource ? new URL(resourceMetadata.resource) : undefined

    let clientInformation
    const presetClientId = String(clientId || '').trim()
    if (presetClientId) {
        // Pre-registered client supplied by the user — skip DCR.
        const presetSecret = String(clientSecret || '').trim()
        clientInformation = {
            client_id: presetClientId,
            redirect_uris: [redirectUri],
            ...(presetSecret ? { client_secret: presetSecret } : {}),
        }
    } else {
        try {
            clientInformation = await auth.registerClient(authorizationServerUrl, {
                metadata,
                clientMetadata: {
                    client_name: CLIENT_NAME,
                    redirect_uris: [redirectUri],
                    grant_types: ['authorization_code', 'refresh_token'],
                    response_types: ['code'],
                    token_endpoint_auth_method: 'none',
                },
                scope: requestedScope,
            })
        } catch (err) {
            throw new HttpsError(
                'failed-precondition',
                `OAuth dynamic client registration failed. This server may require a pre-registered client — ` +
                    `enter a Client ID in the OAuth options and try again. (${String(err && err.message)})`
            )
        }
    }

    const state = uuidv4()
    const { authorizationUrl, codeVerifier } = await auth.startAuthorization(authorizationServerUrl, {
        metadata,
        clientInformation,
        redirectUrl: redirectUri,
        state,
        scope: requestedScope,
        resource,
    })

    await sessionRef(state).set({
        userId,
        serverUrl: url,
        authorizationServerUrl,
        metadata: metadata || null,
        clientInformation,
        codeVerifier,
        redirectUri,
        resource: resource ? resource.toString() : null,
        status: 'pending',
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_TTL_MS,
    })

    return { authorizationUrl: authorizationUrl.toString(), state }
}

/**
 * Step 3 — exchange the authorization code for tokens (called from the onRequest
 * callback handler). Persists tokens on the session and marks it complete.
 */
async function exchangeMcpOAuthCode({ code, state }) {
    if (!code || !state) throw new Error('Missing code or state')
    const snap = await sessionRef(state).get()
    if (!snap.exists) throw new Error('Unknown or expired OAuth session')
    const session = snap.data() || {}
    if (session.status === 'complete') return // idempotent
    if (Date.now() > (session.expiresAt || 0)) throw new Error('OAuth session expired')

    const auth = await loadAuth()
    const tokens = await auth.exchangeAuthorization(session.authorizationServerUrl, {
        metadata: session.metadata || undefined,
        clientInformation: session.clientInformation,
        authorizationCode: code,
        codeVerifier: session.codeVerifier,
        redirectUri: session.redirectUri,
        resource: session.resource ? new URL(session.resource) : undefined,
    })

    await sessionRef(state).set(
        {
            status: 'complete',
            tokens: {
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token || null,
                expiresAt: expiresAtFromTokens(tokens),
                scope: tokens.scope || null,
            },
            completedAt: Date.now(),
        },
        { merge: true }
    )
}

/**
 * Step 4 — the client collects the tokens once the popup signals completion.
 * Returns the secret bundle for connectAssistantMcpServer and deletes the session.
 */
async function completeMcpOAuth({ userId, state }) {
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
    if (!state) throw new HttpsError('invalid-argument', 'A state is required.')

    const snap = await sessionRef(state).get()
    if (!snap.exists) throw new HttpsError('not-found', 'OAuth session not found or already used.')
    const session = snap.data() || {}
    if (session.userId !== userId) throw new HttpsError('permission-denied', 'This OAuth session is not yours.')
    if (session.status !== 'complete') {
        // Still pending — let the client keep polling.
        return { status: session.status || 'pending' }
    }

    const tokens = session.tokens || {}
    // Delete the one-time session now that the tokens have been claimed.
    await sessionRef(state)
        .delete()
        .catch(() => {})

    return {
        status: 'complete',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresAt: tokens.expiresAt || null,
        // Non-secret context required to refresh the token later. Stored on the
        // assistant's server-only secret doc by connectAssistantMcpServer.
        oauthContext: {
            authorizationServerUrl: session.authorizationServerUrl,
            clientInformation: session.clientInformation,
            metadata: session.metadata || null,
            resource: session.resource || null,
        },
    }
}

/**
 * Refresh an expired OAuth access token using the stored refresh token +
 * OAuth context. Returns updated token fields, or null if refresh isn't possible.
 */
async function refreshMcpOAuthTokens(secret) {
    if (!secret || secret.authType !== 'oauth' || !secret.refreshToken) return null
    const ctx = secret.oauthContext
    if (!ctx || !ctx.authorizationServerUrl || !ctx.clientInformation) return null

    const auth = await loadAuth()
    const tokens = await auth.refreshAuthorization(ctx.authorizationServerUrl, {
        metadata: ctx.metadata || undefined,
        clientInformation: ctx.clientInformation,
        refreshToken: secret.refreshToken,
        resource: ctx.resource ? new URL(ctx.resource) : undefined,
    })

    return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || secret.refreshToken,
        expiresAt: expiresAtFromTokens(tokens),
        tokenLast4: String(tokens.access_token || '').slice(-4),
    }
}

module.exports = {
    beginMcpOAuth,
    exchangeMcpOAuthCode,
    completeMcpOAuth,
    refreshMcpOAuthTokens,
}
