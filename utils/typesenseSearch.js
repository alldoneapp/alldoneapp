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

// `identity_query_by` is the subset of `query_by` that NAMES the object — its title, its
// display name, its human-readable id. See the AT-2527 block above `getIdentityQueryBy`
// below for why every collection carries one; where it equals `query_by` there is nothing
// to separate and the second page is never requested.
export const TYPESENSE_QUERY_CONFIG = {
    dev_tasks: {
        query_by: 'humanReadableIdSearchable,humanReadableId,name',
        identity_query_by: 'humanReadableIdSearchable,humanReadableId,name',
        num_typos: 2,
        sort_by: '_text_match:desc,created(missing_values: last):desc',
    },
    dev_goals: {
        query_by: 'name',
        identity_query_by: 'name',
        num_typos: 0,
        sort_by: '_text_match:desc,created(missing_values: last):desc',
    },
    dev_notes: {
        query_by: 'title,content',
        identity_query_by: 'title',
        num_typos: 2,
        sort_by: '_text_match:desc,lastEditionDate(missing_values: last):desc',
    },
    dev_contacts: {
        // Identity fields only — deliberately the same list as MENTION_CONTACTS_QUERY_BY
        // (AT-2393). Role and company stay in: "ceo", "bcg" are short, deliberate, and how
        // people look someone up when the name escapes them. The free-text description is
        // what has to be kept off the short-query page.
        query_by: 'displayName,cleanDescription,role,company',
        identity_query_by: 'displayName,role,company',
        num_typos: 0,
        sort_by: '_text_match:desc,lastEditionDate(missing_values: last):desc',
    },
    dev_updates: {
        query_by: 'cleanName,cleanLastComment,cleanComments',
        identity_query_by: 'cleanName',
        num_typos: 0,
        sort_by: '_text_match:desc,lastEditionDate(missing_values: last):desc',
    },
}

// Global search queries five collections at once. Twenty results per collection is ample
// for the modal while avoiding the old worst case of 500 full records per keystroke.
const PER_PAGE = 20
const CREDENTIAL_REFRESH_SKEW_SECONDS = 60

// `*` is Typesense's DOCUMENTED match-all: it returns every document the `filter_by` admits,
// which is what a PICKER opened with nothing typed wants.
//
// Read the history here before changing it, because the obvious reading of it is wrong.
// This was introduced (AT-2497, MR !495) on the belief that `q: ''` "tokenizes to nothing and
// matches nothing", i.e. that the @-mention Notes tab was BLANK until you typed. That is not
// true, and the ticket did not improve for the user because of it: driven against a real
// Typesense server, `q: ''` returns exactly the same page, in exactly the same order, as
// `q: '*'` — including under the pre-existing `_text_match:desc,lastEditionDate:desc` sort,
// because every document ties on the text score. The mention picker was already being handed
// the user's most recently edited notes; what was wrong with AT-2497 was downstream of this
// module (see mentionSearch.js and MentionsItemsGrouped.js).
//
// It is kept anyway, on the honest reason rather than the invented one: `*` is specified,
// an empty `q` is not — Typesense documents `q=*` as the way to match all documents and
// makes no promise at all about `''`, so relying on today's behaviour of a blank query is
// relying on an implementation detail across future engine upgrades. It is also the form
// that lets `buildSortBy` below know a page is unranked.
//
// It is opt-in per call rather than automatic because the two kinds of caller want opposite
// things. A picker starts empty and should suggest something; global search starts empty and
// must stay quiet (it already refuses to run at all on blank input), and a filter builder
// that silently produces an empty `filterBy` must not turn into "show the user everything".
export const TYPESENSE_MATCH_ALL_QUERY = '*'

export const isBlankQuery = query => typeof query !== 'string' || query.trim() === ''

// For a wildcard query every document scores the same `_text_match`, so leading with it only
// obscures the field that actually orders the list. Dropping it makes the recency sort the
// primary criterion, which is the whole point of the match-all request.
export const buildSortBy = (sortBy, isMatchAll) => {
    if (!isMatchAll || typeof sortBy !== 'string') return sortBy
    const withoutTextMatch = sortBy
        .split(',')
        .filter(criterion => !criterion.trim().startsWith('_text_match'))
        .join(',')
    return withoutTextMatch || sortBy
}

