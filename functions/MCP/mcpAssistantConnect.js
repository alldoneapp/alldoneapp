const admin = require('firebase-admin')
const { HttpsError } = require('firebase-functions/v2/https')
const { v4: uuidv4 } = require('uuid')

const mcpClient = require('../Assistant/mcpClient')

const GLOBAL_PROJECT_ID = 'globalProject'

const VALID_TRANSPORTS = new Set(['http', 'sse'])
const VALID_AUTH_TYPES = new Set(['none', 'bearer', 'oauth'])
const MAX_SERVERS_PER_ASSISTANT = 10
const MAX_LABEL_LENGTH = 80

const isObject = value => value && typeof value === 'object' && !Array.isArray(value)

/**
 * Secret doc path for a single (assistant, server) pair. Lives under the
 * assistant subtree but in a `mcpSecrets` subcollection that has NO client read
 * rule (denied by the catch-all in firestore.rules) — only the Admin SDK in
 * Cloud Functions can touch it. The non-secret config lives on the assistant doc
 * itself (`mcpServers` array), which project members can read.
 */
function buildSecretDocRef(projectId, assistantId, serverId) {
    const secretId = `${assistantId}__${serverId}`
    return admin.firestore().doc(`assistants/${projectId}/mcpSecrets/${secretId}`)
}

function assistantDocRef(projectId, assistantId) {
    return admin.firestore().doc(`assistants/${projectId}/items/${assistantId}`)
}

/**
 * Permission gate for editing an assistant's MCP config:
 *  - project assistants -> caller must be a member of the project
 *  - global assistants  -> caller must be the administrator
 */
async function assertCanEditAssistant(projectId, assistantId, userId) {
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
    if (!projectId) throw new HttpsError('invalid-argument', 'A projectId is required.')
    if (!assistantId) throw new HttpsError('invalid-argument', 'An assistantId is required.')

    const db = admin.firestore()

    if (projectId === GLOBAL_PROJECT_ID) {
        const adminDoc = await db.doc('roles/administrator').get()
        if (!adminDoc.exists || (adminDoc.data() || {}).userId !== userId) {
            throw new HttpsError('permission-denied', 'Only an administrator can edit global assistants.')
        }
    } else {
        const projectSnap = await db.doc(`projects/${projectId}`).get()
        if (!projectSnap.exists) throw new HttpsError('not-found', 'Project not found.')
        const userIds = Array.isArray((projectSnap.data() || {}).userIds) ? projectSnap.data().userIds : []
        if (!userIds.includes(userId)) {
            throw new HttpsError('permission-denied', 'You are not a member of this project.')
        }
    }

    const assistantSnap = await assistantDocRef(projectId, assistantId).get()
    if (!assistantSnap.exists) throw new HttpsError('not-found', 'Assistant not found.')
    return assistantSnap
}

/** Validate + normalize the client-supplied server config. */
function normalizeServerInput(rawServer) {
    if (!isObject(rawServer)) throw new HttpsError('invalid-argument', 'A server config is required.')

    const label = String(rawServer.label || '')
        .trim()
        .slice(0, MAX_LABEL_LENGTH)
    if (!label) throw new HttpsError('invalid-argument', 'A label is required.')

    const url = String(rawServer.url || '').trim()
    if (!url) throw new HttpsError('invalid-argument', 'A server URL is required.')
    let parsedUrl
    try {
        parsedUrl = new URL(url)
    } catch (_) {
        throw new HttpsError('invalid-argument', 'That does not look like a valid URL.')
    }
    const isLocalhost = parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1'
    if (parsedUrl.protocol !== 'https:' && !(parsedUrl.protocol === 'http:' && isLocalhost)) {
        throw new HttpsError('invalid-argument', 'The server URL must use https://.')
    }

    const transport = String(rawServer.transport || 'http').toLowerCase()
    if (!VALID_TRANSPORTS.has(transport)) {
        throw new HttpsError('invalid-argument', `Unsupported transport: ${transport}`)
    }

    const authType = String(rawServer.authType || 'none').toLowerCase()
    if (!VALID_AUTH_TYPES.has(authType)) {
        throw new HttpsError('invalid-argument', `Unsupported auth type: ${authType}`)
    }

    const id = String(rawServer.id || '').trim() || uuidv4()

    return { id, label, url: parsedUrl.toString(), transport, authType }
}

