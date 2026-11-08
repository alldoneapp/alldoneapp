// security audit 2026-11 (vmLlmProxy:token-not-bound-to-job-priced-model): a platform-billed proxy
// request may only reach the agent's inference endpoints, and is billed at the more expensive of the
// job's rate and the requested model's rate.

const ENV = {
    VM_PROXY_SIGNING_SECRET: 'test-signing-secret',
    VM_LLM_PROXY_BASE_URL: 'https://proxy.example/vmLlmProxy',
    ANTHROPIC_API_KEY: 'platform-anthropic-key',
    OPEN_AI_KEY: 'platform-openai-key',
    OPENROUTER_API_KEY: 'platform-openrouter-key',
}

const mockJobs = {}
const mockUsers = {}
const mockGoldChanges = []
const mockOpenRouterPrices = {}

jest.mock('../envFunctionsHelper', () => ({ getEnvFunctions: jest.fn(() => ENV) }))
jest.mock('./vmAgentModelCatalog', () => ({
    getOpenRouterUpstreamPrice: jest.fn(async modelId => mockOpenRouterPrices[modelId] || null),
}))
jest.mock('../Gold/goldHelper', () => ({
    applyGoldChangeInTransaction: jest.fn(args => {
        mockGoldChanges.push(args)
        return { success: true, amount: -args.delta }
    }),
}))
jest.mock('firebase-admin', () => {
    const readDoc = path => {
        const [collection, id] = path.split('/')
        const store = collection === 'pendingWebhooks' ? mockJobs : mockUsers
        const data = store[id]
        return { exists: data != null, data: () => data }
    }
    const db = {
        doc: path => ({ path, get: async () => readDoc(path), set: async () => {} }),
        runTransaction: async callback =>
            callback({
                get: async ref => readDoc(ref.path),
                set: (ref, data) => {
                    const [collection, id] = ref.path.split('/')
                    if (collection === 'pendingWebhooks') mockJobs[id] = { ...mockJobs[id], ...data }
                },
            }),
    }
    return { firestore: () => db, app: () => ({ options: { projectId: 'test' } }) }
})

const {
    isAllowedProxyEndpoint,
    readRequestedModel,
    resolveProxyRequestRate,
    calculatePremiumTokens,
} = require('./vmProxyModelBinding')
const { handleProxyRequest, mintProxyToken } = require('./vmLlmProxy')

function mintToken({ agent, credentialProvider }) {
    return mintProxyToken(
        {
            correlationId: 'cid-1',
            agent,
            userId: 'u1',
            credentialMode: 'api',
            credentialProvider,
            expiresAtMs: Date.now() + 60_000,
        },
        ENV
    )
}

function buildRequest({ path, method = 'POST', body, headers }) {
    const rawBody = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    return {
        path,
        method,
        originalUrl: `/vmLlmProxy${path}`,
        headers: lower,
        rawBody,
        get: name => lower[name.toLowerCase()],
    }
}

function buildResponse() {
    const res = { statusCode: 200, body: '', headersSent: false }
    res.status = jest.fn(code => {
        res.statusCode = code
        return res
    })
    res.send = jest.fn(text => {
        res.body = text
        res.headersSent = true
    })
    res.setHeader = jest.fn()
    res.write = jest.fn(() => {
        res.headersSent = true
    })
    res.end = jest.fn()
    return res
}

function mockUpstream(usage, model) {
    global.fetch = jest.fn(async () => {
        const chunks = [new Uint8Array(Buffer.from(JSON.stringify({ model, usage })))]
        return {
            status: 200,
            headers: { forEach: callback => callback('application/json', 'content-type') },
            body: {
                getReader: () => ({
                    read: async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true }),
                }),
            },
        }
    })
}

beforeEach(() => {
    for (const store of [mockJobs, mockUsers, mockOpenRouterPrices]) {
        for (const key of Object.keys(store)) delete store[key]
    }
    mockGoldChanges.length = 0
    mockUsers.u1 = { gold: 1_000_000 }
})

afterEach(() => {
    delete global.fetch
})

describe('isAllowedProxyEndpoint', () => {
    test('allows the inference endpoints the agents use', () => {
        expect(isAllowedProxyEndpoint('anthropic', 'POST', '/v1/messages')).toBe(true)
        expect(isAllowedProxyEndpoint('anthropic', 'POST', '/v1/messages/count_tokens')).toBe(true)
        expect(isAllowedProxyEndpoint('openai', 'POST', '/v1/responses')).toBe(true)
        expect(isAllowedProxyEndpoint('openai', 'POST', '/v1/responses/compact')).toBe(true)
        expect(isAllowedProxyEndpoint('openrouter', 'POST', '/v1/chat/completions')).toBe(true)
        expect(isAllowedProxyEndpoint('openai', 'GET', '/v1/models')).toBe(true)
    })

    test('refuses endpoints that report no token usage or reach account data', () => {
        expect(isAllowedProxyEndpoint('anthropic', 'POST', '/v1/messages/batches')).toBe(false)
        expect(isAllowedProxyEndpoint('anthropic', 'GET', '/v1/files')).toBe(false)
        expect(isAllowedProxyEndpoint('openai', 'POST', '/v1/images/generations')).toBe(false)
        expect(isAllowedProxyEndpoint('openai', 'POST', '/v1/fine_tuning/jobs')).toBe(false)
        expect(isAllowedProxyEndpoint('openai', 'POST', '/v1/batches')).toBe(false)
        expect(isAllowedProxyEndpoint('openai', 'GET', '/v1/files/file-1/content')).toBe(false)
        expect(isAllowedProxyEndpoint('openai', 'DELETE', '/v1/responses')).toBe(false)
    })
})

