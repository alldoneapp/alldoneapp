/**
 * Typesense write layer for the Algolia → Typesense migration (see TYPESENSE_MIGRATION.md).
 *
 * Phase 1 contract (dual-write):
 * - Collections are named EXACTLY like the Algolia index prefixes (dev_tasks, dev_goals,
 *   dev_notes, dev_contacts, dev_updates) so the existing prefix-keyed write paths need no
 *   mapping table.
 * - Every exported write op is a guaranteed no-throw: Typesense being down, slow, or not yet
 *   provisioned must never fail an Algolia write or the Firestore trigger hosting it. Gaps
 *   are healed by re-running the Phase 2 backfill.
 * - With TYPESENSE_HOST / TYPESENSE_ADMIN_API_KEY unset, everything here is a silent no-op,
 *   so this code is safe to deploy before the cluster exists.
 */
const Typesense = require('typesense')

const { getEnvFunctions } = require('./envFunctionsHelper')

const TASKS_COLLECTION = 'dev_tasks'
const GOALS_COLLECTION = 'dev_goals'
const NOTES_COLLECTION = 'dev_notes'
const CONTACTS_COLLECTION = 'dev_contacts'
const CHATS_COLLECTION = 'dev_updates'

const ALL_COLLECTIONS = [TASKS_COLLECTION, GOALS_COLLECTION, NOTES_COLLECTION, CONTACTS_COLLECTION, CHATS_COLLECTION]

const IMPORT_BATCH_SIZE = 500

// Explicit fields cover everything used in filter_by / sort_by; the `.*` auto field absorbs
// the many display-only attributes the map*Data mappers emit without enumerating them.
// No default_sorting_field on purpose: queries pass sort_by explicitly, and a required
// sorting field would reject any record where it is missing.
const COLLECTION_SCHEMAS = {
    [TASKS_COLLECTION]: {
        name: TASKS_COLLECTION,
        // Let `#123` / humanReadableId tokens match when users search task ids.
        token_separators: ['#', '-', '_'],
        fields: [
            { name: 'name', type: 'string', optional: true },
            { name: 'humanReadableId', type: 'string', optional: true },
            { name: 'humanReadableIdSearchable', type: 'string', optional: true },
            { name: 'projectId', type: 'string', facet: true, optional: true },
            { name: 'userId', type: 'string', facet: true, optional: true },
            { name: 'isPublicFor', type: 'string[]', facet: true, optional: true },
            { name: 'done', type: 'bool', facet: true, optional: true },
            { name: 'isPrivate', type: 'bool', facet: true, optional: true },
            { name: 'lockKey', type: 'string', facet: true, optional: true },
            { name: 'lastEditionDate', type: 'int64', facet: true, optional: true },
            { name: 'created', type: 'int64', optional: true },
            { name: '.*', type: 'auto' },
        ],
    },
    [GOALS_COLLECTION]: {
        name: GOALS_COLLECTION,
        fields: [
            { name: 'name', type: 'string', optional: true },
            { name: 'projectId', type: 'string', facet: true, optional: true },
            { name: 'ownerId', type: 'string', facet: true, optional: true },
            { name: 'creatorId', type: 'string', facet: true, optional: true },
            { name: 'isPublicFor', type: 'string[]', facet: true, optional: true },
            { name: 'lockKey', type: 'string', facet: true, optional: true },
            { name: 'canBeInactive', type: 'bool', facet: true, optional: true },
            { name: 'lastEditionDate', type: 'int64', facet: true, optional: true },
            { name: 'created', type: 'int64', optional: true },
            { name: '.*', type: 'auto' },
        ],
    },
    [NOTES_COLLECTION]: {
        name: NOTES_COLLECTION,
        fields: [
            { name: 'title', type: 'string', optional: true },
            { name: 'content', type: 'string', optional: true },
            { name: 'projectId', type: 'string', facet: true, optional: true },
            { name: 'userId', type: 'string', facet: true, optional: true },
            { name: 'isPublicFor', type: 'string[]', facet: true, optional: true },
            { name: 'isPrivate', type: 'bool', facet: true, optional: true },
            { name: 'lastEditionDate', type: 'int64', facet: true, optional: true },
            { name: '.*', type: 'auto' },
        ],
    },
    [CONTACTS_COLLECTION]: {
        name: CONTACTS_COLLECTION,
        fields: [
            { name: 'displayName', type: 'string', optional: true },
            { name: 'cleanDescription', type: 'string', optional: true },
            { name: 'role', type: 'string', optional: true },
            { name: 'company', type: 'string', optional: true },
            { name: 'projectId', type: 'string', facet: true, optional: true },
            { name: 'uid', type: 'string', facet: true, optional: true },
            { name: 'recorderUserId', type: 'string', facet: true, optional: true },
            { name: 'isAssistant', type: 'bool', facet: true, optional: true },
            { name: 'isPublicFor', type: 'string[]', facet: true, optional: true },
            { name: 'isPrivate', type: 'bool', facet: true, optional: true },
            { name: 'lastEditionDate', type: 'int64', facet: true, optional: true },
            { name: '.*', type: 'auto' },
        ],
    },
    [CHATS_COLLECTION]: {
        name: CHATS_COLLECTION,
        fields: [
            { name: 'cleanName', type: 'string', optional: true },
            { name: 'cleanLastComment', type: 'string', optional: true },
            { name: 'cleanComments', type: 'string', optional: true },
            { name: 'projectId', type: 'string', facet: true, optional: true },
            { name: 'creatorId', type: 'string', facet: true, optional: true },
            { name: 'isPublicFor', type: 'string[]', facet: true, optional: true },
            { name: 'isPrivate', type: 'bool', facet: true, optional: true },
            { name: 'lastEditionDate', type: 'int64', facet: true, optional: true },
            { name: '.*', type: 'auto' },
        ],
    },
}

