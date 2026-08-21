import { multiSearchTypesense } from './typesenseSearch'

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
