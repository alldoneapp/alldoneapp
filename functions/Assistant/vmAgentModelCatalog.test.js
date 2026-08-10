const mockDoc = jest.fn()
jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({ doc: mockDoc })),
}))
jest.mock('../envFunctionsHelper', () => ({ getEnvFunctions: jest.fn() }))

const { getEnvFunctions } = require('../envFunctionsHelper')
const {
    parseModelId,
    buildFamilies,
    fetchProviderModelIds,
    getModelCatalog,
    resolveFamilyToModel,
    isValidFamilyId,
    CATALOG_TTL_MS,
} = require('./vmAgentModelCatalog')

// Firestore stub: the catalog cache doc.
function stubCatalogDoc({ exists = false, data = {} } = {}) {
    const get = jest.fn().mockResolvedValue({ exists, data: () => data })
    const set = jest.fn().mockResolvedValue(undefined)
    mockDoc.mockReturnValue({ get, set })
    return { get, set }
}

function jsonResponse(body, ok = true, status = 200) {
    return { ok, status, json: async () => body }
}

const ANTHROPIC_LIST = {
    data: [
        { id: 'claude-opus-4-8' },
        { id: 'claude-opus-5' },
        { id: 'claude-sonnet-4-6' },
        { id: 'claude-sonnet-5' },
        { id: 'claude-haiku-4-5' },
        { id: 'claude-fable-5' },
    ],
}

const OPENAI_LIST = {
    data: [
        { id: 'gpt-5.6-sol' },
        { id: 'gpt-5.6-terra' },
        { id: 'gpt-5.6-luna' },
        { id: 'gpt-5.4-mini' },
        { id: 'gpt-5.4-nano' },
        { id: 'gpt-5.5' },
        { id: 'gpt-4o' },
        { id: 'text-embedding-3-large' },
        { id: 'whisper-1' },
        { id: 'dall-e-3' },
    ],
}

beforeEach(() => {
    jest.clearAllMocks()
    getEnvFunctions.mockReturnValue({ ANTHROPIC_API_KEY: 'sk-ant-test', OPEN_AI_KEY: 'sk-openai-test' })
})

describe('parseModelId', () => {
    it('parses the current claude-<family>-<major>[-<minor>] scheme', () => {
        expect(parseModelId('claude', 'claude-opus-4-8')).toMatchObject({ family: 'opus', major: 4, minor: 8 })
        expect(parseModelId('claude', 'claude-opus-5')).toMatchObject({ family: 'opus', major: 5, minor: 0 })
        expect(parseModelId('claude', 'claude-sonnet-4-6')).toMatchObject({ family: 'sonnet', major: 4, minor: 6 })
        expect(parseModelId('claude', 'claude-fable-5')).toMatchObject({ family: 'fable', major: 5, minor: 0 })
    })

    it('parses dated snapshot ids without treating the date as a minor version', () => {
        expect(parseModelId('claude', 'claude-opus-4-1-20250805')).toMatchObject({
            family: 'opus',
            major: 4,
            minor: 1,
        })
    })

    it('parses the legacy claude-<version>-<family> scheme so old ids still group correctly', () => {
        expect(parseModelId('claude', 'claude-3-opus-20240229')).toMatchObject({ family: 'opus', major: 3, minor: 0 })
        expect(parseModelId('claude', 'claude-3-5-sonnet-20241022')).toMatchObject({
            family: 'sonnet',
            major: 3,
            minor: 5,
        })
    })

    it('parses the OpenAI gpt-<gen>-<tier> scheme', () => {
        expect(parseModelId('codex', 'gpt-5.6-sol')).toMatchObject({ family: 'sol', major: 5, minor: 6 })
        expect(parseModelId('codex', 'gpt-5.4-mini')).toMatchObject({ family: 'mini', major: 5, minor: 4 })
    })

    it('rejects ids that are not family-shaped chat models', () => {
        expect(parseModelId('codex', 'text-embedding-3-large')).toBeNull()
        expect(parseModelId('codex', 'whisper-1')).toBeNull()
        expect(parseModelId('codex', 'gpt-4o')).toBeNull()
        expect(parseModelId('codex', 'gpt-5.5')).toBeNull()
        expect(parseModelId('claude', 'claude-2.1')).toBeNull()
        expect(parseModelId('claude', '')).toBeNull()
        expect(parseModelId('claude', undefined)).toBeNull()
    })
})

