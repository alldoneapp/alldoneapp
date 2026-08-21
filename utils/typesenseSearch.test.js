import { multiSearchTypesense, searchTypesenseCollection, TYPESENSE_QUERY_CONFIG } from './typesenseSearch'

jest.mock('./BackendBridge', () => ({
    getTypesenseSearchKeys: () => ({
        TYPESENSE_HOST: 'search.example.com',
        TYPESENSE_SEARCH_ONLY_API_KEY: 'test-key',
    }),
}))

const setNavigatorOnLine = value => {
    Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
}

describe('multiSearchTypesense offline fast-fail (OFFLINE_SUPPORT_PLAN.md Stage 7)', () => {
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
    })
})

describe('per-search query_by override (AT-2393)', () => {
    const readSentSearches = () => JSON.parse(global.fetch.mock.calls[0][1].body).searches

    beforeEach(() => {
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
