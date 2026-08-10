const {
    mintProxyToken,
    verifyProxyToken,
    isProxyEnabled,
    getProxyBaseUrl,
    buildVmAgentCredentials,
    resolveProvider,
    captureUsageFromTextChunk,
    finalizeCapturedUsage,
    extractUsageFromJsonPayload,
    chargeProxyTokenGold,
    checkProxyJobCanContinue,
    TOKEN_PREFIX,
} = require('./vmLlmProxy')

const SECRET = 'test-signing-secret-abc123'
const ENV = { VM_PROXY_SIGNING_SECRET: SECRET, VM_LLM_PROXY_BASE_URL: 'https://proxy.example/vmLlmProxy' }
const NOW = 1_000_000_000_000
const FUTURE = NOW + 60_000

describe('vmLlmProxy token mint/verify', () => {
    test('mint + verify round-trips for the matching agent', () => {
        const token = mintProxyToken(
            { correlationId: 'cid-1', agent: 'claude', userId: 'u1', expiresAtMs: FUTURE },
            ENV
        )
        expect(token.startsWith(TOKEN_PREFIX)).toBe(true)
        const verdict = verifyProxyToken(token, { expectedAgent: 'claude', env: ENV, nowMs: NOW })
        expect(verdict.valid).toBe(true)
        expect(verdict.payload.cid).toBe('cid-1')
        expect(verdict.payload.uid).toBe('u1')
    })

    test('rejects a tampered payload (signature mismatch)', () => {
        const token = mintProxyToken(
            { correlationId: 'cid-1', agent: 'claude', userId: 'u1', expiresAtMs: FUTURE },
            ENV
        )
        const [body, sig] = token.slice(TOKEN_PREFIX.length).split('.')
        const tampered = `${TOKEN_PREFIX}${body}x.${sig}`
        expect(verifyProxyToken(tampered, { expectedAgent: 'claude', env: ENV, nowMs: NOW }).valid).toBe(false)
    })

    test('rejects a token signed with a different secret', () => {
        const token = mintProxyToken(
            { correlationId: 'cid-1', agent: 'claude', userId: 'u1', expiresAtMs: FUTURE },
            { VM_PROXY_SIGNING_SECRET: 'other-secret' }
        )
        const verdict = verifyProxyToken(token, { expectedAgent: 'claude', env: ENV, nowMs: NOW })
        expect(verdict.valid).toBe(false)
        expect(verdict.reason).toBe('signature')
    })

    test('rejects an expired token', () => {
        const token = mintProxyToken({ correlationId: 'cid-1', agent: 'claude', userId: 'u1', expiresAtMs: NOW }, ENV)
        const verdict = verifyProxyToken(token, { expectedAgent: 'claude', env: ENV, nowMs: NOW + 1 })
        expect(verdict.valid).toBe(false)
        expect(verdict.reason).toBe('expired')
    })

    test('rejects when the route agent does not match the token agent (no cross-provider replay)', () => {
        const token = mintProxyToken(
            { correlationId: 'cid-1', agent: 'claude', userId: 'u1', expiresAtMs: FUTURE },
            ENV
        )
        const verdict = verifyProxyToken(token, { expectedAgent: 'codex', env: ENV, nowMs: NOW })
        expect(verdict.valid).toBe(false)
        expect(verdict.reason).toBe('agent')
    })

    test('rejects a token without the expected prefix', () => {
        expect(verifyProxyToken('sk-ant-real-key', { expectedAgent: 'claude', env: ENV, nowMs: NOW }).valid).toBe(false)
    })

    test('verification fails closed when no signing secret is configured', () => {
        const token = mintProxyToken({ correlationId: 'c', agent: 'claude', userId: 'u', expiresAtMs: FUTURE }, ENV)
        const verdict = verifyProxyToken(token, { expectedAgent: 'claude', env: {}, nowMs: NOW })
        expect(verdict.valid).toBe(false)
        expect(verdict.reason).toBe('no_secret')
    })
})

