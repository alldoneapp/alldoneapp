import Backend from './BackendBridge'
import {
    __resetTypesenseCredentialCacheForTests,
    buildSortBy,
    isBlankQuery,
    mergeIdentityFirstHits,
    multiSearchTypesense,
    searchTypesenseCollection,
    TYPESENSE_MATCH_ALL_QUERY,
    TYPESENSE_QUERY_CONFIG,
    warmTypesenseSearchCredentials,
} from './typesenseSearch'

jest.mock('./BackendBridge', () => ({
    getTypesenseScopedSearchCredentials: jest.fn(),
    getCurrentUserId: jest.fn(),
}))

const VALID_CREDENTIALS = {
    userId: 'user-1',
    origin: 'https://search.example.com',
    apiKey: 'test-scoped-key',
    expiresAt: 4102444800,
}

const setNavigatorOnLine = value => {
    Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
}

describe('multiSearchTypesense offline fast-fail (OFFLINE_SUPPORT_PLAN.md Stage 7)', () => {
    beforeEach(() => {
        __resetTypesenseCredentialCacheForTests()
        Backend.getCurrentUserId.mockReturnValue('user-1')
        Backend.getTypesenseScopedSearchCredentials.mockResolvedValue(VALID_CREDENTIALS)
    })

    afterEach(() => {
        setNavigatorOnLine(true)
        delete global.fetch
    })

    it('rejects with an identifiable offline error without touching the network', async () => {
        global.fetch = jest.fn()
        setNavigatorOnLine(false)

        await expect(
            multiSearchTypesense([{ collection: 'dev_tasks', query: 'x', filterBy: '' }])
        ).rejects.toMatchObject({
            code: 'offline',
        })
        expect(global.fetch).not.toHaveBeenCalled()
        expect(Backend.getTypesenseScopedSearchCredentials).not.toHaveBeenCalled()
    })

    it('searches normally while online', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ results: [{ hits: [] }] }),
            })
        )

        const results = await multiSearchTypesense([{ collection: 'dev_tasks', query: 'x', filterBy: '' }])
        expect(results).toEqual([{ hits: [] }])
        expect(global.fetch).toHaveBeenCalledTimes(1)
        expect(Backend.getTypesenseScopedSearchCredentials).toHaveBeenCalledTimes(1)
    })
})