let cachedClient = null
const ensuredCollections = {}

const getTypesenseConfig = () => {
    const { TYPESENSE_HOST, TYPESENSE_ADMIN_API_KEY } = getEnvFunctions()
    if (!TYPESENSE_HOST || !TYPESENSE_ADMIN_API_KEY) return null
    // Accept a bare Typesense Cloud host ("xyz.a1.typesense.net") or a full origin
    // ("https://xyz.a1.typesense.net:443").
    let host = TYPESENSE_HOST
    let protocol = 'https'
    let port = 443
    if (host.includes('://')) {
        try {
            const url = new URL(host)
            host = url.hostname
            protocol = url.protocol.replace(':', '') || 'https'
            port = url.port ? parseInt(url.port, 10) : protocol === 'https' ? 443 : 80
        } catch (error) {
            console.error('Invalid TYPESENSE_HOST value, disabling Typesense writes:', error.message)
            return null
        }
    }
    return { host, protocol, port, apiKey: TYPESENSE_ADMIN_API_KEY }
}

const isTypesenseConfigured = () => {
    return !!getTypesenseConfig()
}

const getTypesenseClient = () => {
    if (cachedClient) return cachedClient
    const config = getTypesenseConfig()
    if (!config) return null
    cachedClient = new Typesense.Client({
        nodes: [{ host: config.host, port: config.port, protocol: config.protocol }],
        apiKey: config.apiKey,
        connectionTimeoutSeconds: 10,
        numRetries: 3,
        retryIntervalSeconds: 1,
    })
    return cachedClient
}

// Millisecond-timestamp fields that legacy documents occasionally carry with garbage values.
// Typesense auto-types a field from the first document it sees (int64 for these), then
// rejects anything else with "Field `dueDate` must be an int64". Both shapes were found on
// real production tasks during the Phase 2 backfill: floats (rounded — semantically safe for
// timestamps) and outright corruption (one task carried a whole task OBJECT under `dueDate`;
// dropped — the fields are optional in the schema, so the record stays searchable).
const TIMESTAMP_FIELDS = ['dueDate', 'created', 'lastEditionDate', 'completed', 'date']

// Algolia records carry objectID; Typesense wants `id`. isPublicFor mixes the numeric
// FEED_PUBLIC_FOR_ALL sentinel with uid/workstream strings, so it is normalized to string[]
// to match the declared facet type (filters compare against the stringified sentinel too).
const normalizeDocumentForTypesense = object => {
    const { objectID, ...rest } = object
    const doc = { ...rest, id: String(objectID != null ? objectID : object.id) }
    if (Array.isArray(doc.isPublicFor)) {
        doc.isPublicFor = doc.isPublicFor.map(value => String(value))
    }
    TIMESTAMP_FIELDS.forEach(field => {
        const value = doc[field]
        if (value == null) return
        if (typeof value === 'number' && Number.isFinite(value)) {
            if (!Number.isInteger(value)) doc[field] = Math.round(value)
        } else {
            delete doc[field]
        }
    })
    Object.keys(doc).forEach(key => {
        if (doc[key] === undefined) delete doc[key]
    })
    return doc
}