describe('vmLlmProxy config + routing', () => {
    test('isProxyEnabled reflects the signing secret', () => {
        expect(isProxyEnabled(ENV)).toBe(true)
        expect(isProxyEnabled({})).toBe(false)
    })

    test('getProxyBaseUrl prefers the explicit override and trims trailing slashes', () => {
        expect(getProxyBaseUrl({ VM_LLM_PROXY_BASE_URL: 'https://p.example/vmLlmProxy/' })).toBe(
            'https://p.example/vmLlmProxy'
        )
    })

    test('resolveProvider maps the agent paths and rejects unknown routes', () => {
        expect(resolveProvider('/anthropic/v1/messages')).toMatchObject({
            provider: 'anthropic',
            forwardPath: '/v1/messages',
        })
        expect(resolveProvider('/openai/v1/responses')).toMatchObject({
            provider: 'openai',
            forwardPath: '/v1/responses',
        })
        expect(resolveProvider('/something/else')).toBeNull()
    })
})

describe('vmLlmProxy token usage parsing', () => {
    test('captures Anthropic streamed message_start plus final output-token delta usage', () => {
        const state = { buffer: '', usage: { inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: 0 } }
        captureUsageFromTextChunk(
            'anthropic',
            [
                'data: {"type":"message_start","message":{"usage":{"input_tokens":120,"cache_read_input_tokens":30,"output_tokens":1}}}',
                'data: {"type":"message_delta","usage":{"output_tokens":40}}',
                'data: {"type":"message_delta","usage":{"output_tokens":45}}',
                '',
            ].join('\n'),
            state
        )

        expect(finalizeCapturedUsage('anthropic', state)).toEqual({
            inputTokens: 120,
            outputTokens: 46,
            cacheTokens: 30,
            totalTokens: 196,
        })
    })

    test('extracts OpenAI response usage payloads', () => {
        expect(
            extractUsageFromJsonPayload('openai', {
                type: 'response.completed',
                response: {
                    usage: {
                        input_tokens: 100,
                        output_tokens: 25,
                        total_tokens: 125,
                        input_tokens_details: { cached_tokens: 10 },
                    },
                },
            })
        ).toEqual({
            inputTokens: 100,
            outputTokens: 25,
            cacheTokens: 10,
            totalTokens: 125,
        })
    })
})

describe('vmLlmProxy job authorization', () => {
    function buildDb(pendingData, userGold = 10) {
        return {
            doc: jest.fn(path => ({ path })),
            docData: pendingData,
            asyncData: userGold,
        }
    }

    function attachGets(db) {
        const originalDoc = db.doc
        db.doc = jest.fn(path => {
            const ref = originalDoc(path)
            ref.get = async () =>
                path.startsWith('pendingWebhooks/')
                    ? { exists: !!db.docData, data: () => db.docData || {} }
                    : { exists: true, data: () => ({ gold: db.asyncData }) }
            ref.set = jest.fn(async () => {})
            return ref
        })
        return db
    }

    test('rejects a signed token from a different user or credential route', async () => {
        const wrongUserDb = attachGets(buildDb({ userId: 'owner', credentialMode: 'byok', status: 'initiated' }))
        await expect(
            checkProxyJobCanContinue({
                correlationId: 'cid-1',
                userId: 'attacker',
                credentialMode: 'byok',
                db: wrongUserDb,
            })
        ).resolves.toMatchObject({ allowed: false, message: expect.stringContaining('not authorized') })

        const wrongModeDb = attachGets(buildDb({ userId: 'owner', credentialMode: 'api', status: 'initiated' }))
        await expect(
            checkProxyJobCanContinue({
                correlationId: 'cid-1',
                userId: 'owner',
                credentialMode: 'byok',
                db: wrongModeDb,
            })
        ).resolves.toMatchObject({ allowed: false, message: expect.stringContaining('route') })
    })

    test('allows the owning user to use the selected BYOK route while the job is active', async () => {
        const db = attachGets(buildDb({ userId: 'owner', credentialMode: 'byok', status: 'initiated' }))
        await expect(
            checkProxyJobCanContinue({
                correlationId: 'cid-1',
                userId: 'owner',
                credentialMode: 'byok',
                db,
            })
        ).resolves.toEqual({ allowed: true, currentGold: 10 })
    })
})

