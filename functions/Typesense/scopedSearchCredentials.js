const { getEnvFunctions } = require('../envFunctionsHelper')
const {
    ALL_COLLECTIONS,
    formatTypesenseFilterValue,
    generateTypesenseScopedSearchKey,
    getTypesenseClient,
} = require('../typesenseHelper')
const { resolveScopedSearchParentKey } = require('./scopedSearchParentKey')

const GLOBAL_PROJECT_ID = 'globalProject'
const PUBLIC_FOR_ALL = '0'
const SCOPED_KEY_TTL_SECONDS = 5 * 60
const EXCLUDED_RESPONSE_FIELDS = 'content,cleanComments'
// Global search's five original tabs share one request. Identity-first ranking expands Notes,
// Contacts, and Topics into identity + full-text pages, so that request contains eight engine
// searches; Artifacts and Wiki each send their own request of two. Keep this bound aligned with
// that client-side plan.
const MAX_MULTI_SEARCHES = 8
const MAX_RESULTS_PER_COLLECTION = 20

class TypesenseSearchCredentialsError extends Error {
    constructor(code, message) {
        super(message)
        this.name = 'TypesenseSearchCredentialsError'
        this.code = code
    }
}

const getAuthorizedProjectIds = async (db, userId) => {
    const snapshot = await db.collection('projects').where('userIds', 'array-contains', userId).select().get()

    return snapshot.docs.map(doc => doc.id)
}

/**
 * The key admits exactly what Firestore's reader model admits (security audit 2026-11, NV-40).
 * `readerIds` (buildObjectAccessProjection) keeps only the public sentinel and explicit member uids
 * from `isPublicFor`; workstream ids there never granted a Firestore read. The index records carry
 * only `isPublicFor`, so the key matches on the same two kinds of entry and nothing else: a private
 * object shared with a workstream is found by the members listed by uid at the time it was shared,
 * as in Firestore, and not by everyone who is (or adds themselves to) the workstream today.
 * Non-members are excluded by the projectId filter, which is the other half of `readerIds`.
 */
const buildEmbeddedAccessFilter = ({ projectIds, userId, isAnonymous }) => {
    const authorizedProjectIds = [...new Set([...projectIds, GLOBAL_PROJECT_ID])]
    const projectValues = authorizedProjectIds.map(formatTypesenseFilterValue).join(',')

    const accessIds = isAnonymous ? [PUBLIC_FOR_ALL] : [...new Set([PUBLIC_FOR_ALL, userId])]
    const accessValues = accessIds.map(formatTypesenseFilterValue).join(',')

    return `projectId:=[${projectValues}] && isPublicFor:=[${accessValues}]`
}

const normalizeTypesenseOrigin = host => {
    const rawHost = String(host || '').trim()
    if (!rawHost) throw new TypesenseSearchCredentialsError('failed-precondition', 'Typesense host is not configured')

    try {
        const url = new URL(rawHost.includes('://') ? rawHost : `https://${rawHost}`)
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Unsupported protocol')
        return url.origin
    } catch (_) {
        throw new TypesenseSearchCredentialsError('failed-precondition', 'Typesense host is invalid')
    }
}

const createTypesenseScopedSearchCredentials = async ({ db, userId, isAnonymous = false, now = Date.now() }) => {
    if (!userId) throw new TypesenseSearchCredentialsError('permission-denied', 'User must be authenticated')

    const { TYPESENSE_HOST, TYPESENSE_ADMIN_API_KEY, TYPESENSE_SCOPED_SEARCH_PARENT_API_KEY } = getEnvFunctions()
    // Provisioned from ALL_COLLECTIONS, so a new searchable collection can never again be
    // silently missing from the key (AT-2905, see scopedSearchParentKey.js).
    const parentKey = await resolveScopedSearchParentKey({
        client: getTypesenseClient(),
        adminApiKey: TYPESENSE_ADMIN_API_KEY,
        collections: ALL_COLLECTIONS,
        configuredParentKey: TYPESENSE_SCOPED_SEARCH_PARENT_API_KEY,
    })
    if (!parentKey) {
        throw new TypesenseSearchCredentialsError(
            'failed-precondition',
            'Typesense scoped-search parent key is not configured'
        )
    }

    const projectIds = await getAuthorizedProjectIds(db, userId)
    const filterBy = buildEmbeddedAccessFilter({ projectIds, userId, isAnonymous })
    const expiresAt = Math.floor(now / 1000) + SCOPED_KEY_TTL_SECONDS
    const apiKey = generateTypesenseScopedSearchKey(parentKey, {
        filter_by: filterBy,
        exclude_fields: EXCLUDED_RESPONSE_FIELDS,
        limit_multi_searches: MAX_MULTI_SEARCHES,
        per_page: MAX_RESULTS_PER_COLLECTION,
        expires_at: expiresAt,
    })

    return {
        userId,
        origin: normalizeTypesenseOrigin(TYPESENSE_HOST),
        apiKey,
        expiresAt,
    }
}

module.exports = {
    GLOBAL_PROJECT_ID,
    PUBLIC_FOR_ALL,
    SCOPED_KEY_TTL_SECONDS,
    EXCLUDED_RESPONSE_FIELDS,
    MAX_MULTI_SEARCHES,
    MAX_RESULTS_PER_COLLECTION,
    TypesenseSearchCredentialsError,
    getAuthorizedProjectIds,
    buildEmbeddedAccessFilter,
    normalizeTypesenseOrigin,
    createTypesenseScopedSearchCredentials,
}
