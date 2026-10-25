'use strict'

const { FirestoreDouble } = require('./__browserFirestoreDouble')
const { createRunBudget } = require('./browserLimits')
const { executeBrowserTakeover, finishBrowserTakeover, sanitizeTakeoverInput } = require('./browserTakeover')

const NOW = 1_800_000_000_000
const ENV = {
    BROWSER_WORKER_URL: 'https://browser-worker.example',
    BROWSER_WORKER_SIGNING_SECRET: 'browser-worker-signing-secret',
    BROWSER_ALLOWED_DOMAINS: 'tickets.example',
}

function fixtureDb() {
    return new FirestoreDouble({
        'browserSessions/p1__task1': { sessionKey: 'p1__task1', runId: 'run1', projectId: 'p1', objectId: 'task1' },
        'browserRuns/run1': {
            runId: 'run1',
            sessionKey: 'p1__task1',
            projectId: 'p1',
            objectId: 'task1',
            objectType: 'tasks',
            assistantId: 'assistant1',
            requestUserId: 'user1',
            status: 'active',
            startedAt: NOW,
            lastActivityAt: NOW,
            stepCount: 1,
            budget: createRunBudget(NOW),
            workerSessionId: 'session1',
            pendingApprovals: { login_signature: 'approval1' },
            lastPageUrl: 'https://tickets.example/login',
        },
        'browserApprovals/approval1': {
            approvalId: 'approval1',
            runId: 'run1',
            projectId: 'p1',
            objectId: 'task1',
            objectType: 'tasks',
            assistantId: 'assistant1',
            requestUserId: 'user1',
            category: 'login',
            signature: 'login_signature',
            status: 'pending',
            expiresAt: NOW + 60000,
        },
    })
}

function workerDouble() {
    const calls = []
    const fetchImpl = async (url, options) => {
        calls.push({ url, options, body: JSON.parse(options.body) })
        return {
            ok: true,
            status: 200,
            headers: { get: name => (name === 'set-cookie' ? 'GOOG-RUN-AFFINITY=route1; Path=/' : '') },
            json: async () => ({
                ok: true,
                url: 'https://tickets.example/login',
                title: 'Sign in',
                screenshotBase64: Buffer.from('jpeg').toString('base64'),
                viewport: { width: 1280, height: 900 },
                focused: { tagName: 'input', inputType: 'password', name: 'Password' },
                usage: { networkRequests: 1, responseBytes: 2000 },
            }),
        }
    }
    return { calls, fetchImpl }
}

describe('browser session-only takeover', () => {
    it('bills and audits every human interaction while returning an ephemeral viewport', async () => {
        const db = fixtureDb()
        const worker = workerDouble()
        const charges = []
        const deductGold = async (userId, amount, context) => {
            charges.push({ userId, amount, context })
            return { success: true, amount, newBalance: 10 }
        }

        const result = await executeBrowserTakeover({
            db,
            env: ENV,
            approvalId: 'approval1',
            userId: 'user1',
            action: 'snapshot',
            fetchImpl: worker.fetchImpl,
            identityTokenProvider: async () => 'cloud-run-token',
            deductGold,
            now: NOW,
        })

        expect(result).toMatchObject({ success: true, action: 'snapshot', goldCost: 1 })
        expect(result.screenshotDataUrl).toMatch(/^data:image\/jpeg;base64,/)
        expect(worker.calls[0].url).toBe('https://browser-worker.example/v1/takeover')
        expect(worker.calls[0].body.action).toBe('snapshot')
        expect(charges).toHaveLength(1)
        expect(charges[0].context.source).toBe('browser_automation')
        expect(db.documents.get('browserApprovals/approval1').status).toBe('in_progress')
        expect(db.documents.get('browserRuns/run1').affinityCookie).toBe('GOOG-RUN-AFFINITY=route1')
    })

    it('never persists text typed by the user', async () => {
        const db = fixtureDb()
        const worker = workerDouble()
        const secret = 'correct horse battery staple'

        await executeBrowserTakeover({
            db,
            env: ENV,
            approvalId: 'approval1',
            userId: 'user1',
            action: 'type',
            input: { text: secret },
            fetchImpl: worker.fetchImpl,
            identityTokenProvider: async () => 'cloud-run-token',
            deductGold: async () => ({ success: true }),
            now: NOW,
        })

        expect(worker.calls[0].body.text).toBe(secret)
        expect(JSON.stringify([...db.documents.entries()])).not.toContain(secret)
        const step = db.listSubcollection('browserRuns').find(entry => entry.action === 'takeover_type')
        expect(step.args).toEqual({ textLength: secret.length })
        expect(step.typedValue).toEqual({ length: secret.length })
    })

    it('finishes without exporting cookies and clears the pending login request', async () => {
        const db = fixtureDb()
        const result = await finishBrowserTakeover(db, {
            approvalId: 'approval1',
            userId: 'user1',
            now: NOW + 1000,
        })

        expect(result.status).toBe('completed')
        expect(db.documents.get('browserApprovals/approval1').status).toBe('completed_by_user')
        expect(db.documents.get('browserRuns/run1').pendingApprovals).toEqual({})
        expect(db.documents.get('browserRuns/run1').storageState).toBeUndefined()
    })

    it('redacts typed input from audit arguments before any I/O', () => {
        expect(sanitizeTakeoverInput('type', { text: 'hunter2' })).toEqual({
            payload: { action: 'type', text: 'hunter2' },
            auditArgs: { textLength: 7 },
        })
    })
})