describe('vmLlmProxy token Gold charging', () => {
    function buildFakeDb({ userGold = 10, pendingData = {} } = {}) {
        const userRef = { path: 'users/u1' }
        const pendingRef = { path: 'pendingWebhooks/cid-1' }
        const writes = []
        return {
            writes,
            db: {
                doc: jest.fn(path => {
                    if (path === 'users/u1') return userRef
                    if (path === 'pendingWebhooks/cid-1') return pendingRef
                    return { path }
                }),
                runTransaction: async callback =>
                    callback({
                        get: async ref => {
                            if (ref === userRef) return { exists: true, data: () => ({ gold: userGold }) }
                            if (ref === pendingRef)
                                return {
                                    exists: true,
                                    data: () => ({
                                        projectId: 'project-1',
                                        objectId: 'chat-1',
                                        objectType: 'topics',
                                        ...pendingData,
                                    }),
                                }
                            return { exists: false, data: () => ({}) }
                        },
                        set: (ref, data, options) => writes.push({ ref, data, options }),
                    }),
            },
        }
    }

    test('charges only newly accrued rounded token Gold and updates pending usage totals', async () => {
        const { db, writes } = buildFakeDb({
            pendingData: {
                proxyTokenUsage: { inputTokens: 20, outputTokens: 20, cacheTokens: 0, totalTokens: 40 },
                proxyTokenGoldCharged: 0,
            },
        })
        const applyGoldChangeInTransactionFn = jest.fn(() => ({ success: true, amount: 1 }))

        const result = await chargeProxyTokenGold({
            correlationId: 'cid-1',
            userId: 'u1',
            provider: 'anthropic',
            usage: { inputTokens: 60, outputTokens: 20, cacheTokens: 0, totalTokens: 80 },
            db,
            applyGoldChangeInTransactionFn,
        })

        expect(result).toEqual(expect.objectContaining({ charged: 1, totalTokensTracked: 120 }))
        expect(applyGoldChangeInTransactionFn).toHaveBeenCalledWith(
            expect.objectContaining({
                delta: -1,
                source: 'vm_execution',
                requireSufficientBalance: true,
            })
        )
        expect(writes[writes.length - 1].data).toEqual(
            expect.objectContaining({
                proxyTokenUsage: {
                    inputTokens: 80,
                    outputTokens: 40,
                    cacheTokens: 0,
                    totalTokens: 120,
                },
                proxyTokenGoldCharged: 1,
                proxyLastUsageProvider: 'anthropic',
            })
        )
    })

    // AT-2230 pricing: the live half of per-model rates. The rate is read from the job doc — NOT from
    // the sandbox's request body — so a compromised agent cannot talk its own tokens down to a
    // cheaper model's rate.
    test('charges token Gold at the rate frozen on the job at launch', async () => {
        const { db, writes } = buildFakeDb({
            userGold: 100000,
            pendingData: { agentModel: 'openrouter:deepseek/deepseek-v4-pro', tokensPerGold: 1800 },
        })
        const applyGoldChangeInTransactionFn = jest.fn(() => ({ success: true, amount: 100 }))

        const result = await chargeProxyTokenGold({
            correlationId: 'cid-1',
            userId: 'u1',
            provider: 'openrouter',
            usage: { inputTokens: 150000, outputTokens: 1000, cacheTokens: 29000, totalTokens: 180000 },
            db,
            applyGoldChangeInTransactionFn,
        })

        // 180,000 tokens at 1800/Gold = 100 Gold (it would be 1800 at the Sol rate).
        expect(result).toEqual(expect.objectContaining({ charged: 100 }))
        expect(applyGoldChangeInTransactionFn).toHaveBeenCalledWith(expect.objectContaining({ delta: -100 }))
        expect(writes[writes.length - 1].data).toEqual(expect.objectContaining({ proxyTokenGoldCharged: 100 }))
    })

    // The persisted rate is authoritative because it can carry a *live* upstream price the static
    // table has never seen. If the proxy re-derived its own rate here it could disagree with the
    // runner's settlement, which is exactly the drift vmTokenPricing exists to prevent.
    test('a persisted rate overrides what the model id alone would resolve to', async () => {
        const { db } = buildFakeDb({
            userGold: 100000,
            pendingData: { agentModel: 'openrouter:qwen/qwen3-coder', tokensPerGold: 5000 },
        })
        const applyGoldChangeInTransactionFn = jest.fn(() => ({ success: true, amount: 20 }))

        await chargeProxyTokenGold({
            correlationId: 'cid-1',
            userId: 'u1',
            provider: 'openrouter',
            usage: { totalTokens: 100000 },
            db,
            applyGoldChangeInTransactionFn,
        })

        // 100,000 / 5000 = 20, not the 104 the researched qwen rate (960) would give.
        expect(applyGoldChangeInTransactionFn).toHaveBeenCalledWith(expect.objectContaining({ delta: -20 }))
    })

    // A job doc carrying only a model id (no frozen rate) must still price per model.
    test('falls back to the researched per-model rate when no rate was persisted', async () => {
        const { db } = buildFakeDb({ userGold: 100000, pendingData: { agentModel: 'openrouter:qwen/qwen3-coder' } })
        const applyGoldChangeInTransactionFn = jest.fn(() => ({ success: true, amount: 104 }))

        await chargeProxyTokenGold({
            correlationId: 'cid-1',
            userId: 'u1',
            provider: 'openrouter',
            usage: { totalTokens: 100000 },
            db,
            applyGoldChangeInTransactionFn,
        })

        // round(100000 / 960) = 104
        expect(applyGoldChangeInTransactionFn).toHaveBeenCalledWith(expect.objectContaining({ delta: -104 }))
    })

    test('charges a Luna run at 1/25 of the Sol rate', async () => {
        const { db } = buildFakeDb({ userGold: 100000, pendingData: { agentModel: 'gpt-5.6-luna' } })
        const applyGoldChangeInTransactionFn = jest.fn(() => ({ success: true, amount: 40 }))

        await chargeProxyTokenGold({
            correlationId: 'cid-1',
            userId: 'u1',
            provider: 'openai',
            usage: { totalTokens: 100000 },
            db,
            applyGoldChangeInTransactionFn,
        })

        // 100,000 / 2500 = 40 Gold, against 1000 on Sol.
        expect(applyGoldChangeInTransactionFn).toHaveBeenCalledWith(expect.objectContaining({ delta: -40 }))
    })

    // A job doc written before agentModel was persisted must bill exactly as it did before.
    test('a job doc with no recorded model charges at the standard rate', async () => {
        const { db } = buildFakeDb({ userGold: 1000, pendingData: {} })
        const applyGoldChangeInTransactionFn = jest.fn(() => ({ success: true, amount: 10 }))

        await chargeProxyTokenGold({
            correlationId: 'cid-1',
            userId: 'u1',
            provider: 'openai',
            usage: { totalTokens: 1000 },
            db,
            applyGoldChangeInTransactionFn,
        })

        expect(applyGoldChangeInTransactionFn).toHaveBeenCalledWith(expect.objectContaining({ delta: -10 }))
    })

    // Guards the revenue hole a bigger divisor opens: at 4900 tokens/Gold — the cheapest rate in the
    // table — a single small request rounds to zero 49x more often than at the Sol rate, so the tokens
    // must stay banked in the running total and be billed once it crosses the threshold, never dropped.
    test('token dust below the rounding threshold is banked, then billed', async () => {
        const first = buildFakeDb({
            userGold: 1000,
            pendingData: { agentModel: 'openrouter:deepseek/deepseek-v4-flash-0731', tokensPerGold: 4900 },
        })
        const firstCharge = jest.fn(() => ({ success: true, amount: 0 }))

        const dust = await chargeProxyTokenGold({
            correlationId: 'cid-1',
            userId: 'u1',
            provider: 'openrouter',
            usage: { totalTokens: 2000 },
            db: first.db,
            applyGoldChangeInTransactionFn: firstCharge,
        })

        // Nothing charged yet, but the tokens are recorded.
        expect(dust.charged).toBe(0)
        expect(firstCharge).not.toHaveBeenCalled()
        expect(first.writes[first.writes.length - 1].data).toEqual(
            expect.objectContaining({ proxyTokenUsage: expect.objectContaining({ totalTokens: 2000 }) })
        )

        // Next request resumes from that banked total rather than starting over.
        const second = buildFakeDb({
            userGold: 1000,
            pendingData: {
                agentModel: 'openrouter:deepseek/deepseek-v4-flash-0731',
                tokensPerGold: 4900,
                proxyTokenUsage: { inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: 2000 },
                proxyTokenGoldCharged: 0,
            },
        })
        const secondCharge = jest.fn(() => ({ success: true, amount: 1 }))

        const result = await chargeProxyTokenGold({
            correlationId: 'cid-1',
            userId: 'u1',
            provider: 'openrouter',
            usage: { totalTokens: 3000 },
            db: second.db,
            applyGoldChangeInTransactionFn: secondCharge,
        })

        // 5000 cumulative tokens → round(5000/4900) = 1 Gold. The first 2000 were not lost.
        expect(result).toEqual(expect.objectContaining({ charged: 1, totalTokensTracked: 5000 }))
    })
})

