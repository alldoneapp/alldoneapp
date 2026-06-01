const {
    mintProxyToken,
    verifyProxyToken,
    isProxyEnabled,
    getProxyBaseUrl,
    buildVmAgentCredentials,
    resolveProvider,
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

    test('direct mode: falls back to the real key when the proxy is not configured', () => {
        const creds = buildVmAgentCredentials({
            vmJob: { correlationId: 'cid-9', requestUserId: 'u9' },
            agent: 'claude',
            realApiKey: 'sk-ant-REAL',
            ttlMs: 60_000,
            env: {},
        })
        expect(creds.mode).toBe('direct')
        expect(creds.baseUrl).toBeNull()
        expect(creds.apiKey).toBe('sk-ant-REAL')
    })
})