/**
 * Build the secret payload to persist + the secret object to validate with,
 * from the client-supplied `secret` for a given authType.
 */
function buildSecretRecords(authType, rawSecret) {
    const secret = isObject(rawSecret) ? rawSecret : {}

    if (authType === 'none') {
        return { toStore: null, toValidate: null, tokenLast4: '' }
    }

    if (authType === 'bearer') {
        const token = String(secret.token || '').trim()
        if (!token) throw new HttpsError('invalid-argument', 'A token is required for bearer auth.')
        return {
            toStore: { authType, token, tokenLast4: token.slice(-4), createdAt: Date.now() },
            toValidate: { token },
            tokenLast4: token.slice(-4),
        }
    }

    // oauth: tokens are obtained by the OAuth flow and handed to us here, along
    // with the non-secret `oauthContext` needed to refresh them later.
    const accessToken = String(secret.accessToken || secret.token || '').trim()
    if (!accessToken) throw new HttpsError('invalid-argument', 'An access token is required for OAuth.')
    const refreshToken = String(secret.refreshToken || '').trim()
    const expiresAt = Number(secret.expiresAt) || null
    return {
        toStore: {
            authType,
            accessToken,
            refreshToken: refreshToken || null,
            expiresAt,
            oauthContext: isObject(secret.oauthContext) ? secret.oauthContext : null,
            tokenLast4: accessToken.slice(-4),
            createdAt: Date.now(),
        },
        toValidate: { accessToken },
        tokenLast4: accessToken.slice(-4),
    }
}

/** Upsert a server entry into the assistant doc's `mcpServers` array. */
async function upsertServerEntry(projectId, assistantId, entry) {
    const ref = assistantDocRef(projectId, assistantId)
    await admin.firestore().runTransaction(async tx => {
        const snap = await tx.get(ref)
        if (!snap.exists) throw new HttpsError('not-found', 'Assistant not found.')
        const data = snap.data() || {}
        const servers = Array.isArray(data.mcpServers) ? data.mcpServers.slice() : []
        const idx = servers.findIndex(s => isObject(s) && s.id === entry.id)
        if (idx >= 0) {
            servers[idx] = { ...servers[idx], ...entry }
        } else {
            if (servers.length >= MAX_SERVERS_PER_ASSISTANT) {
                throw new HttpsError(
                    'failed-precondition',
                    `An assistant can have at most ${MAX_SERVERS_PER_ASSISTANT} MCP servers.`
                )
            }
            servers.push(entry)
        }
        tx.update(ref, { mcpServers: servers, lastEditionDate: Date.now() })
    })
}

async function removeServerEntry(projectId, assistantId, serverId) {
    const ref = assistantDocRef(projectId, assistantId)
    await admin.firestore().runTransaction(async tx => {
        const snap = await tx.get(ref)
        if (!snap.exists) return
        const data = snap.data() || {}
        const servers = Array.isArray(data.mcpServers) ? data.mcpServers : []
        const next = servers.filter(s => !(isObject(s) && s.id === serverId))
        tx.update(ref, { mcpServers: next, lastEditionDate: Date.now() })
    })
}

/**
 * Connect (add or update) an MCP server for an assistant.
 * Validates reachability via `tools/list` using the supplied secret, stores the
 * secret server-side, and upserts the non-secret entry onto the assistant doc.
 */