const ensureCollection = async collectionName => {
    const client = getTypesenseClient()
    if (!client) return null
    if (!ensuredCollections[collectionName]) {
        ensuredCollections[collectionName] = (async () => {
            try {
                await client.collections(collectionName).retrieve()
            } catch (error) {
                if (error && error.httpStatus === 404) {
                    const schema = COLLECTION_SCHEMAS[collectionName]
                    if (!schema) throw new Error(`No Typesense schema defined for collection ${collectionName}`)
                    try {
                        await client.collections().create(schema)
                    } catch (createError) {
                        // A concurrent instance may have created it between retrieve and create.
                        if (!createError || createError.httpStatus !== 409) throw createError
                    }
                } else {
                    throw error
                }
            }
            return client
        })()
        // A failed ensure must not poison the cache for the whole cold start.
        ensuredCollections[collectionName].catch(() => {
            delete ensuredCollections[collectionName]
        })
    }
    return ensuredCollections[collectionName]
}

const upsertTypesenseDocument = async (collectionName, object) => {
    if (!isTypesenseConfigured()) return
    try {
        const client = await ensureCollection(collectionName)
        if (!client) return
        await client.collections(collectionName).documents().upsert(normalizeDocumentForTypesense(object))
    } catch (error) {
        console.error(`Typesense upsert failed (${collectionName}, ${object && object.objectID}):`, error.message)
    }
}

const deleteTypesenseDocument = async (collectionName, documentId) => {
    if (!isTypesenseConfigured()) return
    try {
        const client = await ensureCollection(collectionName)
        if (!client) return
        await client.collections(collectionName).documents(String(documentId)).delete()
    } catch (error) {
        // Deleting a document that was never indexed is not a failure.
        if (error && error.httpStatus === 404) return
        console.error(`Typesense delete failed (${collectionName}, ${documentId}):`, error.message)
    }
}

// Returns {imported, failed} so callers that care (the Phase 2 backfill) can verify;
// dual-write callers ignore the result. Still never throws.
const importTypesenseDocuments = async (collectionName, objects) => {
    if (!isTypesenseConfigured()) return { imported: 0, failed: 0 }
    if (!objects || objects.length === 0) return { imported: 0, failed: 0 }
    let imported = 0
    let failed = 0
    try {
        const client = await ensureCollection(collectionName)
        if (!client) return { imported, failed: objects.length }
        for (let i = 0; i < objects.length; i += IMPORT_BATCH_SIZE) {
            const batch = objects.slice(i, i + IMPORT_BATCH_SIZE).map(normalizeDocumentForTypesense)
            let results
            try {
                results = await client.collections(collectionName).documents().import(batch, { action: 'upsert' })
            } catch (importError) {
                // typesense-js THROWS an ImportError when any document in the batch fails —
                // the successful documents are already imported; the per-doc outcomes are on
                // error.importResults. Only a transport-level error has no importResults.
                if (importError && Array.isArray(importError.importResults)) {
                    results = importError.importResults
                } else {
                    throw importError
                }
            }
            const failures = results
                .map((result, index) => ({ ...result, document: batch[index] }))
                .filter(result => !result.success)
            imported += batch.length - failures.length
            failed += failures.length
            if (failures.length > 0) {
                console.error(
                    `Typesense import: ${failures.length}/${batch.length} documents failed (${collectionName}):`,
                    failures
                        .slice(0, 3)
                        .map(failure => `${failure.document && failure.document.id}: ${failure.error}`)
                        .join(' | ')
                )
            }
        }
    } catch (error) {
        failed += objects.length - imported - failed
        console.error(`Typesense import failed (${collectionName}, ${objects.length} docs):`, error.message)
    }
    return { imported, failed }
}

const deleteTypesenseDocumentsByFilter = async (collectionName, filterBy) => {
    if (!isTypesenseConfigured()) return
    try {
        const client = await ensureCollection(collectionName)
        if (!client) return
        await client.collections(collectionName).documents().delete({ filter_by: filterBy })
    } catch (error) {
        console.error(`Typesense delete-by-filter failed (${collectionName}, ${filterBy}):`, error.message)
    }
}

// Real project deletion only — the Algolia-side expiry/inactivity cleanups must NOT call
// this: Typesense keeps everything (that is the point of the migration).
const deleteTypesenseProjectRecords = async projectId => {
    if (!isTypesenseConfigured()) return
    await Promise.all(
        ALL_COLLECTIONS.map(collectionName =>
            deleteTypesenseDocumentsByFilter(collectionName, `projectId:=${JSON.stringify(String(projectId))}`)
        )
    )
}