// AT-2527 — "sometimes I have to enter more letters until it starts finding results."
//
// There is no minimum query length in this app and never has been: global search runs on one
// character, the @-mention picker searches with none at all. What the report is about is
// RANKING, and the cause is the same one AT-2393 already documented one directory over — it
// was fixed for the mention picker and deliberately left alone for global search, which
// "keeps the full field list".
//
// A one- or two-character query is prefix-matched against every field in `query_by`, and
// three of the five collections search a long free-text body: notes search `content` (the
// whole note), contacts search `cleanDescription` (the whole description — the reporting
// account's is 2,624 characters covering 25 of the 26 single letters), chats search
// `cleanComments` (every comment concatenated). Nearly every document contains SOME word
// starting with "an", so nearly every document matches. Typesense then ranks by
// `_text_match:desc` — which ties heavily when there is only one short token to score — and
// the recency tiebreaker decides. The user gets the twenty most recent documents that happen
// to contain an "an*" word anywhere in their body, and the note actually TITLED "Annual
// review" is nowhere on the page. Type two more letters, the candidate set collapses, and it
// appears: "it starts finding results".
//
// So the fix is not a threshold — it is to stop a body match crowding out a name match. Each
// collection declares the subset of its fields that NAME the object, and an identity-first
// search asks for two pages in the SAME multi_search round trip: the identity fields alone,
// then the full field list exactly as before. `mergeIdentityFirstHits` puts the name matches
// first and dedupes.
//
// Three properties make this safe to apply unconditionally rather than only under some
// "short query" rule — which is the point, because a hard cutoff would just move the cliff
// the user is complaining about to a different letter count:
//
//   - It cannot hide anything. The full-field page is still requested, still capped at the
//     same `per_page`, and still fills every slot the identity page does not use. A body-only
//     match is reordered, never dropped.
//   - It cannot mis-rank a long query. If a specific query has no name match, the identity
//     page comes back empty and the result is byte-identical to today's.
//   - It costs nothing where it buys nothing. Expansion is skipped when the identity list
//     equals the full list (tasks and goals already search only identity fields), so global
//     search issues eight engine searches per submit rather than five — in one HTTP request,
//     and only on submit, since global search is Enter-driven and not search-as-you-type.
//
// It is opt-in per call because a wildcard page has no text to rank: a picker opened with
// nothing typed wants "what I touched last" (TYPESENSE_MATCH_ALL_QUERY above), and splitting
// that into two identical recency pages would be pure waste. `expandsToIdentityFirst` skips
// it for exactly that case.
const getIdentityQueryBy = (collection, queryBy) => {
    const config = TYPESENSE_QUERY_CONFIG[collection] || {}
    // A caller that already narrowed `queryBy` for this one call (the mention contacts
    // picker does) has made the same decision by hand; leave it alone.
    if (queryBy) return ''
    const identity = config.identity_query_by
    if (!identity || identity === config.query_by) return ''
    return identity
}

const expandsToIdentityFirst = search => {
    if (!search || !search.identityFirst) return false
    // A match-all page is ordered by recency, not by text — nothing to re-rank.
    if (search.matchAllWhenEmpty && isBlankQuery(search.query)) return false
    if (isBlankQuery(search.query)) return false
    return !!getIdentityQueryBy(search.collection, search.queryBy)
}

const getHitKey = hit => {
    if (!hit) return ''
    if (hit.objectID) return String(hit.objectID)
    if (hit.id) return `${hit.projectId || ''}:${hit.id}`
    return ''
}

/**
 * Name matches first, then everything else, deduplicated, capped at `limit`.
 *
 * Both inputs arrive already ranked by the engine and that order is preserved inside each
 * block. A short page on either side is never padded: fewer results is a correct answer.
 */
export const mergeIdentityFirstHits = (identityHits, fullHits, limit = PER_PAGE) => {
    const identity = Array.isArray(identityHits) ? identityHits : []
    const full = Array.isArray(fullHits) ? fullHits : []

    const seen = new Set()
    const merged = []
    const push = hit => {
        const key = getHitKey(hit)
        if (!key || seen.has(key) || merged.length >= limit) return
        seen.add(key)
        merged.push(hit)
    }

    identity.forEach(push)
    full.forEach(push)

    return merged
}

const readTypesenseErrorDetail = async response => {
    try {
        const rawBody = await response.text()
        if (!rawBody) return ''
        try {
            const payload = JSON.parse(rawBody)
            return String(payload.message || payload.error || rawBody)
                .replace(/\s+/g, ' ')
                .slice(0, 500)
        } catch (_) {
            return rawBody.replace(/\s+/g, ' ').slice(0, 500)
        }
    } catch (_) {
        return ''
    }
}

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