describe('scoped credentials and bounded payloads', () => {
    const successResponse = () => ({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ results: [{ hits: [] }] }),
    })

    beforeEach(() => {
        __resetTypesenseCredentialCacheForTests()
        Backend.getCurrentUserId.mockReturnValue('user-1')
        Backend.getTypesenseScopedSearchCredentials.mockReset().mockResolvedValue(VALID_CREDENTIALS)
        global.fetch = jest.fn(() => Promise.resolve(successResponse()))
    })

    afterEach(() => {
        delete global.fetch
    })

    it('uses a server-issued key, caps each collection at 20 results, and excludes large fields', async () => {
        await multiSearchTypesense([{ collection: 'dev_notes', query: 'x', filterBy: 'projectId:=p' }])

        expect(global.fetch).toHaveBeenCalledWith(
            'https://search.example.com/multi_search',
            expect.objectContaining({
                headers: expect.objectContaining({ 'X-TYPESENSE-API-KEY': 'test-scoped-key' }),
            })
        )
        const [{ per_page, exclude_fields }] = JSON.parse(global.fetch.mock.calls[0][1].body).searches
        expect(per_page).toBe(20)
        expect(exclude_fields).toBe('content,cleanComments')
    })

    it('includes the Typesense error detail instead of reporting a rejected request as empty', async () => {
        global.fetch.mockResolvedValue({
            ok: false,
            status: 400,
            text: () => Promise.resolve(JSON.stringify({ message: 'Multi search request exceeds limit' })),
        })

        await expect(
            multiSearchTypesense([{ collection: 'dev_tasks', query: 'x', filterBy: 'projectId:=p' }])
        ).rejects.toMatchObject({
            code: 'search_unavailable',
            status: 400,
            message: 'Typesense multi_search failed with status 400: Multi search request exceeds limit',
        })
    })

    it('reuses one credential during its lifetime', async () => {
        await multiSearchTypesense([{ collection: 'dev_tasks', query: 'one', filterBy: 'projectId:=p' }])
        await multiSearchTypesense([{ collection: 'dev_tasks', query: 'two', filterBy: 'projectId:=p' }])

        expect(Backend.getTypesenseScopedSearchCredentials).toHaveBeenCalledTimes(1)
        expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    it('warms the credential cache without contacting Typesense', async () => {
        await expect(warmTypesenseSearchCredentials()).resolves.toBe(true)
        await multiSearchTypesense([{ collection: 'dev_tasks', query: 'one', filterBy: 'projectId:=p' }])

        expect(Backend.getTypesenseScopedSearchCredentials).toHaveBeenCalledTimes(1)
        expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('shares an in-flight warm-up with the first search', async () => {
        let resolveCredentials
        Backend.getTypesenseScopedSearchCredentials.mockReturnValue(
            new Promise(resolve => {
                resolveCredentials = resolve
            })
        )

        const warmUp = warmTypesenseSearchCredentials()
        const firstSearch = multiSearchTypesense([{ collection: 'dev_tasks', query: 'one', filterBy: 'projectId:=p' }])

        expect(Backend.getTypesenseScopedSearchCredentials).toHaveBeenCalledTimes(1)
        resolveCredentials(VALID_CREDENTIALS)

        await expect(warmUp).resolves.toBe(true)
        await expect(firstSearch).resolves.toEqual([{ hits: [] }])
        expect(Backend.getTypesenseScopedSearchCredentials).toHaveBeenCalledTimes(1)
        expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('keeps warm-up failures best-effort and retries on the real search', async () => {
        Backend.getTypesenseScopedSearchCredentials
            .mockRejectedValueOnce(new Error('callable unavailable'))
            .mockResolvedValueOnce(VALID_CREDENTIALS)

        await expect(warmTypesenseSearchCredentials()).resolves.toBe(false)
        await expect(
            multiSearchTypesense([{ collection: 'dev_tasks', query: 'one', filterBy: 'projectId:=p' }])
        ).resolves.toEqual([{ hits: [] }])

        expect(Backend.getTypesenseScopedSearchCredentials).toHaveBeenCalledTimes(2)
    })

    it('refreshes once after Typesense rejects an expired cached key', async () => {
        Backend.getTypesenseScopedSearchCredentials
            .mockResolvedValueOnce(VALID_CREDENTIALS)
            .mockResolvedValueOnce({ ...VALID_CREDENTIALS, apiKey: 'refreshed-key' })
        global.fetch.mockResolvedValueOnce({ ok: false, status: 401 }).mockResolvedValueOnce(successResponse())

        await multiSearchTypesense([{ collection: 'dev_tasks', query: 'x', filterBy: 'projectId:=p' }])

        expect(Backend.getTypesenseScopedSearchCredentials).toHaveBeenCalledTimes(2)
        expect(global.fetch).toHaveBeenCalledTimes(2)
        expect(global.fetch.mock.calls[1][1].headers['X-TYPESENSE-API-KEY']).toBe('refreshed-key')
    })

    it('fails closed when the callable returns an expired or malformed credential', async () => {
        Backend.getTypesenseScopedSearchCredentials.mockResolvedValue({
            origin: 'https://search.example.com',
            apiKey: 'expired-key',
            expiresAt: 1,
        })

        await expect(
            multiSearchTypesense([{ collection: 'dev_tasks', query: 'x', filterBy: 'projectId:=p' }])
        ).rejects.toThrow('invalid, expired, or belong to another user')
        expect(global.fetch).not.toHaveBeenCalled()
    })

    it('does not reuse a credential after the signed-in user changes', async () => {
        await multiSearchTypesense([{ collection: 'dev_tasks', query: 'one', filterBy: 'projectId:=p' }])

        Backend.getCurrentUserId.mockReturnValue('user-2')
        Backend.getTypesenseScopedSearchCredentials.mockResolvedValue({
            ...VALID_CREDENTIALS,
            userId: 'user-2',
            apiKey: 'user-2-key',
        })
        await multiSearchTypesense([{ collection: 'dev_tasks', query: 'two', filterBy: 'projectId:=p' }])

        expect(Backend.getTypesenseScopedSearchCredentials).toHaveBeenCalledTimes(2)
        expect(global.fetch.mock.calls[1][1].headers['X-TYPESENSE-API-KEY']).toBe('user-2-key')
    })
})

describe('per-search query_by override (AT-2393)', () => {
    const readSentSearches = () => JSON.parse(global.fetch.mock.calls[0][1].body).searches

    beforeEach(() => {
        __resetTypesenseCredentialCacheForTests()
        Backend.getCurrentUserId.mockReturnValue('user-1')
        Backend.getTypesenseScopedSearchCredentials.mockReset().mockResolvedValue(VALID_CREDENTIALS)
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ results: [{ hits: [] }] }),
            })
        )
    })

    afterEach(() => {
        delete global.fetch
    })

    it('sends the collection default when no override is given', async () => {
        await searchTypesenseCollection('dev_contacts', 'an', 'projectId:=p')

        expect(readSentSearches()[0].query_by).toBe(TYPESENSE_QUERY_CONFIG.dev_contacts.query_by)
    })

    it('narrows query_by to the caller-supplied fields', async () => {
        await searchTypesenseCollection('dev_contacts', 'an', 'projectId:=p', {
            queryBy: 'displayName,role,company',
        })

        const [search] = readSentSearches()
        expect(search.query_by).toBe('displayName,role,company')
        // Everything else still comes from the collection config.
        expect(search.num_typos).toBe(TYPESENSE_QUERY_CONFIG.dev_contacts.num_typos)
        expect(search.sort_by).toBe(TYPESENSE_QUERY_CONFIG.dev_contacts.sort_by)
        expect(search.filter_by).toBe('projectId:=p')
    })

    it('overrides one collection of a multi-search without touching the others', async () => {
        await multiSearchTypesense([
            { collection: 'dev_contacts', query: 'an', filterBy: '', queryBy: 'displayName' },
            { collection: 'dev_notes', query: 'an', filterBy: '' },
        ])

        const searches = readSentSearches()
        expect(searches[0].query_by).toBe('displayName')
        expect(searches[1].query_by).toBe(TYPESENSE_QUERY_CONFIG.dev_notes.query_by)
    })
})

