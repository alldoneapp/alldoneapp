const admin = require('firebase-admin')
const { HttpsError } = require('firebase-functions/v2/https')

const VM_API_KEYS_DOC = 'vmAgentApiKeys'
const VM_SUBSCRIPTION_DOC = 'vmAgentSubscriptions'
const VALID_PROVIDERS = ['claude', 'codex']
const VALID_CREDENTIAL_MODES = ['byok', 'subscription', 'api']
const VALIDATION_TIMEOUT_MS = 10000

const PROVIDER_CONFIG = {
    claude: {
        label: 'Anthropic',
        url: 'https://api.anthropic.com/v1/models?limit=1',
        headers: apiKey => ({
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        }),
    },
    codex: {
        label: 'OpenAI',
        url: 'https://api.openai.com/v1/models',
        headers: apiKey => ({ Authorization: `Bearer ${apiKey}` }),
    },
}

function getApiKeysRef(userId) {
    // This collection is explicitly denied to every client in firestore.rules.
    // Only Admin SDK code can read the raw keys.
    return admin.firestore().doc(`userSecrets/${userId}/providers/${VM_API_KEYS_DOC}`)
}

function getSubscriptionRef(userId) {
    return admin.firestore().doc(`users/${userId}/private/${VM_SUBSCRIPTION_DOC}`)
}

function assertUser(userId) {
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
}

function assertProvider(provider) {
    if (!VALID_PROVIDERS.includes(provider)) {
        throw new HttpsError('invalid-argument', 'provider must be "claude" or "codex".')
    }
}

function normalizeApiKey(rawApiKey) {
    const apiKey = typeof rawApiKey === 'string' ? rawApiKey.trim() : ''
    if (apiKey.length < 20 || apiKey.length > 512 || /\s|[\u0000-\u001f\u007f]/.test(apiKey)) {
        throw new HttpsError('invalid-argument', 'Paste the complete provider API key without spaces.')
    }
    return apiKey
}