describe('buildVmAgentCredentials', () => {
    test('proxy mode: hands out a per-job token + base URL, never the real key', () => {
        const creds = buildVmAgentCredentials({
            vmJob: { correlationId: 'cid-9', requestUserId: 'u9' },
            agent: 'claude',
            realApiKey: 'sk-ant-REAL',
            ttlMs: 60_000,
            env: ENV,
        })
        expect(creds.mode).toBe('proxy')
        expect(creds.baseUrl).toBe('https://proxy.example/vmLlmProxy')
        expect(creds.apiKey.startsWith(TOKEN_PREFIX)).toBe(true)
        expect(creds.apiKey).not.toContain('REAL')
    })

    test('BYOK mode still hands the sandbox only a proxy token and needs no raw platform key', () => {
        const creds = buildVmAgentCredentials({
            vmJob: { correlationId: 'cid-byok', requestUserId: 'u9' },
            agent: 'codex',
            realApiKey: '',
            credentialMode: 'byok',
            ttlMs: 60_000,
            env: ENV,
        })
        const verdict = verifyProxyToken(creds.apiKey, { expectedAgent: 'codex', env: ENV })

        expect(creds.mode).toBe('proxy')
        expect(creds.credentialMode).toBe('byok')
        expect(verdict.valid).toBe(true)
        expect(verdict.payload).toEqual(expect.objectContaining({ uid: 'u9', cm: 'byok' }))
        expect(creds.apiKey).not.toContain('sk-')
    })

    test('fails closed when the proxy signing secret is not configured', () => {
        expect(() =>
            buildVmAgentCredentials({
                vmJob: { correlationId: 'cid-9', requestUserId: 'u9' },
                agent: 'claude',
                realApiKey: 'sk-ant-REAL',
                ttlMs: 60_000,
                env: {},
            })
        ).toThrow('VM_PROXY_SIGNING_SECRET')
    })

    test('fails closed when the proxy base URL cannot be resolved', () => {
        expect(() =>
            buildVmAgentCredentials({
                vmJob: { correlationId: 'cid-9', requestUserId: 'u9' },
                agent: 'claude',
                realApiKey: 'sk-ant-REAL',
                ttlMs: 60_000,
                env: { VM_PROXY_SIGNING_SECRET: SECRET },
            })
        ).toThrow('VM_LLM_PROXY_BASE_URL')
    })
})