/**
 * AT-2497 — a picker that has just opened has nothing typed yet. Typesense has no "empty
 * query": `q: ''` tokenizes to nothing and matches nothing, so every tab of the @-mention
 * modal read "There are not results to show in this tab" until the user typed. `*` is the
 * documented wildcard, and the per-collection `sort_by` is what turns it into "the ones you
 * touched last".
 */
describe('match-all on a blank query (AT-2497)', () => {
    const readSentSearches = () => JSON.parse(global.fetch.mock.calls[0][1].body).searches

    beforeEach(() => {
        __resetTypesenseCredentialCacheForTests()
        Backend.getCurrentUserId.mockReturnValue('user-1')
        Backend.getTypesenseScopedSearchCredentials.mockReset().mockResolvedValue(VALID_CREDENTIALS)
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ results: [{ hits: [] }] }),
            })
        )
    })

    afterEach(() => {
        delete global.fetch
    })

    it('asks for the wildcard instead of an empty query', async () => {
        await searchTypesenseCollection('dev_notes', '', 'projectId:=p', { matchAllWhenEmpty: true })

        expect(readSentSearches()[0].q).toBe(TYPESENSE_MATCH_ALL_QUERY)
    })

    it('orders a wildcard page by recency, not by a text score every document ties on', async () => {
        await searchTypesenseCollection('dev_notes', '   ', 'projectId:=p', { matchAllWhenEmpty: true })

        // Leaving `_text_match:desc` in front would make the ordering of the list depend on a
        // criterion that is identical for every hit, which is how "most recent notes" silently
        // becomes "whatever order the engine returned".
        const [{ sort_by }] = readSentSearches()
        expect(sort_by).toBe('lastEditionDate(missing_values: last):desc')
        expect(sort_by).not.toContain('_text_match')
    })

    it('leaves a real query completely untouched', async () => {
        await searchTypesenseCollection('dev_notes', 'roadmap', 'projectId:=p', { matchAllWhenEmpty: true })

        const [search] = readSentSearches()
        expect(search.q).toBe('roadmap')
        expect(search.sort_by).toBe(TYPESENSE_QUERY_CONFIG.dev_notes.sort_by)
    })

    it('is opt-in: a caller that does not ask for it still sends the empty query', async () => {
        // Global search deliberately stays quiet on blank input, and a filter builder that
        // produced an empty `filterBy` must not turn into "show the user everything".
        await searchTypesenseCollection('dev_notes', '', 'projectId:=p')

        const [search] = readSentSearches()
        expect(search.q).toBe('')
        expect(search.sort_by).toBe(TYPESENSE_QUERY_CONFIG.dev_notes.sort_by)
    })

    it('applies per search entry, not per request', async () => {
        await multiSearchTypesense([
            { collection: 'dev_notes', query: '', filterBy: '', matchAllWhenEmpty: true },
            { collection: 'dev_tasks', query: '', filterBy: '' },
        ])

        const searches = readSentSearches()
        expect(searches[0].q).toBe(TYPESENSE_MATCH_ALL_QUERY)
        expect(searches[1].q).toBe('')
    })

    it('falls back to the configured sort when it carries nothing but a text score', () => {
        expect(buildSortBy('_text_match:desc', true)).toBe('_text_match:desc')
        expect(buildSortBy(undefined, true)).toBeUndefined()
    })

    it('treats only a genuinely blank string as blank', () => {
        expect(isBlankQuery('')).toBe(true)
        expect(isBlankQuery('  ')).toBe(true)
        expect(isBlankQuery(undefined)).toBe(true)
        expect(isBlankQuery('a')).toBe(false)
        expect(isBlankQuery('*')).toBe(false)
    })
})

