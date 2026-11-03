// Shared by browser searches and the server-side search services. Keep ranking in the
// engine so it applies to the whole result set before per_page / page, not just 20 hits.
// Typesense 29 supports fixed-size relevance buckets:
// https://typesense.org/docs/guide/ranking-and-relevance.html
const RECENCY_BUCKET_SIZE = 5
const RECENCY_SORT = `_text_match(bucket_size: ${RECENCY_BUCKET_SIZE}):desc,lastEditionDate(missing_values: last):desc`
const STRICT_TEXT_SORT = '_text_match:desc,lastEditionDate(missing_values: last):desc'
const RECENCY_ONLY_SORT = 'lastEditionDate(missing_values: last):desc'

const EXACT_MATCH_FIELDS = {
    dev_tasks: ['humanReadableIdSearchable', 'humanReadableId', 'name'],
    dev_goals: ['name'],
    dev_notes: ['title'],
    dev_contacts: ['displayName', 'role', 'company'],
    dev_updates: ['cleanName'],
    dev_artifacts: ['title'],
    dev_wiki: ['title'],
}

// Weights of the AT-2945 tiers inside one weighted `_eval`. Ordered so the result is the
// same whether Typesense scores a document by the first, the highest or the sum of the
// expressions it matches.
const EXACT_AND_OWN_WEIGHT = 3
const EXACT_WEIGHT = 2
const OWN_WEIGHT = 1

const CREATOR_ATTRIBUTE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/

// AT-2945: `{ attribute, userId }` → a safe `attribute:=\`userId\`` clause, or '' when the
// boost cannot be expressed. The attribute is a field name chosen by the caller, never user
// input, but it is still validated: an unexpected value must degrade to "no boost", not to
// a malformed sort that makes Typesense fail the whole search.
const buildCreatorClause = boostCreator => {
    if (!boostCreator) return ''
    const { attribute, userId } = boostCreator
    if (typeof attribute !== 'string' || !CREATOR_ATTRIBUTE_PATTERN.test(attribute)) return ''
    const value = typeof userId === 'string' || typeof userId === 'number' ? String(userId).replace(/`/g, '') : ''
    if (!value) return ''
    return `${attribute}:=\`${value}\``
}

// `options.boostCreator` (AT-2945, global search only): `{ attribute, userId }` naming the
// record field that holds the creator and the signed-in user. Objects that user created rank
// ahead of everybody else's matches, with two limits that keep the ranking about relevance:
// an exact identity match (title / name / task id equal to the query) still leads the list —
// the user's own exact match first, then others' exact matches — and inside the "mine" and
// "not mine" groups the order is the unchanged relevance-bucket + recency order. It is a
// sort, never a filter: nothing is removed, and access stays entirely in `filter_by`.
// Typesense allows only three sort fields, which is why the boost shares the first `_eval`
// with the exact-match guard instead of getting a field of its own.
const buildRecencySortBy = (collection, query, queryBy, options = {}) => {
    const text = typeof query === 'string' ? query.trim() : ''
    // A wildcard / blank page is a "what did I touch last" list, not a ranked one.
    if (!text || text === '*') return RECENCY_ONLY_SORT

    const ownClause = buildCreatorClause(options.boostCreator)

    // Promote whole-field identity matches separately: bucketing alone can bury an old
    // exact title / task ID under a newer prefix or typo match. Only evaluate searched
    // identity fields, never body text. Existing identity-first merging stays intact.
    const searchedFields = String(queryBy || '').split(',')
    const fields = (EXACT_MATCH_FIELDS[collection] || []).filter(field => searchedFields.includes(field))
    // Backticks delimit Typesense filter literals. For unusual queries containing one,
    // retain strict textual ranking instead of altering the query or risking injection.
    if (text.includes('`') || fields.length === 0) {
        return ownClause ? `_eval(${ownClause}):desc,${STRICT_TEXT_SORT}` : STRICT_TEXT_SORT
    }
    const exactMatch = fields.map(field => `${field}:=\`${text}\``).join(' || ')
    // Five-result groups allow recency to overcome moderate score differences without
    // making broad queries pure date sorts. With fewer than five matches Typesense keeps
    // strict textual order. Exact identity matches always lead the list.
    if (!ownClause) return `_eval(${exactMatch}):desc,${RECENCY_SORT}`

    const tiers = [
        `((${exactMatch}) && ${ownClause}):${EXACT_AND_OWN_WEIGHT}`,
        `(${exactMatch}):${EXACT_WEIGHT}`,
        `(${ownClause}):${OWN_WEIGHT}`,
    ]
    return `_eval([${tiers.join(',')}]):desc,${RECENCY_SORT}`
}

module.exports = { buildRecencySortBy, RECENCY_SORT, RECENCY_BUCKET_SIZE }
