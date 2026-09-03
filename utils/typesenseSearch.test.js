import Backend from './BackendBridge'
import {
    __resetTypesenseCredentialCacheForTests,
    multiSearchTypesense,
    searchTypesenseCollection,
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
