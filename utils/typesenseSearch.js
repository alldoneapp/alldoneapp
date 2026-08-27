// Client-side Typesense search (TYPESENSE_MIGRATION.md Phase 3). Deliberately a plain
// fetch against the multi_search endpoint — no typesense-js dependency, so the web bundle
// and the CI node_modules images are untouched.
//
// Per-collection query config mirrors what the Algolia INDEX SETTINGS used to carry
// (configAlgoliaIndex in functions/searchHelper.js): searchable attributes, typo
// tolerance, ranking. In Typesense these are per-query parameters, so they live here.
// Sort fields are optional in the schema, so missing_values keeps legacy records at the
// end instead of erroring.
import Backend from './BackendBridge'
import { isBrowserOffline } from './connectionState'

export const TYPESENSE_QUERY_CONFIG = {
    dev_tasks: {
        query_by: 'humanReadableIdSearchable,humanReadableId,name',
        num_typos: 2,
        sort_by: '_text_match:desc,created(missing_values: last):desc',
    },
    dev_goals: {
        query_by: 'name',
        num_typos: 0,
        sort_by: '_text_match:desc,created(missing_values: last):desc',
    },
    dev_notes: {
        query_by: 'title,content',
        num_typos: 2,
        sort_by: '_text_match:desc,lastEditionDate(missing_values: last):desc',
    },
    dev_contacts: {
        query_by: 'displayName,cleanDescription,role,company',
        num_typos: 0,
        sort_by: '_text_match:desc,lastEditionDate(missing_values: last):desc',
    },
    dev_updates: {
        query_by: 'cleanName,cleanLastComment,cleanComments',
        num_typos: 0,
        sort_by: '_text_match:desc,lastEditionDate(missing_values: last):desc',
    },
}

// Global search queries five collections at once. Twenty results per collection is ample
// for the modal while avoiding the old worst case of 500 full records per keystroke.
const PER_PAGE = 20
const CREDENTIAL_REFRESH_SKEW_SECONDS = 60

let cachedCredentials = null
let credentialsPromise = null

const credentialsAreFresh = (credentials, userId) => {
    return (
        credentials &&
        userId &&
        credentials.userId === userId &&
        credentials.origin &&
        credentials.apiKey &&
        Number(credentials.expiresAt) > Math.floor(Date.now() / 1000) + CREDENTIAL_REFRESH_SKEW_SECONDS
    )
}

const getTypesenseScopedSearchCredentials = async ({ forceRefresh = false } = {}) => {
    const userId = Backend.getCurrentUserId()
    if (!userId) throw new Error('Typesense search requires an authenticated user')
    if (!forceRefresh && credentialsAreFresh(cachedCredentials, userId)) return cachedCredentials
    if (!forceRefresh && credentialsPromise) return credentialsPromise

    const request = Backend.getTypesenseScopedSearchCredentials().then(credentials => {
        if (!credentialsAreFresh(credentials, userId) || Backend.getCurrentUserId() !== userId) {
            throw new Error('Typesense scoped search credentials are invalid, expired, or belong to another user')
        }
        cachedCredentials = {
            ...credentials,
            origin: credentials.origin.replace(/\/$/, ''),
        }
        return cachedCredentials
    })
    credentialsPromise = request

    try {
        return await request
    } finally {
        if (credentialsPromise === request) credentialsPromise = null
    }
}

export const __resetTypesenseCredentialCacheForTests = () => {
    cachedCredentials = null
    credentialsPromise = null
}

export const adaptTypesenseHit = hit => {
    const document = hit.document || {}
    // Downstream code (ResultLists, mention insertion, parent-goal picking) reads the
    // Algolia hit shape: objectID = the composite `objectId + projectId`, and `id` = the
    // object's own bare id. Typesense reserves `id` for the document id (the composite),
    // so the bare id is reconstructed by stripping the projectId suffix — exact by
    // construction, and the same derivation SearchService uses server-side.
    const objectID = String(document.id || '')
    const bareId =
        document.projectId && objectID.endsWith(document.projectId)
            ? objectID.slice(0, -String(document.projectId).length)
            : objectID

    // Typesense stores this mixed legacy field as string[]. The public sentinel is numeric `0`
    // everywhere else in the app, and privacy checks intentionally use strict equality. Leaving
    // the search hit as `"0"` makes a public goal look private after the parent-goal picker saves
    // it to a task, so the relationship is persisted but immediately hidden by the task UI.
    const isPublicFor = Array.isArray(document.isPublicFor)
        ? document.isPublicFor.map(userId => (userId === '0' ? 0 : userId))
        : document.isPublicFor
    const privacyData = Object.prototype.hasOwnProperty.call(document, 'isPublicFor') ? { isPublicFor } : {}

    return { ...document, ...privacyData, id: bareId, objectID }
}

// searches: [{ collection, query, filterBy }] → resolves [{ hits }] in the same order.
// One HTTP round-trip for any number of collections. A per-collection error (e.g. a
// collection that does not exist yet) yields { hits: [], error } for that entry rather
// than failing the others.
export const multiSearchTypesense = async searches => {
    // Search has no offline index — fail fast with an identifiable error so the
    // consumers (global search, mentions) can degrade instead of hanging on a
    // doomed fetch (OFFLINE_SUPPORT_PLAN.md Stage 7).
    if (isBrowserOffline()) {
        const offlineError = new Error('Search needs an internet connection')
        offlineError.code = 'offline'
        throw offlineError
    }

    const body = {
        searches: searches.map(({ collection, query, filterBy, queryBy }) => {
            const config = TYPESENSE_QUERY_CONFIG[collection]
            return {
                collection,
                q: query,
                // `queryBy` narrows the searched fields for one call without moving the
                // collection default. A picker can be stricter than global search about
                // what counts as a match — the @-mention contact picker is (AT-2393) —
                // while global search keeps the full field list.
                query_by: queryBy || config.query_by,
                num_typos: config.num_typos,
                sort_by: config.sort_by,
                filter_by: filterBy,
                per_page: PER_PAGE,
                highlight_fields: 'none',
                exclude_fields: 'content,cleanComments',
            }
        }),
    }

    const runSearch = async forceRefresh => {
        const { origin, apiKey } = await getTypesenseScopedSearchCredentials({ forceRefresh })
        return await fetch(`${origin}/multi_search`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-TYPESENSE-API-KEY': apiKey,
            },
            body: JSON.stringify(body),
        })
    }

    let response = await runSearch(false)
    // A cached scoped key can expire between the local freshness check and Typesense
    // receiving the request. Refresh once; other failures must surface unchanged.
    if (response.status === 401) response = await runSearch(true)

    if (!response.ok) {
        throw new Error(`Typesense multi_search failed with status ${response.status}`)
    }

    const payload = await response.json()
    return payload.results.map(result => {
        if (result.error) {
            console.log('Typesense search error:', result.error)
            return { hits: [], error: result.error }
        }
        return { hits: (result.hits || []).map(adaptTypesenseHit) }
    })
}

// Drop-in analogue of algoliaIndex.search(query, { filters }) for one collection.
// `options.queryBy` overrides the collection's default searchable fields for this call.
export const searchTypesenseCollection = async (collection, query, filterBy, options = {}) => {
    const [result] = await multiSearchTypesense([{ collection, query, filterBy, queryBy: options.queryBy }])
    return result
}
