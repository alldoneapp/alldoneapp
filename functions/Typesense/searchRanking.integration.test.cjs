// Real-engine check, isolated from production and Jest's React Native setup:
// Start Typesense 29 locally with --api-key=at2663-local-test --api-port=18108.
// node --test functions/Typesense/searchRanking.integration.test.cjs
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildRecencySortBy } = require('./searchRanking')

const origin = process.env.TYPESENSE_TEST_ORIGIN || 'http://127.0.0.1:18108'
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname), 'Use a local test server')
const apiKey = process.env.TYPESENSE_TEST_API_KEY || 'at2663-local-test'

const request = async (path, method = 'GET', body) => {
    const response = await fetch(`${origin}${path}`, {
        method,
        headers: { 'X-TYPESENSE-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: body && JSON.stringify(body),
    })
    const result = await response.json()
    assert.ok(response.ok, JSON.stringify(result))
    return result
}

for (const [entity, queryBy, identityField] of [
    ['dev_tasks', 'humanReadableIdSearchable,humanReadableId,name', 'name'],
    ['dev_goals', 'name', 'name'],
    ['dev_notes', 'title,content', 'title'],
    ['dev_contacts', 'displayName,cleanDescription,role,company', 'displayName'],
    ['dev_updates', 'cleanName,cleanLastComment,cleanComments', 'cleanName'],
]) {
    test(`${entity}: moderate relevance boost, exact protection, edit dates, missing dates and pagination`, async t => {
        const collection = `at2663_${entity}_${process.pid}`
        await request('/collections', 'POST', {
            name: collection,
            fields: [
                ...queryBy.split(',').map(name => ({ name, type: 'string', optional: true })),
                { name: 'lastEditionDate', type: 'int64', optional: true },
                { name: 'created', type: 'int64', optional: true },
                { name: 'projectId', type: 'string' },
                { name: 'isPublicFor', type: 'string[]' },
            ],
        })
        t.after(() => request(`/collections/${collection}`, 'DELETE'))
        const fixtures = [
            ['exact', 'Product roadmap', 1, 1],
            ['old-relevant', 'Product roadmap strategy for next year', 2, 1000],
            ['recent-moderate', 'Product strategy for next year roadmap', 100, 1],
            ['recent-prefix', 'Product roadmapping', 101, 1],
            ['missing-date', 'Product roadmap missing date', undefined, 2000],
        ]
        for (const [id, name, lastEditionDate, created] of fixtures) {
            await request(`/collections/${collection}/documents`, 'POST', {
                id,
                [identityField]: name,
                lastEditionDate,
                created,
                projectId: 'project',
                isPublicFor: ['0'],
            })
        }
        await request(`/collections/${collection}/documents`, 'POST', {
            id: 'private-exact',
            [identityField]: 'Product roadmap',
            lastEditionDate: 10000,
            projectId: 'project',
            isPublicFor: ['someone-else'],
        })

        const search = async (sortBy, page = 1, perPage = 20, q = 'Product roadmap') => {
            const response = await request('/multi_search', 'POST', {
                searches: [
                    {
                        collection,
                        q,
                        query_by: queryBy,
                        sort_by: sortBy,
                        filter_by: 'projectId:=project && isPublicFor:=[`0`]',
                        page,
                        per_page: perPage,
                        drop_tokens_threshold: 100,
                    },
                ],
            })
            const result = response.results[0]
            assert.equal(result.error, undefined)
            return result.hits
        }
        const sort = buildRecencySortBy(entity, 'Product roadmap', queryBy)
        const baseline = await search('_text_match:desc,lastEditionDate(missing_values: last):desc')
        const boosted = await search(sort)
        const ids = hits => hits.map(hit => hit.document.id)
        assert.ok(ids(baseline).indexOf('old-relevant') < ids(baseline).indexOf('recent-moderate'))
        assert.ok(
            BigInt(baseline.find(h => h.document.id === 'old-relevant').text_match_info.score) >
                BigInt(baseline.find(h => h.document.id === 'recent-moderate').text_match_info.score)
        )
        assert.deepEqual(ids(boosted), ['exact', 'recent-prefix', 'recent-moderate', 'old-relevant', 'missing-date'])
        const pages = []
        for (let page = 1; page <= 3; page++) pages.push(...(await search(sort, page, 2)))
        assert.deepEqual(ids(pages), ids(boosted))

        const wildcard = await search(buildRecencySortBy(entity, '*', queryBy), 1, 20, '*')
        assert.deepEqual(ids(wildcard), ['recent-prefix', 'recent-moderate', 'old-relevant', 'exact', 'missing-date'])

        // A very recent one-token fallback outside the first relevance group stays below
        // the fitting matches. Recency cannot turn this into an unrestricted date sort.
        await request(`/collections/${collection}/documents`, 'POST', {
            id: 'recent-weak',
            [identityField]: 'Product unrelated',
            lastEditionDate: 99999,
            projectId: 'project',
            isPublicFor: ['0'],
        })
        assert.equal(ids(await search(sort)).at(-1), 'recent-weak')
    })
}

test('task human-readable IDs remain protected', async t => {
    const collection = `at2663_ids_${process.pid}`
    await request('/collections', 'POST', {
        name: collection,
        token_separators: ['#', '-', '_'],
        fields: [
            { name: 'humanReadableId', type: 'string' },
            { name: 'lastEditionDate', type: 'int64' },
        ],
    })
    t.after(() => request(`/collections/${collection}`, 'DELETE'))
    for (let i = 0; i < 5; i++) {
        await request(`/collections/${collection}/documents`, 'POST', {
            id: String(i),
            humanReadableId: i === 0 ? 'AT-2663' : `AT-2663${i}`,
            lastEditionDate: i + 1,
        })
    }
    const response = await request('/multi_search', 'POST', {
        searches: [
            {
                collection,
                q: 'AT-2663',
                query_by: 'humanReadableId',
                sort_by: buildRecencySortBy('dev_tasks', 'AT-2663', 'humanReadableId'),
            },
        ],
    })
    assert.equal(response.results[0].error, undefined)
    assert.equal(response.results[0].hits[0].document.id, '0')
})