// ---------------------------------------------------------------------------
// OpenRouter upstream for the Codex harness (AT-2230)
// ---------------------------------------------------------------------------

const { ensureStreamUsageRequested } = require('./vmLlmProxy')

describe('vmLlmProxy OpenRouter route', () => {
    test('maps /openrouter to the OpenRouter upstream and keeps the forwarded path', () => {
        const matched = resolveProvider('/openrouter/v1/chat/completions')
        expect(matched).toMatchObject({
            provider: 'openrouter',
            forwardPath: '/v1/chat/completions',
        })
        expect(matched.config.upstreamBase).toBe('https://openrouter.ai/api')
        expect(matched.config.realKeyField).toBe('OPENROUTER_API_KEY')
    })

    // The token is minted for the codex agent, so an OpenRouter run needs no new token shape — and
    // a Claude token still cannot be replayed against this route.
    test('accepts a codex token and rejects a claude one', () => {
        const codexToken = mintProxyToken(
            { correlationId: 'cid-1', agent: 'codex', userId: 'u1', expiresAtMs: FUTURE },
            ENV
        )
        const claudeToken = mintProxyToken(
            { correlationId: 'cid-1', agent: 'claude', userId: 'u1', expiresAtMs: FUTURE },
            ENV
        )
        const { config } = resolveProvider('/openrouter/v1/chat/completions')

        expect(verifyProxyToken(codexToken, { expectedAgent: config.expectedAgent, env: ENV, nowMs: NOW }).valid).toBe(
            true
        )
        expect(verifyProxyToken(claudeToken, { expectedAgent: config.expectedAgent, env: ENV, nowMs: NOW }).valid).toBe(
            false
        )
    })

    // BYOK stores a key per *agent*; an OpenAI key cannot authenticate against OpenRouter, so this
    // route is always platform-billed (startVmJob pins credentialMode to 'api' to match).
    test('does not support BYOK', () => {
        expect(resolveProvider('/openrouter/v1/chat/completions').config.supportsByok).toBe(false)
        expect(resolveProvider('/openai/v1/responses').config.supportsByok).toBeUndefined()
    })

    test('captures usage from a streamed Chat Completions final chunk', () => {
        const state = { buffer: '', usage: undefined, anthropicDeltaUsage: null }
        captureUsageFromTextChunk(
            'openrouter',
            'data: {"choices":[{"delta":{"content":"hi"}}]}\n' +
                'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":30,"total_tokens":150}}\n' +
                'data: [DONE]\n',
            state
        )
        expect(finalizeCapturedUsage('openrouter', state)).toMatchObject({
            inputTokens: 120,
            outputTokens: 30,
            totalTokens: 150,
        })
    })

    test('reads usage from a non-streamed response body', () => {
        expect(
            extractUsageFromJsonPayload('openrouter', {
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            })
        ).toMatchObject({ totalTokens: 15 })
    })
})

