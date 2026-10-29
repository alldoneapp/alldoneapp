const {
    PARENT_KEY_ACTIONS,
    PROVISIONING_RETRY_COOLDOWN_MS,
    __resetScopedSearchParentKeyCacheForTests,
    buildScopedSearchParentKeySpec,
    deriveScopedSearchParentKeyValue,
    ensureScopedSearchParentKey,
    resolveScopedSearchParentKey,
} = require('./scopedSearchParentKey')
// typesenseHelper only needs the typesense SDK to build a client, which these tests never do.
jest.mock('typesense', () => ({ Client: jest.fn() }), { virtual: true })
const { ALL_COLLECTIONS } = require('../typesenseHelper')

const makeClient = create => ({ keys: () => ({ create }) })
const alreadyExists = () => Object.assign(new Error('API key generation conflict.'), { httpStatus: 409 })

let consoleError
let consoleLog
beforeEach(() => {
    __resetScopedSearchParentKeyCacheForTests()
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
    consoleError.mockRestore()
    consoleLog.mockRestore()
})

describe('the provisioned parent covers every collection global search queries (AT-2905)', () => {
    test('artifacts and wiki are searchable collections, not just the original five', () => {
        // The production key was made for the first five; these two were the ones that broke.
        expect(ALL_COLLECTIONS).toEqual(expect.arrayContaining(['dev_artifacts', 'dev_wiki']))
        const spec = buildScopedSearchParentKeySpec('admin', ALL_COLLECTIONS)
        expect(spec.collections).toEqual([...ALL_COLLECTIONS].sort())
    })

    test('may only search, because Typesense rejects scoped keys of a broader parent', () => {
        const spec = buildScopedSearchParentKeySpec('admin', ALL_COLLECTIONS)
        expect(spec.actions).toEqual(['documents:search'])
        expect(PARENT_KEY_ACTIONS).toEqual(['documents:search'])
    })

    test('the value is deterministic per admin key and collection list', () => {
        const a = deriveScopedSearchParentKeyValue('admin', ['dev_b', 'dev_a'])
        expect(deriveScopedSearchParentKeyValue('admin', ['dev_a', 'dev_b', 'dev_a'])).toBe(a)
        // A new collection is a new key, so it can never be missing from an existing one.
        expect(deriveScopedSearchParentKeyValue('admin', ['dev_a', 'dev_b', 'dev_c'])).not.toBe(a)
        expect(deriveScopedSearchParentKeyValue('other-admin', ['dev_a', 'dev_b'])).not.toBe(a)
        // Never the admin key itself.
        expect(a).not.toContain('admin')
        expect(() => deriveScopedSearchParentKeyValue('', ['dev_a'])).toThrow()
    })
})

describe('ensureScopedSearchParentKey', () => {
    test('creates the key once per instance', async () => {
        const create = jest.fn().mockResolvedValue({})
        const client = makeClient(create)
        const first = await ensureScopedSearchParentKey({ client, adminApiKey: 'admin', collections: ALL_COLLECTIONS })
        const second = await ensureScopedSearchParentKey({ client, adminApiKey: 'admin', collections: ALL_COLLECTIONS })

        expect(first).toBe(second)
        expect(create).toHaveBeenCalledTimes(1)
        expect(create).toHaveBeenCalledWith(buildScopedSearchParentKeySpec('admin', ALL_COLLECTIONS))
    })

    test('a key that already exists (another instance created it) is success', async () => {
        const create = jest.fn().mockRejectedValue(alreadyExists())
        await expect(
            ensureScopedSearchParentKey({ client: makeClient(create), adminApiKey: 'admin', collections: ['dev_a'] })
        ).resolves.toBe(deriveScopedSearchParentKeyValue('admin', ['dev_a']))
    })

    test('a failed creation is retried by the next request', async () => {
        const create = jest.fn().mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce({})
        const client = makeClient(create)
        await expect(
            ensureScopedSearchParentKey({ client, adminApiKey: 'admin', collections: ['dev_a'] })
        ).rejects.toThrow('network down')
        await expect(
            ensureScopedSearchParentKey({ client, adminApiKey: 'admin', collections: ['dev_a'] })
        ).resolves.toBe(deriveScopedSearchParentKeyValue('admin', ['dev_a']))
        expect(create).toHaveBeenCalledTimes(2)
    })
})

describe('resolveScopedSearchParentKey', () => {
    test('prefers the provisioned key over the configured one', async () => {
        const create = jest.fn().mockResolvedValue({})
        await expect(
            resolveScopedSearchParentKey({
                client: makeClient(create),
                adminApiKey: 'admin',
                collections: ALL_COLLECTIONS,
                configuredParentKey: 'configured-five-collection-key',
            })
        ).resolves.toBe(deriveScopedSearchParentKeyValue('admin', ALL_COLLECTIONS))
    })

    test('falls back to the configured key, loudly, when provisioning fails', async () => {
        const create = jest.fn().mockRejectedValue(new Error('forbidden'))
        await expect(
            resolveScopedSearchParentKey({
                client: makeClient(create),
                adminApiKey: 'admin',
                collections: ALL_COLLECTIONS,
                configuredParentKey: 'configured-five-collection-key',
            })
        ).resolves.toBe('configured-five-collection-key')
        expect(consoleError).toHaveBeenCalledWith(
            expect.stringContaining('may not cover every collection'),
            expect.objectContaining({ error: 'forbidden' })
        )
    })

    test('after a failure it uses the configured key at once for a while, then tries again', async () => {
        const create = jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({})
        const args = {
            client: makeClient(create),
            adminApiKey: 'admin',
            collections: ALL_COLLECTIONS,
            configuredParentKey: 'configured',
        }
        await expect(resolveScopedSearchParentKey({ ...args, now: 1000 })).resolves.toBe('configured')
        await expect(resolveScopedSearchParentKey({ ...args, now: 2000 })).resolves.toBe('configured')
        expect(create).toHaveBeenCalledTimes(1)

        await expect(
            resolveScopedSearchParentKey({ ...args, now: 1000 + PROVISIONING_RETRY_COOLDOWN_MS })
        ).resolves.toBe(deriveScopedSearchParentKeyValue('admin', ALL_COLLECTIONS))
        expect(create).toHaveBeenCalledTimes(2)
    })

    test('without Typesense admin access it uses the configured key, or nothing', async () => {
        await expect(resolveScopedSearchParentKey({ configuredParentKey: 'configured' })).resolves.toBe('configured')
        await expect(resolveScopedSearchParentKey({})).resolves.toBeNull()
    })
})
