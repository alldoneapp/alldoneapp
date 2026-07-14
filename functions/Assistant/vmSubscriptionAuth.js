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

function sanitizeStatus(data) {
    const claude = data?.claude || {}
    const codex = data?.codex || {}
    return {
        claude: {
            connected: !!claude.oauthToken,
            connectedAt: claude.connectedAt || null,
            lastUsedAt: claude.lastUsedAt || null,
        },
        codex: {
            connected: !!codex.authJson,
            connectedAt: codex.connectedAt || null,
            lastUsedAt: codex.lastUsedAt || null,
        },
    }
}

async function getVmSubscriptionStatus({ userId }) {
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
    const snap = await getSubscriptionRef(userId).get()
    return sanitizeStatus(snap.exists ? snap.data() || {} : {})
}

async function connectVmSubscription({ userId, provider, credential }) {
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
    assertProvider(provider)
    const now = Date.now()
    const value =
        provider === 'claude'
            ? { oauthToken: normalizeClaudeOauthToken(credential) }
            : { authJson: JSON.stringify(parseCodexAuthJson(credential)) }

    await getSubscriptionRef(userId).set(
        {
            [provider]: {
                ...value,
                connectedAt: now,
                lastUsedAt: null,
            },
            updatedAt: now,
        },
        { merge: true }
    )
    return { success: true, provider, connected: true, connectedAt: now }
}

async function disconnectVmSubscription({ userId, provider }) {
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
    assertProvider(provider)
    await getSubscriptionRef(userId).set(
        {
            [provider]: admin.firestore.FieldValue.delete(),
            updatedAt: Date.now(),
        },
        { merge: true }
    )
    return { success: true, provider, connected: false }
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
