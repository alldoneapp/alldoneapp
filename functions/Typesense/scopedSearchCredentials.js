const { getEnvFunctions } = require('../envFunctionsHelper')
const { formatTypesenseFilterValue, generateTypesenseScopedSearchKey } = require('../typesenseHelper')

const GLOBAL_PROJECT_ID = 'globalProject'
const DEFAULT_WORKSTREAM_ID = 'ws@default'
const PUBLIC_FOR_ALL = '0'
const SCOPED_KEY_TTL_SECONDS = 5 * 60
const EXCLUDED_RESPONSE_FIELDS = 'content,cleanComments'
const MAX_MULTI_SEARCHES = 5
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

const getAuthorizedWorkstreamIds = async (db, projectIds, userId) => {
    const snapshots = await Promise.all(
        projectIds.map(projectId =>
            db
                .collection(`projectsWorkstreams/${projectId}/workstreams`)
                .where('userIds', 'array-contains', userId)
                .select()
                .get()
        )
    )

    return snapshots.flatMap(snapshot => snapshot.docs.map(doc => doc.id))
}

const buildEmbeddedAccessFilter = ({ projectIds, userId, isAnonymous, workstreamIds = [] }) => {
    const authorizedProjectIds = [...new Set([...projectIds, GLOBAL_PROJECT_ID])]
    const projectValues = authorizedProjectIds.map(formatTypesenseFilterValue).join(',')

    const accessIds = isAnonymous
        ? [PUBLIC_FOR_ALL]
        : [...new Set([PUBLIC_FOR_ALL, userId, DEFAULT_WORKSTREAM_ID, ...workstreamIds])]
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

    const { TYPESENSE_HOST, TYPESENSE_SCOPED_SEARCH_PARENT_API_KEY } = getEnvFunctions()
    if (!TYPESENSE_SCOPED_SEARCH_PARENT_API_KEY) {
        throw new TypesenseSearchCredentialsError(
            'failed-precondition',
            'Typesense scoped-search parent key is not configured'
        )
    }

    const projectIds = await getAuthorizedProjectIds(db, userId)
    const workstreamIds = isAnonymous ? [] : await getAuthorizedWorkstreamIds(db, projectIds, userId)
    const filterBy = buildEmbeddedAccessFilter({ projectIds, userId, isAnonymous, workstreamIds })
    const expiresAt = Math.floor(now / 1000) + SCOPED_KEY_TTL_SECONDS
    const apiKey = generateTypesenseScopedSearchKey(TYPESENSE_SCOPED_SEARCH_PARENT_API_KEY, {
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
    DEFAULT_WORKSTREAM_ID,
    PUBLIC_FOR_ALL,
    SCOPED_KEY_TTL_SECONDS,
    EXCLUDED_RESPONSE_FIELDS,
    MAX_MULTI_SEARCHES,
    MAX_RESULTS_PER_COLLECTION,
    TypesenseSearchCredentialsError,
    getAuthorizedProjectIds,
    getAuthorizedWorkstreamIds,
    buildEmbeddedAccessFilter,
    normalizeTypesenseOrigin,
    createTypesenseScopedSearchCredentials,
}