async function validateProviderApiKey(provider, rawApiKey, options = {}) {
    assertProvider(provider)
    const apiKey = normalizeApiKey(rawApiKey)
    const config = PROVIDER_CONFIG[provider]
    const fetchImpl = options.fetchImpl || global.fetch
    if (typeof fetchImpl !== 'function') {
        throw new HttpsError('unavailable', `Could not contact ${config.label} to validate the API key.`)
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timeout = setTimeout(() => controller && controller.abort(), options.timeoutMs || VALIDATION_TIMEOUT_MS)
    let response
    try {
        response = await fetchImpl(config.url, {
            method: 'GET',
            headers: config.headers(apiKey),
            ...(controller ? { signal: controller.signal } : {}),
        })
    } catch (_) {
        throw new HttpsError('unavailable', `Could not contact ${config.label} to validate the API key.`)
    } finally {
        clearTimeout(timeout)
    }

    if (response && response.ok) return { valid: true }
    const status = Number(response && response.status) || 0
    if (status === 401 || status === 403) {
        throw new HttpsError('invalid-argument', `${config.label} rejected this API key. Check or replace it.`)
    }
    if (status === 429) {
        throw new HttpsError(
            'resource-exhausted',
            `${config.label} could not validate the key because the account is rate-limited or out of API quota.`
        )
    }
    throw new HttpsError('unavailable', `${config.label} could not validate the API key right now.`)
}

function providerHasSubscription(provider, subscriptionData = {}) {
    return provider === 'claude' ? !!subscriptionData.claude?.oauthToken : !!subscriptionData.codex?.authJson
}

function providerHasApiKey(provider, apiKeyData = {}) {
    return !!apiKeyData[provider]?.apiKey
}

function resolveModeFromData(provider, subscriptionData = {}, apiKeyData = {}) {
    const preferred = subscriptionData.credentialModes?.[provider]
    const hasSubscription = providerHasSubscription(provider, subscriptionData)
    const hasApiKey = providerHasApiKey(provider, apiKeyData)

    if (preferred === 'byok' && hasApiKey) return 'byok'
    if (preferred === 'subscription' && hasSubscription) return 'subscription'
    if (preferred === 'api') return 'api'

    // Backward compatibility: before BYOK, a connected subscription was always
    // preferred automatically; users without one used Alldone API billing.
    return hasSubscription ? 'subscription' : 'api'
}

function sanitizeApiKeyStatus(data = {}) {
    const status = {}
    VALID_PROVIDERS.forEach(provider => {
        const providerData = data[provider] || {}
        status[provider] = {
            connected: !!providerData.apiKey,
            connectedAt: providerData.connectedAt || null,
            validatedAt: providerData.validatedAt || null,
            lastUsedAt: providerData.lastUsedAt || null,
            validationStatus: providerData.validationStatus || null,
        }
    })
    return status
}

async function getVmApiKeyStatus(userId) {
    assertUser(userId)
    const snap = await getApiKeysRef(userId).get()
    return sanitizeApiKeyStatus(snap.exists ? snap.data() || {} : {})
}

async function saveVmApiKey({ userId, provider, apiKey }) {
    assertUser(userId)
    assertProvider(provider)
    const normalized = normalizeApiKey(apiKey)
    await validateProviderApiKey(provider, normalized)

    const now = Date.now()
    const batch = admin.firestore().batch()
    batch.set(
        getApiKeysRef(userId),
        {
            [provider]: {
                apiKey: normalized,
                connectedAt: now,
                validatedAt: now,
                validationStatus: 'valid',
                lastUsedAt: null,
            },
            updatedAt: now,
        },
        { merge: true }
    )
    // Saving is the explicit BYOK opt-in. It never changes the other provider.
    batch.set(
        getSubscriptionRef(userId),
        {
            credentialModes: { [provider]: 'byok' },
            updatedAt: now,
        },
        { merge: true }
    )
    await batch.commit()
    return { success: true, provider, connected: true, activeMode: 'byok', validatedAt: now }
}

async function testVmApiKey({ userId, provider }) {
    assertUser(userId)
    assertProvider(provider)
    const ref = getApiKeysRef(userId)
    const snap = await ref.get()
    const providerData = snap.exists ? (snap.data() || {})[provider] || {} : {}
    if (!providerData.apiKey) {
        throw new HttpsError('failed-precondition', `No ${PROVIDER_CONFIG[provider].label} API key is saved.`)
    }

    const now = Date.now()
    try {
        await validateProviderApiKey(provider, providerData.apiKey)
        await ref.set(
            {
                [provider]: { ...providerData, validatedAt: now, validationStatus: 'valid' },
                updatedAt: now,
            },
            { merge: true }
        )
        return { success: true, provider, valid: true, validatedAt: now }
    } catch (error) {
        await ref
            .set(
                {
                    [provider]: { ...providerData, validatedAt: now, validationStatus: 'invalid' },
                    updatedAt: now,
                },
                { merge: true }
            )
            .catch(() => {})
        throw error
    }
}

async function removeVmApiKey({ userId, provider }) {
    assertUser(userId)
    assertProvider(provider)
    const subscriptionSnap = await getSubscriptionRef(userId).get()
    const subscriptionData = subscriptionSnap.exists ? subscriptionSnap.data() || {} : {}
    const fallbackMode = providerHasSubscription(provider, subscriptionData) ? 'subscription' : 'api'
    const now = Date.now()
    const batch = admin.firestore().batch()
    batch.set(
        getApiKeysRef(userId),
        { [provider]: admin.firestore.FieldValue.delete(), updatedAt: now },
        { merge: true }
    )
    batch.set(
        getSubscriptionRef(userId),
        { credentialModes: { [provider]: fallbackMode }, updatedAt: now },
        { merge: true }
    )
    await batch.commit()
    return { success: true, provider, connected: false, activeMode: fallbackMode }
}

async function setVmCredentialMode({ userId, provider, mode }) {
    assertUser(userId)
    assertProvider(provider)
    if (!VALID_CREDENTIAL_MODES.includes(mode)) {
        throw new HttpsError('invalid-argument', 'mode must be "byok", "subscription", or "api".')
    }

    const [subscriptionSnap, apiKeySnap] = await Promise.all([
        getSubscriptionRef(userId).get(),
        getApiKeysRef(userId).get(),
    ])
    const subscriptionData = subscriptionSnap.exists ? subscriptionSnap.data() || {} : {}
    const apiKeyData = apiKeySnap.exists ? apiKeySnap.data() || {} : {}
    if (mode === 'byok' && !providerHasApiKey(provider, apiKeyData)) {
        throw new HttpsError('failed-precondition', 'Save and validate an API key before selecting BYOK.')
    }
    if (mode === 'subscription' && !providerHasSubscription(provider, subscriptionData)) {
        throw new HttpsError('failed-precondition', 'Connect a subscription before selecting subscription billing.')
    }

    await getSubscriptionRef(userId).set(
        { credentialModes: { [provider]: mode }, updatedAt: Date.now() },
        { merge: true }
    )
    return { success: true, provider, activeMode: mode }
}

async function resolveVmCredentialMode(userId, provider) {
    if (!userId || !VALID_PROVIDERS.includes(provider)) return 'api'
    const [subscriptionSnap, apiKeySnap] = await Promise.all([
        getSubscriptionRef(userId).get(),
        getApiKeysRef(userId).get(),
    ])
    return resolveModeFromData(
        provider,
        subscriptionSnap.exists ? subscriptionSnap.data() || {} : {},
        apiKeySnap.exists ? apiKeySnap.data() || {} : {}
    )
}

async function loadVmApiKey(userId, provider) {
    if (!userId || !VALID_PROVIDERS.includes(provider)) return null
    const ref = getApiKeysRef(userId)
    const snap = await ref.get()
    const providerData = snap.exists ? (snap.data() || {})[provider] || {} : {}
    if (!providerData.apiKey) return null
    ref.set(
        { [provider]: { ...providerData, lastUsedAt: Date.now() }, updatedAt: Date.now() },
        { merge: true }
    ).catch(() => {})
    return providerData.apiKey
}

async function markVmApiKeyRejected(userId, provider) {
    if (!userId || !VALID_PROVIDERS.includes(provider)) return
    const ref = getApiKeysRef(userId)
    const snap = await ref.get().catch(() => null)
    const providerData = snap && snap.exists ? (snap.data() || {})[provider] || {} : {}
    if (!providerData.apiKey) return
    await ref
        .set(
            {
                [provider]: { ...providerData, validationStatus: 'invalid', validatedAt: Date.now() },
                updatedAt: Date.now(),
            },
            { merge: true }
        )
        .catch(() => {})
}

module.exports = {
    getVmApiKeyStatus,
    saveVmApiKey,
    testVmApiKey,
    removeVmApiKey,
    setVmCredentialMode,
    resolveVmCredentialMode,
    loadVmApiKey,
    markVmApiKeyRejected,
    validateProviderApiKey,
    normalizeApiKey,
    resolveModeFromData,
    sanitizeApiKeyStatus,
    VM_API_KEYS_DOC,
    VALID_CREDENTIAL_MODES,
}