describe('buildFamilies', () => {
    it('groups Claude ids into families pointing at the newest member', () => {
        const families = buildFamilies(
            'claude',
            ANTHROPIC_LIST.data.map(m => m.id)
        )
        expect(families.map(f => f.id)).toEqual(['opus', 'sonnet', 'haiku', 'fable'])
        expect(families.find(f => f.id === 'opus').latestModel).toBe('claude-opus-5')
        expect(families.find(f => f.id === 'sonnet').latestModel).toBe('claude-sonnet-5')
    })

    it('uses the Claude Code moving alias for families that have one, and a concrete id otherwise', () => {
        const families = buildFamilies(
            'claude',
            ANTHROPIC_LIST.data.map(m => m.id)
        )
        // opus/sonnet/haiku are CLI aliases: let the CLI resolve the newest release itself.
        expect(families.find(f => f.id === 'opus')).toMatchObject({ resolvedModel: 'opus', isAlias: true })
        expect(families.find(f => f.id === 'sonnet')).toMatchObject({ resolvedModel: 'sonnet', isAlias: true })
        // Fable has no alias, so it must be pinned to the discovered id.
        expect(families.find(f => f.id === 'fable')).toMatchObject({
            resolvedModel: 'claude-fable-5',
            isAlias: false,
        })
    })

    it('keeps an older Claude family that is still offered (Haiku 4.5 alongside Opus 5)', () => {
        const families = buildFamilies(
            'claude',
            ANTHROPIC_LIST.data.map(m => m.id)
        )
        expect(families.find(f => f.id === 'haiku')).toMatchObject({ latestModel: 'claude-haiku-4-5' })
    })

    it('keeps only current-generation Codex tiers, dropping retired ones', () => {
        const families = buildFamilies(
            'codex',
            OPENAI_LIST.data.map(m => m.id)
        )
        expect(families.map(f => f.id)).toEqual(['sol', 'terra', 'luna'])
        // mini/nano only exist at the older 5.4 generation — they are retired tiers, not just older.
        expect(families.map(f => f.id)).not.toContain('mini')
        expect(families.map(f => f.id)).not.toContain('nano')
    })

    it('resolves a Codex family to a concrete id (OpenAI has no moving aliases)', () => {
        const families = buildFamilies(
            'codex',
            OPENAI_LIST.data.map(m => m.id)
        )
        expect(families.find(f => f.id === 'sol')).toMatchObject({
            resolvedModel: 'gpt-5.6-sol',
            isAlias: false,
        })
    })

    it('picks up a brand-new tier automatically and appends unknown families after known ones', () => {
        const families = buildFamilies('codex', ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-nova'])
        expect(families.map(f => f.id)).toEqual(['sol', 'terra', 'nova'])
        expect(families.find(f => f.id === 'nova').label).toBe('Nova')
    })

    it('follows a new generation forward without a code change', () => {
        const families = buildFamilies('codex', ['gpt-5.6-sol', 'gpt-5.7-sol', 'gpt-5.7-terra'])
        expect(families.find(f => f.id === 'sol').resolvedModel).toBe('gpt-5.7-sol')
    })

    it('returns an empty list when nothing parses', () => {
        expect(buildFamilies('codex', ['whisper-1', 'dall-e-3'])).toEqual([])
        expect(buildFamilies('claude', [])).toEqual([])
    })
})

describe('fetchProviderModelIds', () => {
    it('calls the Anthropic models endpoint with the versioned key header', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(ANTHROPIC_LIST))
        const ids = await fetchProviderModelIds('claude', { fetchImpl })
        expect(ids).toContain('claude-opus-5')
        const [url, options] = fetchImpl.mock.calls[0]
        expect(url).toContain('api.anthropic.com/v1/models')
        expect(options.headers['x-api-key']).toBe('sk-ant-test')
        expect(options.headers['anthropic-version']).toBe('2023-06-01')
    })

    it('calls the OpenAI models endpoint with a bearer token', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(OPENAI_LIST))
        const ids = await fetchProviderModelIds('codex', { fetchImpl })
        expect(ids).toContain('gpt-5.6-sol')
        const [url, options] = fetchImpl.mock.calls[0]
        expect(url).toContain('api.openai.com/v1/models')
        expect(options.headers.Authorization).toBe('Bearer sk-openai-test')
    })

    it('throws when the platform key is missing', async () => {
        getEnvFunctions.mockReturnValue({})
        await expect(fetchProviderModelIds('claude', { fetchImpl: jest.fn() })).rejects.toThrow(/ANTHROPIC_API_KEY/)
    })

    it('throws on a non-ok provider response', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({}, false, 401))
        await expect(fetchProviderModelIds('claude', { fetchImpl })).rejects.toThrow(/status 401/)
    })
})

