const mockDoc = jest.fn()
jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({ doc: mockDoc })),
}))
jest.mock('../envFunctionsHelper', () => ({ getEnvFunctions: jest.fn() }))

const { getEnvFunctions } = require('../envFunctionsHelper')
const {
    parseModelId,
    buildFamilies,
    buildOpenRouterModels,
    fetchProviderModelIds,
    getModelCatalog,
    resolveFamilyToModel,
    isValidFamilyId,
    normalizeOpenRouterPricing,
    buildOpenRouterPricing,
    decorateCatalogGoldPricing,
    getOpenRouterUpstreamPrice,
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

function compatibleOpenRouterEntry(id, { created = 0, agenticIndex = null, name = id } = {}) {
    return {
        id,
        name,
        created,
        supported_parameters: ['tools'],
        architecture: { output_modalities: ['text'] },
        ...(agenticIndex == null ? {} : { benchmarks: { artificial_analysis: { agentic_index: agenticIndex } } }),
    }
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

describe('buildOpenRouterModels', () => {
    it('features each major vendor newest and best model without hiding the full searchable catalog', () => {
        const entries = [
            compatibleOpenRouterEntry('deepseek/deepseek-v4-pro', { created: 20, agenticIndex: 60 }),
            compatibleOpenRouterEntry('qwen/qwen-newest', { created: 50 }),
            compatibleOpenRouterEntry('qwen/qwen-best', { created: 30, agenticIndex: 90 }),
            compatibleOpenRouterEntry('qwen/qwen-old', { created: 10, agenticIndex: 20 }),
            // A newer billing variant remains searchable but does not displace the canonical pick.
            compatibleOpenRouterEntry('qwen/qwen-newest:free', { created: 60, agenticIndex: 95 }),
            compatibleOpenRouterEntry('x-ai/grok-4.6', {
                created: 55,
                agenticIndex: 85,
                name: 'SpaceXAI: Grok 4.6',
            }),
            compatibleOpenRouterEntry('someone/new-vendor-model', { created: 70, agenticIndex: 99 }),
            { id: 'someone/no-tools', supported_parameters: [], architecture: { output_modalities: ['text'] } },
        ]

        const catalog = buildOpenRouterModels(entries)
        const featuredIds = catalog.models.map(model => model.modelId)
        const searchableIds = catalog.searchModels.map(model => model.modelId)

        expect(featuredIds).toEqual(['deepseek/deepseek-v4-pro', 'qwen/qwen-newest', 'qwen/qwen-best', 'x-ai/grok-4.6'])
        expect(searchableIds).toEqual(expect.arrayContaining(['qwen/qwen-old', 'qwen/qwen-newest:free']))
        expect(searchableIds).toContain('someone/new-vendor-model')
        expect(searchableIds).not.toContain('someone/no-tools')
        expect(catalog.models.find(model => model.modelId === 'x-ai/grok-4.6').label).toBe('SpaceXAI: Grok 4.6')
        // Prices stay on the server-only list, not on every client-facing search entry.
        expect(catalog.searchModels.every(model => model.upstreamPrice === undefined)).toBe(true)
    })
})

describe('catalog Gold pricing', () => {
    it('uses the billing resolver for every Anthropic and OpenAI family', () => {
        const claude = decorateCatalogGoldPricing('claude', {
            families: [
                { id: 'opus', resolvedModel: 'opus' },
                { id: 'sonnet', resolvedModel: 'sonnet' },
                { id: 'haiku', resolvedModel: 'haiku' },
                { id: 'fable', resolvedModel: 'claude-fable-5' },
                { id: 'mythos', resolvedModel: 'claude-mythos-5' },
            ],
        })
        const codex = decorateCatalogGoldPricing('codex', {
            families: [
                { id: 'sol', resolvedModel: 'gpt-5.6-sol' },
                { id: 'terra', resolvedModel: 'gpt-5.6-terra' },
                { id: 'luna', resolvedModel: 'gpt-5.6-luna' },
            ],
        })

        expect(claude.families.map(model => model.tokensPerGold)).toEqual([100, 250, 500, 50, 50])
        expect(codex.families.map(model => model.tokensPerGold)).toEqual([100, 250, 2500])
    })

    it('uses live OpenRouter prices for both featured choices and the full search index', () => {
        const grok = {
            id: 'openrouter:x-ai/grok-4.6',
            modelId: 'x-ai/grok-4.6',
            resolvedModel: 'openrouter:x-ai/grok-4.6',
        }
        const catalog = decorateCatalogGoldPricing('openrouter', {
            families: [grok],
            searchModels: [grok],
            pricing: [{ id: 'x-ai/grok-4.6', input: 2, cachedInput: 0.5, output: 6 }],
        })

        expect(catalog.families[0].tokensPerGold).toBe(170)
        expect(catalog.searchModels[0].tokensPerGold).toBe(170)
        // The decorator derives a safe display value without consuming the raw server-side source.
        expect(catalog.pricing).toHaveLength(1)
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
        expect(catalog.families).toEqual([{ ...cached[0], tokensPerGold: 100 }])
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

    it('refreshes a fresh pre-search OpenRouter cache so search is available immediately after deploy', async () => {
        const now = 1_000_000
        const { set } = stubCatalogDoc({
            exists: true,
            data: {
                families: [{ id: 'openrouter:deepseek/deepseek-chat' }],
                fetchedAt: now - 1000,
            },
        })
        const fetchImpl = jest.fn().mockResolvedValue(
            jsonResponse({
                data: [
                    compatibleOpenRouterEntry('deepseek/deepseek-chat', { created: 10 }),
                    compatibleOpenRouterEntry('x-ai/grok-4.6', { created: 20, agenticIndex: 80 }),
                ],
            })
        )

        const catalog = await getModelCatalog('openrouter', { fetchImpl, now })

        expect(catalog.source).toBe('live')
        expect(catalog.searchModels.map(model => model.modelId)).toContain('x-ai/grok-4.6')
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ searchModels: expect.any(Array) }), { merge: true })
    })

    it('serves a STALE cache when discovery fails — real-but-old beats hardcoded', async () => {
        const now = 10 * CATALOG_TTL_MS
        const stale = [{ id: 'terra', label: 'Terra', resolvedModel: 'gpt-5.6-terra', isAlias: false }]
        stubCatalogDoc({ exists: true, data: { families: stale, fetchedAt: 1 } })
        const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'))

        const catalog = await getModelCatalog('codex', { fetchImpl, now })

        expect(catalog.source).toBe('stale')
        expect(catalog.families).toEqual([{ ...stale[0], tokensPerGold: 250 }])
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

    it('resolves a searched OpenRouter model that is not in the featured list', async () => {
        stubCatalogDoc({
            exists: true,
            data: {
                families: [{ id: 'openrouter:deepseek/deepseek-chat' }],
                searchModels: [
                    {
                        id: 'openrouter:x-ai/grok-4.6',
                        modelId: 'x-ai/grok-4.6',
                        resolvedModel: 'openrouter:x-ai/grok-4.6',
                    },
                ],
                fetchedAt: 1000,
            },
        })

        await expect(resolveFamilyToModel('codex', 'openrouter:x-ai/grok-4.6', { now: 1500 })).resolves.toBe(
            'openrouter:x-ai/grok-4.6'
        )
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

// AT-2230 Gold pricing: the catalog is the *live* price source that makes per-model Gold rates
// self-updating, so these guard the shape `vmTokenPricing` consumes.
describe('OpenRouter upstream pricing', () => {
    const openRouterEntry = (id, pricing) => ({
        id,
        name: id,
        supported_parameters: ['tools'],
        architecture: { output_modalities: ['text'] },
        pricing,
    })

    it('converts per-token strings into USD per 1M tokens', () => {
        const price = normalizeOpenRouterPricing({
            prompt: '0.000000435',
            completion: '0.00000087',
            input_cache_read: '0.000000003625',
        })

        expect(price.input).toBeCloseTo(0.435, 6)
        expect(price.output).toBeCloseTo(0.87, 6)
        expect(price.cachedInput).toBeCloseTo(0.003625, 8)
    })

    // Load-bearing distinction, not tidiness: ~85% of a VM run's metered tokens are cache reads, so
    // "no cache price published" must reach the pricing module as null (bill them at full input
    // price) rather than as 0 (bill them free), which would make the model look like the cheapest in
    // the table by an order of magnitude.
    it('reports a missing cache-read price as null, never as zero', () => {
        const price = normalizeOpenRouterPricing({ prompt: '0.0000007', completion: '0.0000025' })

        expect(price.cachedInput).toBeNull()
        expect(
            normalizeOpenRouterPricing({ prompt: '0.1', completion: '0.2', input_cache_read: '' }).cachedInput
        ).toBeNull()
    })

    it('rejects a price it cannot use instead of guessing at one', () => {
        for (const pricing of [
            null,
            undefined,
            {},
            { prompt: 'abc', completion: '1' },
            { prompt: '-1', completion: '1' },
        ]) {
            expect(normalizeOpenRouterPricing(pricing)).toBeNull()
        }
        // A genuinely free model reports "0", which is a real price and must survive.
        expect(normalizeOpenRouterPricing({ prompt: '0', completion: '0' })).toEqual({
            input: 0,
            output: 0,
            cachedInput: null,
        })
    })

    // Search and assistant-supplied agentModel values can name non-featured ids, so pricing must
    // cover every compatible model, not just the compact default list.
    it('prices every compatible model, not only the featured ones', () => {
        const entries = [
            openRouterEntry('deepseek/deepseek-v4-pro', { prompt: '0.000000435', completion: '0.00000087' }),
            openRouterEntry('qwen/qwen3-coder', { prompt: '0.0000003', completion: '0.000001' }),
            // Excluded from the picker AND from pricing: it cannot drive Codex at all.
            { id: 'someone/no-tools', supported_parameters: [], pricing: { prompt: '0.1', completion: '0.2' } },
            openRouterEntry('openai/gpt-5.6-sol', { prompt: '0.000005', completion: '0.00003' }),
        ]

        const pricing = buildOpenRouterPricing(entries)
        const ids = pricing.map(entry => entry.id)

        expect(ids).toContain('deepseek/deepseek-v4-pro')
        expect(ids).toContain('qwen/qwen3-coder')
        expect(ids).not.toContain('someone/no-tools')
        // openai/* is offered natively, so it is not an OpenRouter option and needs no price here.
        expect(ids).not.toContain('openai/gpt-5.6-sol')
    })

    it('resolves a live price for a model by id, case-insensitively', async () => {
        stubCatalogDoc({
            exists: true,
            data: {
                families: [{ id: 'openrouter:deepseek/deepseek-v4-pro', modelId: 'deepseek/deepseek-v4-pro' }],
                fetchedAt: 1000,
                pricing: [{ id: 'deepseek/deepseek-v4-pro', input: 0.435, output: 0.87, cachedInput: 0.003625 }],
            },
        })

        const price = await getOpenRouterUpstreamPrice('DeepSeek/DeepSeek-V4-Pro', { now: 1500 })

        expect(price).toEqual({ input: 0.435, output: 0.87, cachedInput: 0.003625 })
    })

    // A stale cache written before the pricing list existed must still price what it can list, rather
    // than dropping every run back to the Sol base rate.
    it('falls back to the price carried on a picker entry', async () => {
        stubCatalogDoc({
            exists: true,
            data: {
                families: [
                    {
                        id: 'openrouter:qwen/qwen3-coder',
                        modelId: 'qwen/qwen3-coder',
                        upstreamPrice: { input: 0.3, output: 1, cachedInput: 0.1 },
                    },
                ],
                fetchedAt: 1000,
            },
        })

        const price = await getOpenRouterUpstreamPrice('qwen/qwen3-coder', { now: 1500 })

        expect(price).toEqual({ input: 0.3, output: 1, cachedInput: 0.1 })
    })

    // Degrading the price *source* must never fail the run; vmTokenPricing then uses its researched
    // static table and finally the Sol base rate.
    it('returns null rather than throwing when the price cannot be found', async () => {
        stubCatalogDoc({
            exists: true,
            data: {
                families: [{ id: 'openrouter:qwen/qwen3-coder', modelId: 'qwen/qwen3-coder' }],
                fetchedAt: 1000,
                pricing: [],
            },
        })
        expect(await getOpenRouterUpstreamPrice('brandnew/model', { now: 1500 })).toBeNull()

        for (const bad of ['', '   ', null, undefined, 42]) {
            expect(await getOpenRouterUpstreamPrice(bad)).toBeNull()
        }
    })

    // The catalog is returned verbatim to the client by getVmAgentModelOptions/getVmAgentSettings, so
    // hundreds of price entries the UI never reads must not ride along on every Settings load.
    it('keeps the pricing list server-side unless a caller asks for it', async () => {
        const data = {
            families: [{ id: 'openrouter:deepseek/deepseek-v4-pro', modelId: 'deepseek/deepseek-v4-pro' }],
            searchModels: [{ id: 'openrouter:x-ai/grok-4.6', modelId: 'x-ai/grok-4.6', label: 'SpaceXAI: Grok 4.6' }],
            fetchedAt: 1000,
            pricing: [{ id: 'deepseek/deepseek-v4-pro', input: 0.435, output: 0.87, cachedInput: null }],
        }
        stubCatalogDoc({ exists: true, data })

        const clientFacing = await getModelCatalog('openrouter', { now: 1500 })
        expect(clientFacing.pricing).toBeUndefined()
        expect(clientFacing.searchModels).toHaveLength(1)

        stubCatalogDoc({ exists: true, data })
        const serverSide = await getModelCatalog('openrouter', { now: 1500, includePricing: true })
        expect(serverSide.pricing).toHaveLength(1)
    })
})
