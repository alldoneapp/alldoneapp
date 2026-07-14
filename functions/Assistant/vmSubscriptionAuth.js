const admin = require('firebase-admin')
const { HttpsError } = require('firebase-functions/v2/https')

const VM_SUBSCRIPTION_DOC = 'vmAgentSubscriptions'
const VALID_PROVIDERS = ['claude', 'codex']

function getSubscriptionRef(userId) {
    return admin.firestore().doc(`users/${userId}/private/${VM_SUBSCRIPTION_DOC}`)
}

function assertProvider(provider) {
    if (!VALID_PROVIDERS.includes(provider)) {
        throw new HttpsError('invalid-argument', 'provider must be "claude" or "codex".')
    }
}

function normalizeClaudeOauthToken(rawCredential) {
    const token = typeof rawCredential === 'string' ? rawCredential.trim() : ''
    if (token.length < 20 || /\s/.test(token)) {
        throw new HttpsError('invalid-argument', 'Paste the complete OAuth token printed by `claude setup-token`.')
    }
    return token
}

function parseCodexAuthJson(rawCredential) {
    const text = typeof rawCredential === 'string' ? rawCredential.trim() : ''
    let auth
    try {
        auth = JSON.parse(text)
    } catch (_) {
        throw new HttpsError('invalid-argument', 'Paste the complete JSON from ~/.codex/auth.json.')
    }
    if (!auth || auth.auth_mode !== 'chatgpt' || !auth.tokens || !auth.tokens.refresh_token) {
        throw new HttpsError(
            'invalid-argument',
            'The Codex auth file must use auth_mode "chatgpt" and contain a refresh token. Run `codex login` first.'
        )
    }
    return auth
}

function sanitizeStatus(data, apiKeyStatus = {}) {
    const claude = data?.claude || {}
    const codex = data?.codex || {}
    return {
        claude: {
            connected: !!claude.oauthToken,
            connectedAt: claude.connectedAt || null,
            lastUsedAt: claude.lastUsedAt || null,
            apiKey: apiKeyStatus.claude || { connected: false },
            activeMode: data?.credentialModes?.claude || null,
        },
        codex: {
            connected: !!codex.authJson,
            connectedAt: codex.connectedAt || null,
            lastUsedAt: codex.lastUsedAt || null,
            apiKey: apiKeyStatus.codex || { connected: false },
            activeMode: data?.credentialModes?.codex || null,
        },
    }
}

async function getVmSubscriptionStatus({ userId }) {
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
    const [snap, apiKeyStatus] = await Promise.all([
        getSubscriptionRef(userId).get(),
        require('./vmApiKeyAuth').getVmApiKeyStatus(userId),
    ])
    const data = snap.exists ? snap.data() || {} : {}
    const status = sanitizeStatus(data, apiKeyStatus)
    const apiKeyData = {}
    VALID_PROVIDERS.forEach(provider => {
        if (apiKeyStatus[provider]?.connected) apiKeyData[provider] = { apiKey: true }
        status[provider].activeMode = require('./vmApiKeyAuth').resolveModeFromData(provider, data, apiKeyData)
    })
    return status
}

async function connectVmSubscription({ userId, provider, credential }) {
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
    assertProvider(provider)
    const now = Date.now()
    const value =
        provider === 'claude'
            ? { oauthToken: normalizeClaudeOauthToken(credential) }
            : { authJson: JSON.stringify(parseCodexAuthJson(credential)) }

    const current = await getSubscriptionRef(userId).get()
    const currentMode = current.exists ? current.data()?.credentialModes?.[provider] : null
    await getSubscriptionRef(userId).set(
        {
            [provider]: {
                ...value,
                connectedAt: now,
                lastUsedAt: null,
            },
            ...(currentMode === 'byok' ? {} : { credentialModes: { [provider]: 'subscription' } }),
            updatedAt: now,
        },
        { merge: true }
    )
    return { success: true, provider, connected: true, connectedAt: now }
}

async function disconnectVmSubscription({ userId, provider }) {
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
    assertProvider(provider)
    const apiKeyStatus = await require('./vmApiKeyAuth').getVmApiKeyStatus(userId)
    const fallbackMode = apiKeyStatus[provider]?.connected ? 'byok' : 'api'
    await getSubscriptionRef(userId).set(
        {
            [provider]: admin.firestore.FieldValue.delete(),
            credentialModes: { [provider]: fallbackMode },
            updatedAt: Date.now(),
        },
        { merge: true }
    )
    return { success: true, provider, connected: false, activeMode: fallbackMode }
}

async function hasVmSubscription(userId, provider) {
    if (!userId || !VALID_PROVIDERS.includes(provider)) return false
    const snap = await getSubscriptionRef(userId).get()
    if (!snap.exists) return false
    const data = snap.data() || {}
    return provider === 'claude' ? !!data.claude?.oauthToken : !!data.codex?.authJson
}

async function loadVmSubscriptionAuth(userId, provider) {
    if (!userId || !VALID_PROVIDERS.includes(provider)) return null
    const ref = getSubscriptionRef(userId)
    const snap = await ref.get()
    if (!snap.exists) return null
    const data = snap.data() || {}
    const providerData = data[provider] || {}
    const credential = provider === 'claude' ? providerData.oauthToken : providerData.authJson
    if (!credential) return null
    await ref.update({ [`${provider}.lastUsedAt`]: Date.now() }).catch(() => {})
    return { provider, credential, mode: 'subscription' }
}

async function persistRefreshedCodexAuth(userId, rawAuthJson) {
    if (!userId || !rawAuthJson) return false
    let auth
    try {
        auth = parseCodexAuthJson(rawAuthJson)
    } catch (_) {
        return false
    }
    await getSubscriptionRef(userId).update({
        'codex.authJson': JSON.stringify(auth),
        'codex.lastUsedAt': Date.now(),
        updatedAt: Date.now(),
    })
    return true
}

module.exports = {
    connectVmSubscription,
    disconnectVmSubscription,
    getVmSubscriptionStatus,
    hasVmSubscription,
    loadVmSubscriptionAuth,
    persistRefreshedCodexAuth,
    normalizeClaudeOauthToken,
    parseCodexAuthJson,
    VM_SUBSCRIPTION_DOC,
}