describe('ensureStreamUsageRequested', () => {
    // Without include_usage the Chat Completions stream reports no usage at all, so every streamed
    // OpenRouter run would bill zero Gold — a silent revenue hole rather than a visible failure.
    test('adds include_usage to a streaming request', () => {
        const body = Buffer.from(JSON.stringify({ model: 'deepseek/deepseek-chat', stream: true }))
        const rewritten = JSON.parse(ensureStreamUsageRequested(body).toString('utf8'))
        expect(rewritten).toMatchObject({
            model: 'deepseek/deepseek-chat',
            stream: true,
            stream_options: { include_usage: true },
        })
    })

    test('preserves other stream options the caller already set', () => {
        const body = Buffer.from(JSON.stringify({ stream: true, stream_options: { something: 1 } }))
        const rewritten = JSON.parse(ensureStreamUsageRequested(body).toString('utf8'))
        expect(rewritten.stream_options).toEqual({ something: 1, include_usage: true })
    })

    test('leaves a non-streaming request untouched', () => {
        const body = Buffer.from(JSON.stringify({ stream: false }))
        expect(ensureStreamUsageRequested(body)).toBe(body)
    })

    test('forwards anything it cannot parse byte-for-byte', () => {
        const body = Buffer.from('not json at all')
        expect(ensureStreamUsageRequested(body)).toBe(body)
        expect(ensureStreamUsageRequested(undefined)).toBeUndefined()
    })
})