/**
 * AT-2527 — "sometimes I have to enter more letters until it starts finding results."
 *
 * The report reads as a minimum query length and is not one: nothing in this app has ever
 * imposed one. It is the AT-2393 crowding problem, which was fixed for the @-mention picker
 * and deliberately left in place for global search. A short prefix matched against a long
 * free-text body (`content`, `cleanDescription`, `cleanComments`) matches nearly every
 * document; `_text_match` ties across all of them because there is only one short token to
 * score; and the recency tiebreaker then fills the 20-result page with whatever was edited
 * last. The note actually TITLED "Annual review" loses its place to twenty notes that merely
 * contain some "an*" word in their body.
 *
 * So these tests pin a RANKING contract, not a threshold — above all that nothing is ever
 * filtered out, because that is the way this fix could do damage.
 */
describe('identity matches lead the page (AT-2527)', () => {
    const readSentSearches = () => JSON.parse(global.fetch.mock.calls[0][1].body).searches

    // Typesense returns the composite `objectId + projectId` as the document id; the adapter
    // splits it back apart. Build hits the same way so objectID-based dedup is exercised for
    // real rather than against a shape only the test knows.
    const hit = (id, projectId = 'p1') => ({ document: { id: `${id}${projectId}`, projectId } })
    const namesOf = hits => hits.map(h => h.id)

    const respondWith = (...pages) => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ results: pages }),
            })
        )
    }

    beforeEach(() => {
        __resetTypesenseCredentialCacheForTests()
        Backend.getCurrentUserId.mockReturnValue('user-1')
        Backend.getTypesenseScopedSearchCredentials.mockReset().mockResolvedValue(VALID_CREDENTIALS)
        respondWith({ hits: [] }, { hits: [] })
    })

    afterEach(() => {
        delete global.fetch
    })

    it('asks for the name fields and the full field list in ONE round trip', async () => {
        await searchTypesenseCollection('dev_notes', 'an', 'projectId:=p', { identityFirst: true })

        const searches = readSentSearches()
        expect(searches).toHaveLength(2)
        expect(searches[0].query_by).toBe('title')
        expect(searches[1].query_by).toBe('title,content')
        // Two engine searches, still one HTTP request — this is what makes the extra page
        // affordable on a submit-driven surface.
        expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('expands the five global tabs to the eight engine searches allowed by the scoped key', async () => {
        respondWith(...Array.from({ length: 8 }, () => ({ hits: [] })))

        await multiSearchTypesense(
            ['dev_tasks', 'dev_goals', 'dev_notes', 'dev_contacts', 'dev_updates'].map(collection => ({
                collection,
                query: 'an',
                filterBy: 'projectId:=p',
                identityFirst: true,
            }))
        )

        expect(readSentSearches()).toHaveLength(8)
        expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('carries the collection config unchanged onto both pages', async () => {
        await searchTypesenseCollection('dev_notes', 'an', 'projectId:=p', { identityFirst: true })

        for (const search of readSentSearches()) {
            expect(search.q).toBe('an')
            expect(search.filter_by).toBe('projectId:=p')
            expect(search.num_typos).toBe(TYPESENSE_QUERY_CONFIG.dev_notes.num_typos)
            expect(search.sort_by).toBe(TYPESENSE_QUERY_CONFIG.dev_notes.sort_by)
            expect(search.per_page).toBe(20)
        }
    })

    it('puts a title match ahead of a body-only match', async () => {
        respondWith({ hits: [hit('annual-review')] }, { hits: [hit('standup-notes'), hit('annual-review')] })

        const { hits } = await searchTypesenseCollection('dev_notes', 'an', '', { identityFirst: true })

        expect(namesOf(hits)).toEqual(['annual-review', 'standup-notes'])
    })

    it('never drops a body-only match — it only reorders', async () => {
        // The failure mode to protect against: turning "ranked below" into "gone". Every hit
        // the pre-AT-2527 single search would have returned must still be on the page.
        const fullPage = { hits: [hit('body-1'), hit('body-2'), hit('body-3')] }
        respondWith({ hits: [] }, fullPage)

        const { hits } = await searchTypesenseCollection('dev_notes', 'an', '', { identityFirst: true })

        expect(namesOf(hits)).toEqual(['body-1', 'body-2', 'body-3'])
    })

    it('shows a document that is on both pages once, in its identity position', async () => {
        respondWith({ hits: [hit('roadmap')] }, { hits: [hit('older'), hit('roadmap'), hit('newer')] })

        const { hits } = await searchTypesenseCollection('dev_notes', 'ro', '', { identityFirst: true })

        expect(namesOf(hits)).toEqual(['roadmap', 'older', 'newer'])
    })

    it('keeps the same document in two projects apart', async () => {
        // A contact is indexed once per project and each row is separately selectable, so
        // deduping by the bare id would silently delete real rows.
        respondWith({ hits: [hit('anna', 'p1')] }, { hits: [hit('anna', 'p2')] })

        const { hits } = await searchTypesenseCollection('dev_contacts', 'an', '', { identityFirst: true })

        expect(hits.map(h => h.projectId)).toEqual(['p1', 'p2'])
    })

    it('caps the merged page at per_page', async () => {
        const many = n => ({ hits: Array.from({ length: n }, (_, i) => hit(`x${i}`)) })
        respondWith(many(15), many(20))

        const { hits } = await searchTypesenseCollection('dev_notes', 'an', '', { identityFirst: true })

        expect(hits).toHaveLength(20)
    })

    it('does not split a collection whose fields are all identity fields', async () => {
        respondWith({ hits: [] }, { hits: [] })

        await multiSearchTypesense([
            { collection: 'dev_tasks', query: 'an', filterBy: '', identityFirst: true },
            { collection: 'dev_goals', query: 'an', filterBy: '', identityFirst: true },
        ])

        const searches = readSentSearches()
        expect(searches).toHaveLength(2)
        expect(searches[0].query_by).toBe(TYPESENSE_QUERY_CONFIG.dev_tasks.query_by)
        expect(searches[1].query_by).toBe(TYPESENSE_QUERY_CONFIG.dev_goals.query_by)
    })

    it('leaves a caller that already narrowed query_by alone', async () => {
        // The @-mention contact picker made this same decision by hand (AT-2393); splitting
        // its call would ask the engine the identical question twice.
        await searchTypesenseCollection('dev_contacts', 'an', '', {
            identityFirst: true,
            queryBy: 'displayName,role,company',
        })

        const searches = readSentSearches()
        expect(searches).toHaveLength(1)
        expect(searches[0].query_by).toBe('displayName,role,company')
    })

    it('does not split a wildcard page, which has no text to rank', async () => {
        await searchTypesenseCollection('dev_notes', '', '', { identityFirst: true, matchAllWhenEmpty: true })

        const searches = readSentSearches()
        expect(searches).toHaveLength(1)
        expect(searches[0].q).toBe(TYPESENSE_MATCH_ALL_QUERY)
    })

    it('is opt-in: a caller that does not ask for it is byte-identical to before', async () => {
        await searchTypesenseCollection('dev_notes', 'an', 'projectId:=p')

        const searches = readSentSearches()
        expect(searches).toHaveLength(1)
        expect(searches[0].query_by).toBe(TYPESENSE_QUERY_CONFIG.dev_notes.query_by)
    })

    it('returns one result per requested search, in the caller order, across mixed expansion', async () => {
        // dev_tasks does not expand, dev_notes does. Getting this mapping wrong would hand a
        // tab another tab's results, which no assertion about hit ORDER would catch.
        respondWith({ hits: [hit('task-1')] }, { hits: [hit('note-name')] }, { hits: [hit('note-body')] })

        const results = await multiSearchTypesense([
            { collection: 'dev_tasks', query: 'an', filterBy: '', identityFirst: true },
            { collection: 'dev_notes', query: 'an', filterBy: '', identityFirst: true },
        ])

        expect(results).toHaveLength(2)
        expect(namesOf(results[0].hits)).toEqual(['task-1'])
        expect(namesOf(results[1].hits)).toEqual(['note-name', 'note-body'])
    })

    it('keeps the full page when the identity page errors', async () => {
        // Degrading to exactly the pre-AT-2527 behaviour is the correct answer here; losing
        // the tab is not.
        respondWith({ error: 'Could not find a field named `title`' }, { hits: [hit('body-1')] })

        const { hits, error } = await searchTypesenseCollection('dev_notes', 'an', '', { identityFirst: true })

        expect(namesOf(hits)).toEqual(['body-1'])
        expect(error).toBeUndefined()
    })

    it('keeps the name matches when the full page errors', async () => {
        respondWith({ hits: [hit('annual-review')] }, { error: 'Field `content` is not searchable' })

        const { hits } = await searchTypesenseCollection('dev_notes', 'an', '', { identityFirst: true })

        expect(namesOf(hits)).toEqual(['annual-review'])
    })

    it('reports an error only when both pages failed', async () => {
        respondWith({ error: 'boom' }, { error: 'boom' })

        const result = await searchTypesenseCollection('dev_notes', 'an', '', { identityFirst: true })

        expect(result.hits).toEqual([])
        expect(result.error).toBe('boom')
    })

    describe('mergeIdentityFirstHits', () => {
        const h = id => ({ objectID: id })

        it('preserves engine order inside each block', () => {
            const merged = mergeIdentityFirstHits([h('a'), h('b')], [h('c'), h('d')])
            expect(merged.map(x => x.objectID)).toEqual(['a', 'b', 'c', 'd'])
        })

        it('never pads a short page', () => {
            expect(mergeIdentityFirstHits([h('a')], [])).toHaveLength(1)
            expect(mergeIdentityFirstHits([], [])).toEqual([])
        })

        it('tolerates a missing or malformed page', () => {
            expect(mergeIdentityFirstHits(undefined, [h('a')]).map(x => x.objectID)).toEqual(['a'])
            expect(mergeIdentityFirstHits(null, null)).toEqual([])
            // A hit with no usable key is dropped rather than duplicated on every merge.
            expect(mergeIdentityFirstHits([{}], [h('a')]).map(x => x.objectID)).toEqual(['a'])
        })

        it('honours an explicit limit', () => {
            expect(mergeIdentityFirstHits([h('a'), h('b')], [h('c')], 2).map(x => x.objectID)).toEqual(['a', 'b'])
        })
    })

    it('declares an identity subset for every collection', () => {
        // A new collection that forgets `identity_query_by` silently opts out of the fix, and
        // one that names a field outside `query_by` would 404 the identity page on every
        // search — visible only as "search got worse again".
        for (const [collection, config] of Object.entries(TYPESENSE_QUERY_CONFIG)) {
            expect(typeof config.identity_query_by).toBe('string')
            expect(config.identity_query_by.length).toBeGreaterThan(0)

            const full = config.query_by.split(',')
            for (const field of config.identity_query_by.split(',')) {
                expect({ collection, field, full }).toEqual({
                    collection,
                    field,
                    full: expect.arrayContaining([field]),
                })
            }
        }
    })
})