describe('getModelCatalog', () => {
    it('serves a fresh cache without hitting the provider', async () => {
        const now = 1_000_000
        const cached = [{ id: 'opus', label: 'Opus', resolvedModel: 'opus', isAlias: true }]
        stubCatalogDoc({ exists: true, data: { families: cached, fetchedAt: now - 1000 } })
        const fetchImpl = jest.fn()

        const catalog = await getModelCatalog('claude', { fetchImpl, now })

        expect(catalog.source).toBe('cache')
        expect(catalog.families).toEqual(cached)
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('re-discovers and writes the cache once the TTL has expired', async () => {
        const now = 10 * CATALOG_TTL_MS
        const { set } = stubCatalogDoc({
            exists: true,
            data: { families: [{ id: 'opus' }], fetchedAt: now - CATALOG_TTL_MS - 1 },
        })
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(ANTHROPIC_LIST))

        const catalog = await getModelCatalog('claude', { fetchImpl, now })

        expect(catalog.source).toBe('live')
        expect(catalog.families.map(f => f.id)).toEqual(['opus', 'sonnet', 'haiku', 'fable'])
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ fetchedAt: now, provider: 'claude' }), {
            merge: true,
        })
    })

    it('serves a STALE cache when discovery fails — real-but-old beats hardcoded', async () => {
        const now = 10 * CATALOG_TTL_MS
        const stale = [{ id: 'terra', label: 'Terra', resolvedModel: 'gpt-5.6-terra', isAlias: false }]
        stubCatalogDoc({ exists: true, data: { families: stale, fetchedAt: 1 } })
        const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'))

        const catalog = await getModelCatalog('codex', { fetchImpl, now })

        expect(catalog.source).toBe('stale')
        expect(catalog.families).toEqual(stale)
    })

    it('falls back to the static catalog when discovery fails and nothing is cached', async () => {
        stubCatalogDoc({ exists: false })
        const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'))

        const catalog = await getModelCatalog('codex', { fetchImpl, now: 5 })

        expect(catalog.source).toBe('fallback')
        expect(catalog.families.map(f => f.id)).toEqual(['sol', 'terra', 'luna'])
    })

    it('falls back rather than caching an empty family list', async () => {
        const { set } = stubCatalogDoc({ exists: false })
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'whisper-1' }] }))

        const catalog = await getModelCatalog('codex', { fetchImpl, now: 5 })

        expect(catalog.source).toBe('fallback')
        expect(set).not.toHaveBeenCalled()
    })

    it('survives a Firestore read failure', async () => {
        mockDoc.mockReturnValue({
            get: jest.fn().mockRejectedValue(new Error('firestore down')),
            set: jest.fn().mockResolvedValue(undefined),
        })
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(ANTHROPIC_LIST))

        const catalog = await getModelCatalog('claude', { fetchImpl, now: 5 })

        expect(catalog.source).toBe('live')
    })
})

describe('resolveFamilyToModel', () => {
    it('resolves a family to the newest concrete id at run time', async () => {
        stubCatalogDoc({ exists: false })
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(OPENAI_LIST))

        await expect(resolveFamilyToModel('codex', 'terra', { fetchImpl, now: 5 })).resolves.toBe('gpt-5.6-terra')
    })

    it('resolves an alias family to the alias so the CLI picks the newest release', async () => {
        stubCatalogDoc({ exists: false })
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(ANTHROPIC_LIST))

        await expect(resolveFamilyToModel('claude', 'sonnet', { fetchImpl, now: 5 })).resolves.toBe('sonnet')
    })

    it('still honours an alias family when discovery is degraded', async () => {
        stubCatalogDoc({ exists: false })
        const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'))

        // 'fable' is not in the static fallback, but 'sonnet' is safe to hand to the CLI regardless.
        await expect(resolveFamilyToModel('claude', 'sonnet', { fetchImpl, now: 5 })).resolves.toBe('sonnet')
    })

    it('returns null for an unknown family so callers keep their default', async () => {
        stubCatalogDoc({ exists: false })
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(OPENAI_LIST))

        await expect(resolveFamilyToModel('codex', 'nonexistent', { fetchImpl, now: 5 })).resolves.toBeNull()
    })

    it('rejects malformed family ids without touching the catalog', async () => {
        const fetchImpl = jest.fn()
        await expect(resolveFamilyToModel('claude', '../../etc/passwd', { fetchImpl })).resolves.toBeNull()
        await expect(resolveFamilyToModel('claude', null, { fetchImpl })).resolves.toBeNull()
        expect(fetchImpl).not.toHaveBeenCalled()
    })
})

describe('isValidFamilyId', () => {
    it('accepts plain lowercase family ids and rejects anything else', () => {
        expect(isValidFamilyId('opus')).toBe(true)
        expect(isValidFamilyId('sol')).toBe(true)
        expect(isValidFamilyId('Opus')).toBe(false)
        expect(isValidFamilyId('gpt-5.6-sol')).toBe(false)
        expect(isValidFamilyId('')).toBe(false)
        expect(isValidFamilyId(null)).toBe(false)
        expect(isValidFamilyId('a'.repeat(40))).toBe(false)
    })
})