describe('readRequestedModel', () => {
    test('reads the model from a JSON body and tolerates anything else', () => {
        expect(readRequestedModel(Buffer.from('{"model":" claude-opus-4-1 "}'))).toBe('claude-opus-4-1')
        expect(readRequestedModel(Buffer.from('not json'))).toBe('')
        expect(readRequestedModel(undefined)).toBe('')
        expect(readRequestedModel(Buffer.from('[1]'))).toBe('')
    })
})

describe('resolveProxyRequestRate', () => {
    test('a request for the job model keeps the job rate', async () => {
        const result = await resolveProxyRequestRate({
            jobState: { agentModel: 'openrouter:deepseek/deepseek-v4-flash-0731', tokensPerGold: 3800 },
            provider: 'openrouter',
            requestedModel: 'deepseek/deepseek-v4-flash-0731',
        })
        expect(result).toEqual(expect.objectContaining({ allowed: true, requestRate: 3800, reason: 'job_model' }))
    })

    test('a Claude alias job keeps its rate for the release behind the alias', async () => {
        const result = await resolveProxyRequestRate({
            jobState: { agentModel: 'opus', tokensPerGold: 120 },
            provider: 'anthropic',
            requestedModel: 'claude-opus-9-1',
        })
        expect(result).toEqual(expect.objectContaining({ allowed: true, requestRate: 120 }))
    })

    test('a cheaper auxiliary model is still billed at the job rate', async () => {
        const result = await resolveProxyRequestRate({
            jobState: { agentModel: 'opus', tokensPerGold: 120 },
            provider: 'anthropic',
            requestedModel: 'claude-haiku-4-5',
        })
        expect(result.requestRate).toBe(120)
    })

    test('a dearer model is billed at its own rate', async () => {
        const result = await resolveProxyRequestRate({
            jobState: { agentModel: 'haiku', tokensPerGold: 400 },
            provider: 'anthropic',
            requestedModel: 'claude-opus-4-1',
        })
        expect(result.requestRate).toBe(26)
    })

    test('an OpenRouter model is priced from the live catalog', async () => {
        const result = await resolveProxyRequestRate({
            jobState: { agentModel: 'openrouter:deepseek/deepseek-v4-flash-0731', tokensPerGold: 3800 },
            provider: 'openrouter',
            requestedModel: 'anthropic/claude-opus-4.1',
            getOpenRouterPrice: async () => ({ input: 15, cachedInput: 1.5, output: 75 }),
        })
        expect(result.allowed).toBe(true)
        expect(result.requestRate).toBeLessThan(100)
    })

    test('a model that cannot be priced is refused', async () => {
        const jobState = { agentModel: 'openrouter:deepseek/deepseek-v4-flash-0731', tokensPerGold: 3800 }
        await expect(
            resolveProxyRequestRate({ jobState, provider: 'openrouter', requestedModel: 'openai/o1-pro' })
        ).resolves.toEqual(expect.objectContaining({ allowed: false }))
        await expect(
            resolveProxyRequestRate({
                jobState: { agentModel: 'gpt-6.1-sol', tokensPerGold: 240 },
                provider: 'openai',
                requestedModel: 'o1-pro',
            })
        ).resolves.toEqual(expect.objectContaining({ allowed: false }))
        await expect(
            resolveProxyRequestRate({
                jobState: { agentModel: 'gpt-6.1-sol', tokensPerGold: 240 },
                provider: 'openai',
                requestedModel: 'gpt-6-pro',
            })
        ).resolves.toEqual(expect.objectContaining({ allowed: false }))
    })

    test('an unpriced Codex model bills at the most expensive Codex rate, not the job rate', async () => {
        const result = await resolveProxyRequestRate({
            jobState: { agentModel: 'gpt-6-luna', tokensPerGold: 2500 },
            provider: 'openai',
            requestedModel: 'codex-auto-review',
        })
        expect(result.allowed).toBe(true)
        expect(result.requestRate).toBeLessThan(2500)
    })

    test('premium tokens make a dearer request cost its own rate', () => {
        // 1,000,000 tokens at 26/Gold = 38,462 Gold; on a 400/Gold job that is 15.38M job-rate tokens.
        const premium = calculatePremiumTokens(1_000_000, 400, 26)
        expect(Math.round((1_000_000 + premium) / 400)).toBe(Math.round(1_000_000 / 26))
        expect(calculatePremiumTokens(1_000_000, 400, 400)).toBe(0)
    })
})

