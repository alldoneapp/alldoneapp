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
