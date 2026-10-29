'use strict'

const crypto = require('crypto')

// The parent key every browser search key is derived from (AT-2905).
//
// A scoped search key can only reach the collections its PARENT key lists. The parent used to be
// created by hand in Typesense Cloud (TYPESENSE_SCOPED_SEARCH_PARENT_API_KEY) for the five
// collections that existed then. When Artifacts (dev_artifacts) and the project wiki (dev_wiki)
// were added to global search, nobody widened that key, so Typesense rejected every Artifacts
// and Wiki request with 401. The client retried once with a fresh key (the same parent, so the
// same 401) and showed "no results". Nothing failed anywhere a person could see it.
//
// The parent is therefore provisioned here, from the collection list the code actually has:
// - Its VALUE is derived (HMAC-SHA256 of the admin key over a versioned description of the
//   collection list), so every Functions instance computes the same key with no stored secret
//   and no coordination. Typesense accepts a caller-chosen `value` on key creation.
// - It is created once per instance. A key with that value already existing (409) is success;
//   since the value encodes the collection list, an existing key necessarily covers exactly
//   these collections.
// - Adding a collection to ALL_COLLECTIONS changes the value, so the next cold start creates a
//   new parent that covers it. Superseded parents are NOT deleted: an instance still running the
//   previous deploy keeps issuing keys from its parent for a few minutes, and a search key that
//   only lists `documents:search` on named collections is harmless to keep. One key per change of
//   the collection list.
// - The key may only `documents:search`. Typesense refuses to verify a scoped key whose parent
//   has any other action, and the embedded filter in every derived key is the access rule.
//
// The admin key never leaves Functions and nothing here returns the parent to a caller.

const PARENT_KEY_VERSION = 1
const PARENT_KEY_DESCRIPTION_PREFIX = 'alldone-scoped-search-parent'
const PARENT_KEY_ACTIONS = ['documents:search']

const normalizeCollections = collections => [...new Set((collections || []).map(String))].sort()

const describeParentKey = collections =>
    `${PARENT_KEY_DESCRIPTION_PREFIX} v${PARENT_KEY_VERSION} (${normalizeCollections(collections).join(',')})`

const deriveScopedSearchParentKeyValue = (adminApiKey, collections) => {
    if (!adminApiKey) throw new Error('Typesense admin key is not configured')
    return crypto.createHmac('sha256', String(adminApiKey)).update(describeParentKey(collections)).digest('base64url')
}

const buildScopedSearchParentKeySpec = (adminApiKey, collections) => ({
    value: deriveScopedSearchParentKeyValue(adminApiKey, collections),
    description: describeParentKey(collections),
    actions: PARENT_KEY_ACTIONS,
    collections: normalizeCollections(collections),
})

const isAlreadyExistsError = error =>
    !!error && (error.httpStatus === 409 || error.name === 'ObjectAlreadyExists' || error.status === 409)

// value -> Promise<value>. A rejected ensure is dropped so a later request tries again.
const ensuredParentKeys = new Map()
// After a failed provisioning call the configured key is used straight away for this long, so a
// Typesense outage does not make every credentials request wait for the client's retries first.
const PROVISIONING_RETRY_COOLDOWN_MS = 60 * 1000
let lastProvisioningFailureAt = null

const ensureScopedSearchParentKey = ({ client, adminApiKey, collections }) => {
    if (!client) return Promise.reject(new Error('Typesense is not configured'))
    const spec = buildScopedSearchParentKeySpec(adminApiKey, collections)
    if (!ensuredParentKeys.has(spec.value)) {
        const ensure = (async () => {
            try {
                await client.keys().create(spec)
                console.log('[typesense] Created the scoped-search parent key', { description: spec.description })
            } catch (error) {
                if (!isAlreadyExistsError(error)) throw error
            }
            return spec.value
        })()
        ensuredParentKeys.set(spec.value, ensure)
        ensure.catch(() => {
            if (ensuredParentKeys.get(spec.value) === ensure) ensuredParentKeys.delete(spec.value)
        })
    }
    return ensuredParentKeys.get(spec.value)
}

// The parent to derive browser keys from. The provisioned key is preferred; the configured key
// (TYPESENSE_SCOPED_SEARCH_PARENT_API_KEY) is only a fallback for when the provisioning call
// fails, and the error says loudly which collections that fallback may be unable to search.
// Returns null when neither is available.
const resolveScopedSearchParentKey = async ({
    client,
    adminApiKey,
    collections,
    configuredParentKey,
    now = Date.now(),
}) => {
    const coolingDown =
        configuredParentKey &&
        lastProvisioningFailureAt !== null &&
        now - lastProvisioningFailureAt < PROVISIONING_RETRY_COOLDOWN_MS
    if (client && adminApiKey && !coolingDown) {
        try {
            const value = await ensureScopedSearchParentKey({ client, adminApiKey, collections })
            lastProvisioningFailureAt = null
            return value
        } catch (error) {
            lastProvisioningFailureAt = now
            console.error(
                '[typesense] Could not provision the scoped-search parent key; falling back to ' +
                    'TYPESENSE_SCOPED_SEARCH_PARENT_API_KEY, which may not cover every collection',
                { collections: normalizeCollections(collections), error: error && error.message }
            )
        }
    }
    return configuredParentKey || null
}

const __resetScopedSearchParentKeyCacheForTests = () => {
    ensuredParentKeys.clear()
    lastProvisioningFailureAt = null
}

module.exports = {
    PARENT_KEY_VERSION,
    PARENT_KEY_DESCRIPTION_PREFIX,
    PARENT_KEY_ACTIONS,
    PROVISIONING_RETRY_COOLDOWN_MS,
    describeParentKey,
    deriveScopedSearchParentKeyValue,
    buildScopedSearchParentKeySpec,
    ensureScopedSearchParentKey,
    resolveScopedSearchParentKey,
    __resetScopedSearchParentKeyCacheForTests,
}