describe('handleProxyRequest binds platform-billed requests to the job', () => {
    test('bills an expensive model on a cheap Haiku job at the expensive rate', async () => {
        mockJobs['cid-1'] = {
            userId: 'u1',
            status: 'initiated',
            credentialMode: 'api',
            agent: 'claude',
            agentModel: 'haiku',
            tokensPerGold: 400,
        }
        mockUpstream({ input_tokens: 1_000_000, output_tokens: 0 }, 'claude-opus-4-1')
        const res = buildResponse()

        await handleProxyRequest(
            buildRequest({
                path: '/anthropic/v1/messages',
                body: { model: 'claude-opus-4-1', messages: [] },
                headers: { 'x-api-key': mintToken({ agent: 'claude', credentialProvider: 'claude' }) },
            }),
            res
        )

        expect(res.statusCode).toBe(200)
        const charged = mockGoldChanges.reduce((sum, change) => sum - change.delta, 0)
        // 1M tokens at Opus 4.1's 26 tokens/Gold, not 2,500 Gold at the Haiku job rate.
        expect(charged).toBe(Math.round(1_000_000 / 26))
    })

    test('keeps billing the job model exactly as before', async () => {
        mockJobs['cid-1'] = {
            userId: 'u1',
            status: 'initiated',
            credentialMode: 'api',
            agent: 'claude',
            agentModel: 'haiku',
            tokensPerGold: 400,
        }
        mockUpstream({ input_tokens: 400_000, output_tokens: 0 }, 'claude-haiku-4-5')
        const res = buildResponse()

        await handleProxyRequest(
            buildRequest({
                path: '/anthropic/v1/messages',
                body: { model: 'claude-haiku-4-5', messages: [] },
                headers: { 'x-api-key': mintToken({ agent: 'claude', credentialProvider: 'claude' }) },
            }),
            res
        )

        expect(mockGoldChanges.reduce((sum, change) => sum - change.delta, 0)).toBe(1000)
        expect(mockJobs['cid-1'].proxyTokenUsage.premiumTokens).toBeUndefined()
    })

    test('refuses an unpriced model before anything reaches the upstream', async () => {
        mockJobs['cid-1'] = {
            userId: 'u1',
            status: 'initiated',
            credentialMode: 'api',
            agent: 'codex',
            agentModel: 'openrouter:deepseek/deepseek-v4-flash-0731',
            credentialProvider: 'openrouter',
            tokensPerGold: 3800,
        }
        mockUpstream({ prompt_tokens: 1 }, 'openai/o1-pro')
        const res = buildResponse()

        await handleProxyRequest(
            buildRequest({
                path: '/openrouter/v1/chat/completions',
                body: { model: 'openai/o1-pro', messages: [] },
                headers: { authorization: `Bearer ${mintToken({ agent: 'codex', credentialProvider: 'openrouter' })}` },
            }),
            res
        )

        expect(res.statusCode).toBe(403)
        expect(global.fetch).not.toHaveBeenCalled()
    })

    test('refuses a non-inference endpoint on the platform key', async () => {
        mockJobs['cid-1'] = {
            userId: 'u1',
            status: 'initiated',
            credentialMode: 'api',
            agent: 'claude',
            agentModel: 'haiku',
            tokensPerGold: 400,
        }
        mockUpstream({}, '')
        const res = buildResponse()

        await handleProxyRequest(
            buildRequest({
                path: '/anthropic/v1/messages/batches',
                body: { requests: [] },
                headers: { 'x-api-key': mintToken({ agent: 'claude', credentialProvider: 'claude' }) },
            }),
            res
        )

        expect(res.statusCode).toBe(404)
        expect(global.fetch).not.toHaveBeenCalled()
    })

    test('an OpenAI-routed Codex token cannot spend the platform OpenRouter key', async () => {
        mockJobs['cid-1'] = {
            userId: 'u1',
            status: 'initiated',
            credentialMode: 'api',
            agent: 'codex',
            agentModel: 'gpt-6.1-sol',
            credentialProvider: 'codex',
            tokensPerGold: 240,
        }
        mockUpstream({ prompt_tokens: 1 }, 'deepseek/deepseek-v4-pro')
        const res = buildResponse()

        await handleProxyRequest(
            buildRequest({
                path: '/openrouter/v1/chat/completions',
                body: { model: 'deepseek/deepseek-v4-pro', messages: [] },
                headers: { authorization: `Bearer ${mintToken({ agent: 'codex', credentialProvider: 'codex' })}` },
            }),
            res
        )

        expect(res.statusCode).toBe(403)
        expect(global.fetch).not.toHaveBeenCalled()
    })
})
