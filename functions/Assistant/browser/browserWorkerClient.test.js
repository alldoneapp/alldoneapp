'use strict'

const { callBrowserWorker, verifyWorkerToken } = require('./browserWorkerClient')

const SECRET = 'browser-worker-signing-secret'
const CONFIG = {
    workerBaseUrl: 'https://browser-worker.example',
    signingSecret: SECRET,
    accessMode: 'all_public',
    allowlist: [],
    denylist: [],
    limits: {},
}

describe('callBrowserWorker Cloud Run authentication', () => {
    test('keeps Cloud Run IAM and application authorization in separate headers', async () => {
        const fetchImpl = jest.fn(async (_url, options) => ({
            ok: true,
            status: 200,
            json: async () => ({ ok: true }),
            options,
        }))
        const identityTokenProvider = jest.fn(async () => 'google-cloud-run-id-token')

        const result = await callBrowserWorker({
            operation: 'act',
            payload: { action: 'navigate', url: 'https://example.com' },
            config: CONFIG,
            runId: 'run1',
            sessionId: 'session1',
            projectId: 'project1',
            userId: 'user1',
            fetchImpl,
            identityTokenProvider,
        })

        expect(result.ok).toBe(true)
        expect(identityTokenProvider).toHaveBeenCalledWith(CONFIG.workerBaseUrl)

        const options = fetchImpl.mock.calls[0][1]
        expect(options.headers['X-Serverless-Authorization']).toBe('Bearer google-cloud-run-id-token')
        const workerToken = options.headers.Authorization.replace('Bearer ', '')
        expect(verifyWorkerToken(workerToken, SECRET)).toMatchObject({
            valid: true,
            runId: 'run1',
            sessionId: 'session1',
            projectId: 'project1',
            userId: 'user1',
        })
    })

    test('round-trips the opaque Cloud Run session-affinity cookie', async () => {
        const fetchImpl = jest.fn(async (_url, options) => ({
            ok: true,
            status: 200,
            headers: { get: name => (name === 'set-cookie' ? 'GOOG-RUN-AFFINITY=new-route; Path=/; Secure' : '') },
            json: async () => ({ ok: true }),
            options,
        }))

        const result = await callBrowserWorker({
            operation: 'act',
            config: CONFIG,
            runId: 'run1',
            sessionId: 'session1',
            fetchImpl,
            identityTokenProvider: async () => 'google-cloud-run-id-token',
            affinityCookie: 'GOOG-RUN-AFFINITY=old-route',
        })

        expect(fetchImpl.mock.calls[0][1].headers.Cookie).toBe('GOOG-RUN-AFFINITY=old-route')
        expect(result.affinityCookie).toBe('GOOG-RUN-AFFINITY=new-route')
    })

    test('fails closed before calling the worker when Cloud Run authentication fails', async () => {
        const fetchImpl = jest.fn()

        const result = await callBrowserWorker({
            operation: 'act',
            config: CONFIG,
            runId: 'run1',
            sessionId: 'session1',
            fetchImpl,
            identityTokenProvider: async () => {
                throw new Error('metadata unavailable')
            },
        })

        expect(result).toMatchObject({ ok: false, reason: 'cloud_run_auth' })
        expect(result.error).toMatch(/metadata unavailable/)
        expect(fetchImpl).not.toHaveBeenCalled()
    })
})
