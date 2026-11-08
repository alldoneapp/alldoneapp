'use strict'

// Security audit 2026-11: executeWebhookForMessage was an unauthenticated callable that took the
// webhook URL, its credentials, the answering assistant and the audience from the request, and
// the public callback settled any pendingWebhooks record (VM jobs included) by correlationId alone.

jest.mock('firebase-admin', () => {
    const state = { db: null }
    return { __state: state, firestore: () => state.db }
})
jest.mock('./assistantStatusHelper', () => ({ createInitialStatusMessage: jest.fn(async () => {}) }))

const admin = require('firebase-admin')
const { createFirestoreDouble } = require('./__securityFirestoreDouble')
const {
    executeWebhookForUserMessage,
    hashCallbackSecret,
    resolveWebhookRecipients,
    WEBHOOK_TASK_KIND,
} = require('./webhookForMessage')
const { processWebhookCallback, isAuthenticCallback } = require('./webhookCallbackHandler')

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]

function seed(taskOverrides = {}) {
    return createFirestoreDouble({
        'projects/p1': { userIds: ['caller', 'member', 'excluded'] },
        'items/p1/tasks/t1': {
            assistantId: 'task-assistant',
            isPublicFor: ['caller', 'member'],
            taskMetadata: {
                isWebhookTask: true,
                webhookUrl: 'https://hooks.example.com/run',
                webhookAuth: 'Bearer stored-secret',
                webhookParams: { mode: 'video' },
            },
            ...taskOverrides,
        },
    })
}

function okFetch() {
    return jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: 'accepted' }) }))
}

describe('executeWebhookForUserMessage', () => {
    test('uses the stored task for URL, credentials, assistant and audience', async () => {
        const db = seed()
        const fetchImpl = okFetch()
        const result = await executeWebhookForUserMessage(
            {
                userId: 'caller',
                projectId: 'p1',
                objectId: 't1',
                prompt: 'hi',
                userIdsToNotify: ['member', 'excluded', 'outsider'],
                // Ignored: these used to be trusted from the request.
                taskMetadata: { webhookUrl: 'http://169.254.169.254/latest', isWebhookTask: true },
                assistantId: 'attacker-assistant',
                isPublicFor: [0],
            },
            { db, fetchImpl, lookup: publicLookup, createStatus: jest.fn(async () => {}) }
        )

        const [url, init] = fetchImpl.mock.calls[0]
        expect(url).toBe('https://hooks.example.com/run')
        expect(init.redirect).toBe('error')
        expect(init.headers.Authorization).toBe('Bearer stored-secret')
        const payload = JSON.parse(init.body)
        expect(payload.mode).toBe('video')
        expect(payload.callbackUrl).toMatch(/\?token=[0-9a-f]{64}$/)
        expect(payload.callbackSecret).toBe(payload.callbackUrl.split('token=')[1])

        const pending = [...db.store.entries()].find(([path]) => path.startsWith('pendingWebhooks/'))[1]
        expect(pending.kind).toBe(WEBHOOK_TASK_KIND)
        expect(pending.callbackSecretHash).toBe(hashCallbackSecret(payload.callbackSecret))
        expect(pending.assistantId).toBe('task-assistant')
        expect(pending.userIdsToNotify).toEqual(['member'])
        expect(JSON.stringify(pending)).not.toContain(payload.callbackSecret)

        expect(result.correlationId).toBeUndefined()
        expect(result.assistantId).toBe('task-assistant')
    })

    test('refuses a task that is not a webhook task', async () => {
        const db = seed({ taskMetadata: { isWebhookTask: false } })
        await expect(
            executeWebhookForUserMessage(
                { userId: 'caller', projectId: 'p1', objectId: 't1' },
                { db, fetchImpl: okFetch(), lookup: publicLookup }
            )
        ).rejects.toThrow('not a webhook task')
    })

    test.each([
        ['metadata address', 'http://169.254.169.254/computeMetadata/v1', publicLookup],
        ['loopback', 'http://localhost:8080/', publicLookup],
        ['host resolving to a private address', 'https://internal.example.com/', async () => [{ address: '10.0.0.5' }]],
        ['non-http scheme', 'file:///etc/passwd', publicLookup],
    ])('refuses a %s before posting anything', async (_, webhookUrl, lookup) => {
        const db = seed({ taskMetadata: { isWebhookTask: true, webhookUrl } })
        const fetchImpl = okFetch()
        const createStatus = jest.fn(async () => {})
        await expect(
            executeWebhookForUserMessage(
                { userId: 'caller', projectId: 'p1', objectId: 't1' },
                { db, fetchImpl, lookup, createStatus }
            )
        ).rejects.toThrow('Webhook URL refused')
        expect(fetchImpl).not.toHaveBeenCalled()
        expect(createStatus).not.toHaveBeenCalled()
    })

    test('recipients are narrowed to members the task is visible to', () => {
        expect(
            resolveWebhookRecipients(['a', 'b', 'c', 'caller', 5], {
                memberIds: ['a', 'b', 'caller'],
                isPublicFor: ['a', 'caller'],
                callerId: 'caller',
            })
        ).toEqual(['a'])
        expect(
            resolveWebhookRecipients(['a', 'b', 'c'], { memberIds: ['a', 'b'], isPublicFor: [0], callerId: 'x' })
        ).toEqual(['a', 'b'])
    })
})

describe('webhook callback', () => {
    const secret = 'f'.repeat(64)
    const webhookRecord = {
        kind: WEBHOOK_TASK_KIND,
        callbackSecretHash: hashCallbackSecret(secret),
        status: 'initiated',
        projectId: 'p1',
        objectId: 't1',
        assistantId: 'task-assistant',
        expiresAt: Date.now() + 60000,
    }

    function makeRes() {
        const res = { statusCode: 0, body: null }
        res.status = code => {
            res.statusCode = code
            return res
        }
        res.json = body => {
            res.body = body
            return res
        }
        return res
    }

    const makeReq = ({ token, body = {} } = {}) => ({
        method: 'POST',
        query: token ? { token } : {},
        get: () => undefined,
        body: { correlationId: 'c1', status: 'success', output: 'done', ...body },
    })

    test.each([
        ['no secret', makeReq(), webhookRecord],
        ['a wrong secret', makeReq({ token: 'a'.repeat(64) }), webhookRecord],
        ['a VM job record', makeReq({ token: secret }), { status: 'running', projectId: 'p1', objectId: 't1' }],
        [
            'a record from before the fix',
            makeReq({ token: secret }),
            { ...webhookRecord, callbackSecretHash: undefined },
        ],
    ])('rejects a callback with %s and writes nothing', async (_, req, record) => {
        const db = createFirestoreDouble({ 'pendingWebhooks/c1': record })
        admin.__state.db = db
        const res = makeRes()
        await processWebhookCallback(req, res)
        expect(res.statusCode).toBe(404)
        expect(db.writes).toEqual([])
    })

    test('accepts the secret from the query, the header or the body', () => {
        expect(isAuthenticCallback({ query: { token: secret }, body: {} }, webhookRecord)).toBe(true)
        expect(isAuthenticCallback({ query: {}, get: () => secret, body: {} }, webhookRecord)).toBe(true)
        expect(isAuthenticCallback({ query: {}, body: { callbackSecret: secret } }, webhookRecord)).toBe(true)
    })
})
