// Shared by browser searches and the server-side search services. Keep ranking in the
// engine so it applies to the whole result set before per_page / page, not just 20 hits.
// Typesense 29 supports fixed-size relevance buckets:
// https://typesense.org/docs/guide/ranking-and-relevance.html
const RECENCY_BUCKET_SIZE = 5
const RECENCY_SORT = `_text_match(bucket_size: ${RECENCY_BUCKET_SIZE}):desc,lastEditionDate(missing_values: last):desc`

const EXACT_MATCH_FIELDS = {
    dev_tasks: ['humanReadableIdSearchable', 'humanReadableId', 'name'],
    dev_goals: ['name'],
    dev_notes: ['title'],
    dev_contacts: ['displayName', 'role', 'company'],
    dev_updates: ['cleanName'],
}

const buildRecencySortBy = (collection, query, queryBy) => {
    const text = typeof query === 'string' ? query.trim() : ''
    if (!text || text === '*') return 'lastEditionDate(missing_values: last):desc'

    // Promote whole-field identity matches separately: bucketing alone can bury an old
    // exact title / task ID under a newer prefix or typo match. Only evaluate searched
    // identity fields, never body text. Existing identity-first merging stays intact.
    const searchedFields = queryBy.split(',')
    const fields = (EXACT_MATCH_FIELDS[collection] || []).filter(field => searchedFields.includes(field))
    // Backticks delimit Typesense filter literals. For unusual queries containing one,
    // retain strict textual ranking instead of altering the query or risking injection.
    if (text.includes('`') || fields.length === 0) {
        return '_text_match:desc,lastEditionDate(missing_values: last):desc'
    }
    const exactMatch = fields.map(field => `${field}:=\`${text}\``).join(' || ')
    // Five-result groups allow recency to overcome moderate score differences without
    // making broad queries pure date sorts. With fewer than five matches Typesense keeps
    // strict textual order. Exact identity matches always lead the list.
    return `_eval(${exactMatch}):desc,${RECENCY_SORT}`
}

module.exports = { buildRecencySortBy, RECENCY_SORT, RECENCY_BUCKET_SIZE }
