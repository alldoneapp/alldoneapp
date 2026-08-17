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

// Matches the Algolia hitsPerPage the index settings used to pin (AMOUNT_OF_SEARCH_BY_PROJECT).
const PER_PAGE = 100

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
    const { TYPESENSE_HOST, TYPESENSE_SEARCH_ONLY_API_KEY } = Backend.getTypesenseSearchKeys()
    if (!TYPESENSE_HOST || !TYPESENSE_SEARCH_ONLY_API_KEY) {
        throw new Error('Typesense search keys are not configured')
    }

    const body = {
        searches: searches.map(({ collection, query, filterBy }) => {
            const config = TYPESENSE_QUERY_CONFIG[collection]
            return {
                collection,
                q: query,
                query_by: config.query_by,
                num_typos: config.num_typos,
                sort_by: config.sort_by,
                filter_by: filterBy,
                per_page: PER_PAGE,
                highlight_fields: 'none',
                exclude_fields: 'content,cleanComments',
            }
        }),
    }

    const response = await fetch(`https://${TYPESENSE_HOST}/multi_search`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-TYPESENSE-API-KEY': TYPESENSE_SEARCH_ONLY_API_KEY,
        },
        body: JSON.stringify(body),
    })

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
export const searchTypesenseCollection = async (collection, query, filterBy) => {
    const [result] = await multiSearchTypesense([{ collection, query, filterBy }])
    return result
}