// Fetch the short-lived scoped key before the user submits their first query. This is deliberately
// best-effort: opening Search must still work when the browser is offline or the callable is
// temporarily unavailable. getTypesenseScopedSearchCredentials owns the shared in-flight promise,
// so a real search that starts during this warm-up waits for the same request instead of issuing a
// duplicate one.
export const warmTypesenseSearchCredentials = async () => {
    if (isBrowserOffline()) return false

    try {
        await getTypesenseScopedSearchCredentials()
        return true
    } catch (error) {
        return false
    }
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

// searches: [{ collection, query, filterBy, queryBy, matchAllWhenEmpty }] → resolves
// [{ hits }] in the same order. One HTTP round-trip for any number of collections. A
// per-collection error (e.g. a collection that does not exist yet) yields { hits: [], error }
// for that entry rather than failing the others.
//
// `matchAllWhenEmpty` turns a blank query into the `*` wildcard so the caller gets the
// collection's most recent records instead of nothing — see TYPESENSE_MATCH_ALL_QUERY.
// A positive `page` opts a search into pagination and adds `hasMore` to its result.
// The per-page bound stays unchanged, including when using scoped credentials.
export const multiSearchTypesense = async searches => {
    // Search has no offline index — fail fast with an identifiable error so the
    // consumers (global search, mentions) can degrade instead of hanging on a
    // doomed fetch (OFFLINE_SUPPORT_PLAN.md Stage 7).
    if (isBrowserOffline()) {
        const offlineError = new Error('Search needs an internet connection')
        offlineError.code = 'offline'
        throw offlineError
    }

    const buildEngineSearch = (search, queryByOverride) => {
        const { collection, query, filterBy, queryBy, matchAllWhenEmpty } = search
        const config = TYPESENSE_QUERY_CONFIG[collection]
        const isMatchAll = !!matchAllWhenEmpty && isBlankQuery(query)
        return {
            collection,
            q: isMatchAll ? TYPESENSE_MATCH_ALL_QUERY : query,
            // `queryBy` narrows the searched fields for one call without moving the
            // collection default. A picker can be stricter than global search about
            // what counts as a match — the @-mention contact picker is (AT-2393) —
            // while global search keeps the full field list and instead leads with the
            // identity page (AT-2527).
            query_by: queryByOverride || queryBy || config.query_by,
            num_typos: config.num_typos,
            sort_by: buildSortBy(config.sort_by, isMatchAll),
            filter_by: filterBy,
            per_page: PER_PAGE,
            ...(Number.isInteger(search.page) && search.page > 0 ? { page: search.page } : {}),
            highlight_fields: 'none',
            exclude_fields: 'content,cleanComments',
        }
    }

    // One logical search can become two engine searches (identity page + full page). `plan`
    // keeps the mapping so the returned array stays in the caller's order, one entry per
    // requested search, whatever the expansion did.
    const engineSearches = []
    const plan = searches.map(search => {
        if (!expandsToIdentityFirst(search)) {
            return { fullIndex: engineSearches.push(buildEngineSearch(search)) - 1 }
        }
        const identityQueryBy = getIdentityQueryBy(search.collection, search.queryBy)
        const identityIndex = engineSearches.push(buildEngineSearch(search, identityQueryBy)) - 1
        const fullIndex = engineSearches.push(buildEngineSearch(search)) - 1
        return { identityIndex, fullIndex }
    })

    const body = { searches: engineSearches }

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
        const detail = await readTypesenseErrorDetail(response)
        const error = new Error(
            `Typesense multi_search failed with status ${response.status}${detail ? `: ${detail}` : ''}`
        )
        error.code = 'search_unavailable'
        error.status = response.status
        throw error
    }

    const payload = await response.json()
    const engineResults = (payload.results || []).map((result, index) => {
        if (result.error) {
            console.log('Typesense search error:', result.error)
            return { hits: [], error: result.error }
        }
        const hits = (result.hits || []).map(adaptTypesenseHit)
        const page = engineSearches[index]?.page
        return {
            hits,
            ...(page
                ? {
                      hasMore: Number.isFinite(result.found)
                          ? page * PER_PAGE < result.found
                          : hits.length === PER_PAGE,
                  }
                : {}),
        }
    })

    return plan.map(({ identityIndex, fullIndex }) => {
        const full = engineResults[fullIndex] || { hits: [], error: 'Missing Typesense result' }
        if (identityIndex == null) return full

        const identity = engineResults[identityIndex] || { hits: [] }
        // One page failing must not lose the other: an identity page that errored still
        // leaves the full page perfectly usable — that is the pre-AT-2527 behaviour — and a
        // failed full page still leaves the name matches. Only report an error when there is
        // genuinely nothing to show, so a caller's error handling keeps its old meaning.
        if (identity.error && full.error) return full
        return { hits: mergeIdentityFirstHits(identity.hits, full.hits) }
    })
}

// Drop-in analogue of algoliaIndex.search(query, { filters }) for one collection.
// `options.queryBy` overrides the collection's default searchable fields for this call.
// `options.matchAllWhenEmpty` makes a blank query return the most recent records instead
// of nothing (AT-2497).
export const searchTypesenseCollection = async (collection, query, filterBy, options = {}) => {
    const [result] = await multiSearchTypesense([
        {
            collection,
            query,
            filterBy,
            queryBy: options.queryBy,
            matchAllWhenEmpty: options.matchAllWhenEmpty,
            identityFirst: options.identityFirst,
            page: options.page,
        },
    ])
    return result
}