// Per-collection query parameters — Typesense takes these per query where Algolia carried
// them in index settings. Must stay in sync with the client's utils/typesenseSearch.js.
const SEARCH_QUERY_CONFIG = {
    [TASKS_COLLECTION]: {
        query_by: 'humanReadableIdSearchable,humanReadableId,name',
        num_typos: 2,
        sort_by: '_text_match:desc,created(missing_values: last):desc',
    },
    [GOALS_COLLECTION]: {
        query_by: 'name',
        num_typos: 0,
        sort_by: '_text_match:desc,created(missing_values: last):desc',
    },
    [NOTES_COLLECTION]: {
        query_by: 'title,content',
        num_typos: 2,
        sort_by: '_text_match:desc,lastEditionDate(missing_values: last):desc',
    },
    [CONTACTS_COLLECTION]: {
        query_by: 'displayName,cleanDescription,role,company',
        num_typos: 0,
        sort_by: '_text_match:desc,lastEditionDate(missing_values: last):desc',
    },
    [CHATS_COLLECTION]: {
        query_by: 'cleanName,cleanLastComment,cleanComments',
        num_typos: 0,
        sort_by: '_text_match:desc,lastEditionDate(missing_values: last):desc',
    },
}

// Read path (server-side consumers: SearchService, TaskSearchService). THROWS on failure —
// the callers own their fallback behavior, and a silent empty result would read as
// "nothing matched" when the truth is "the search never ran".
// Hits come back in the Algolia shape: objectID = composite document id, `id` = the
// object's own bare id (reconstructed by stripping the projectId suffix).
const searchTypesenseDocuments = async (collectionName, query, { filterBy, perPage = 20 } = {}) => {
    const client = await ensureCollection(collectionName)
    if (!client) throw new Error('Typesense is not configured (TYPESENSE_HOST / TYPESENSE_ADMIN_API_KEY)')
    const config = SEARCH_QUERY_CONFIG[collectionName]
    if (!config) throw new Error(`No Typesense query config for collection ${collectionName}`)

    const result = await client.collections(collectionName).documents().search({
        q: query,
        query_by: config.query_by,
        num_typos: config.num_typos,
        sort_by: config.sort_by,
        filter_by: filterBy,
        per_page: perPage,
        highlight_fields: 'none',
    })

    const hits = (result.hits || []).map(hit => {
        const document = hit.document || {}
        const objectID = String(document.id || '')
        const bareId =
            document.projectId && objectID.endsWith(document.projectId)
                ? objectID.slice(0, -String(document.projectId).length)
                : objectID
        return { ...document, id: bareId, objectID }
    })
    return { hits }
}

// Backtick-quoted value for filter_by strings; a backtick inside a value would break out
// of the quoting, so it is stripped (no legitimate id carries one).
const formatTypesenseFilterValue = value => '`' + String(value).replace(/`/g, '') + '`'

// Verification helper (Phase 2 backfill): live document counts per collection. Unlike the
// write ops this THROWS on failure — a verification that silently reports nothing is worse
// than one that fails loudly.
const getTypesenseCollectionStats = async () => {
    const client = getTypesenseClient()
    if (!client) throw new Error('Typesense is not configured (TYPESENSE_HOST / TYPESENSE_ADMIN_API_KEY)')
    const stats = []
    for (const collectionName of ALL_COLLECTIONS) {
        try {
            const collection = await client.collections(collectionName).retrieve()
            stats.push({ name: collectionName, numDocuments: collection.num_documents })
        } catch (error) {
            if (error && error.httpStatus === 404) {
                stats.push({ name: collectionName, numDocuments: 0, missing: true })
            } else {
                throw error
            }
        }
    }
    return stats
}

// Test seam: reset module-level caches between tests.
const __resetTypesenseCachesForTests = () => {
    cachedClient = null
    Object.keys(ensuredCollections).forEach(key => delete ensuredCollections[key])
}

module.exports = {
    TASKS_COLLECTION,
    GOALS_COLLECTION,
    NOTES_COLLECTION,
    CONTACTS_COLLECTION,
    CHATS_COLLECTION,
    ALL_COLLECTIONS,
    COLLECTION_SCHEMAS,
    isTypesenseConfigured,
    getTypesenseClient,
    normalizeDocumentForTypesense,
    upsertTypesenseDocument,
    deleteTypesenseDocument,
    importTypesenseDocuments,
    deleteTypesenseDocumentsByFilter,
    deleteTypesenseProjectRecords,
    getTypesenseCollectionStats,
    searchTypesenseDocuments,
    formatTypesenseFilterValue,
    __resetTypesenseCachesForTests,
}