async function connectAssistantMcpServer({ userId, projectId, assistantId, server, secret }) {
    await assertCanEditAssistant(projectId, assistantId, userId)

    const normalized = normalizeServerInput(server)

    // For OAuth, the client only hands us an `oauthState` handle — never the tokens
    // themselves. Claim the completed OAuth session server-side so the access/refresh
    // tokens and any client_secret never round-trip through the browser.
    let resolvedSecret = secret
    if (normalized.authType === 'oauth' && isObject(secret) && secret.oauthState) {
        const { consumeMcpOAuthSession } = require('./mcpClientOAuth')
        const bundle = await consumeMcpOAuthSession({ userId, state: secret.oauthState })
        resolvedSecret = {
            accessToken: bundle.accessToken,
            refreshToken: bundle.refreshToken,
            expiresAt: bundle.expiresAt,
            oauthContext: bundle.oauthContext,
        }
    }

    const { toStore, toValidate, tokenLast4 } = buildSecretRecords(normalized.authType, resolvedSecret)

    // For an UPDATE that doesn't re-supply the secret (e.g. only relabeling),
    // fall back to the already-stored secret so validation still works.
    let secretForValidation = toValidate
    let secretToPersist = toStore
    if (normalized.authType !== 'none' && !toValidate) {
        const existing = await buildSecretDocRef(projectId, assistantId, normalized.id).get()
        if (existing.exists) {
            secretForValidation = existing.data()
            secretToPersist = null // keep existing
        }
    }

    // Validate by listing tools. Surface a clean error to the UI on failure.
    let tools
    try {
        tools = await mcpClient.listTools(normalized, secretForValidation)
    } catch (err) {
        throw new HttpsError(
            'failed-precondition',
            `Could not connect to the MCP server: ${String(err && err.message ? err.message : err).slice(0, 300)}`
        )
    }

    if (secretToPersist) {
        await buildSecretDocRef(projectId, assistantId, normalized.id).set(secretToPersist, { merge: true })
    }

    const entry = {
        id: normalized.id,
        label: normalized.label,
        url: normalized.url,
        transport: normalized.transport,
        authType: normalized.authType,
        enabled: true,
        tokenLast4: tokenLast4 || (secretForValidation && secretForValidation.tokenLast4) || '',
        toolCount: tools.length,
        connectedAt: Date.now(),
        lastValidatedAt: Date.now(),
    }
    await upsertServerEntry(projectId, assistantId, entry)

    return {
        success: true,
        serverId: normalized.id,
        toolCount: tools.length,
        toolNames: tools
            .map(t => t && t.name)
            .filter(Boolean)
            .slice(0, 50),
        label: normalized.label,
    }
}

/** Disconnect (remove) an MCP server from an assistant + delete its secret. */
async function disconnectAssistantMcpServer({ userId, projectId, assistantId, serverId }) {
    await assertCanEditAssistant(projectId, assistantId, userId)
    if (!serverId) throw new HttpsError('invalid-argument', 'A serverId is required.')

    await removeServerEntry(projectId, assistantId, serverId)
    await buildSecretDocRef(projectId, assistantId, serverId)
        .delete()
        .catch(() => {})

    return { success: true }
}

/**
 * Server-side helper used by the assistant tool loop to read the stored secret
 * for a given (assistant, server). Returns null when there is no secret.
 */
async function getAssistantMcpSecret(projectId, assistantId, serverId) {
    const snap = await buildSecretDocRef(projectId, assistantId, serverId).get()
    return snap.exists ? snap.data() : null
}

// 60s safety buffer so we refresh slightly before the token actually expires.
const OAUTH_EXPIRY_BUFFER_MS = 60 * 1000

/**
 * Like getAssistantMcpSecret, but for OAuth secrets it transparently refreshes an
 * expired (or about-to-expire) access token and persists the new tokens before
 * returning. Used by the assistant tool loop so long-lived assistants keep working
 * without re-authorization. Returns the (possibly refreshed) secret, or null.
 */
async function getValidMcpSecret(projectId, assistantId, serverId) {
    const secret = await getAssistantMcpSecret(projectId, assistantId, serverId)
    if (!secret || secret.authType !== 'oauth') return secret

    const expiresAt = Number(secret.expiresAt) || 0
    const needsRefresh = expiresAt > 0 && Date.now() >= expiresAt - OAUTH_EXPIRY_BUFFER_MS
    if (!needsRefresh || !secret.refreshToken) return secret

    try {
        const { refreshMcpOAuthTokens } = require('./mcpClientOAuth')
        const refreshed = await refreshMcpOAuthTokens(secret)
        if (!refreshed) return secret
        const merged = { ...secret, ...refreshed }
        await buildSecretDocRef(projectId, assistantId, serverId).set(
            {
                accessToken: merged.accessToken,
                refreshToken: merged.refreshToken,
                expiresAt: merged.expiresAt,
                tokenLast4: merged.tokenLast4,
                refreshedAt: Date.now(),
            },
            { merge: true }
        )
        return merged
    } catch (err) {
        console.warn('🔌 MCP: OAuth token refresh failed, using existing token', {
            projectId,
            assistantId,
            serverId,
            error: err && err.message ? err.message : String(err),
        })
        return secret
    }
}

module.exports = {
    connectAssistantMcpServer,
    disconnectAssistantMcpServer,
    getAssistantMcpSecret,
    getValidMcpSecret,
    // exported for tests
    normalizeServerInput,
    buildSecretRecords,
    MAX_SERVERS_PER_ASSISTANT,
}
