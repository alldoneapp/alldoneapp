const store = {}

function ref(path) {
    return {
        path,
        get: async () => ({ exists: store[path] !== undefined, data: () => store[path] || {} }),
        set: async (data, opts) => {
            store[path] = opts?.merge ? { ...(store[path] || {}), ...data } : { ...data }
        },
        delete: async () => {
            delete store[path]
        },
    }
}

function db(queryDocs = []) {
    const query = {
        where: () => query,
        limit: () => query,
        get: async () => ({ size: queryDocs.length, docs: queryDocs }),
    }
    return {
        doc: ref,
        collection: () => query,
        runTransaction: async fn =>
            fn({
                get: target => target.get(),
                set: (target, data, opts) => target.set(data, opts),
                delete: target => target.delete(),
            }),
    }
}

const {
    createVmInteractionRequest,
    answerVmInteractionRequest,
    expireVmInteractions,
    sanitizeVmInteraction,
} = require('./vmInteraction')

describe('VM interactions', () => {
    beforeEach(() => {
        Object.keys(store).forEach(key => delete store[key])
        store['pendingWebhooks/run-1'] = {
            correlationId: 'run-1',
            kind: 'vm_job',
            userId: 'user-1',
            projectId: 'project-1',
            objectType: 'tasks',
            objectId: 'chat-1',
            assistantId: 'assistant-1',
            statusCommentId: 'comment-1',
            status: 'running',
        }
        store['vmSessions/project-1__chat-1'] = {
            activeLeaseOwner: 'runtime-owner',
            activeCorrelationId: 'run-1',
        }
    })

    test('sanitizes provider questions before exposing them in a chat comment', () => {
        expect(
            sanitizeVmInteraction({
                requestId: 'request-1',
                kind: 'clarification',
                provider: 'claude',
                payload: {
                    questions: [
                        {
                            question: 'Which implementation?',
                            header: 'Approach',
                            options: [{ label: 'Safe', description: 'Use the safe option' }],
                        },
                    ],
                },
                createdAt: 100,
                expiresAt: 200,
            })
        ).toMatchObject({
            kind: 'clarification',
            questions: [{ question: 'Which implementation?', options: [{ label: 'Safe' }] }],
        })
    })

    test('persists a pending request and blocks the reusable thread while no runtime lease is held', async () => {
        const database = db()
        const interaction = await createVmInteractionRequest({
            db: database,
            pendingRef: ref('pendingWebhooks/run-1'),
            sessionRef: ref('vmSessions/project-1__chat-1'),
            correlationId: 'run-1',
            requestId: 'request-1',
            userId: 'user-1',
            provider: 'claude',
            kind: 'plan_review',
            payload: { plan: '1. Inspect\n2. Change\n3. Test' },
            now: 1000,
        })

        expect(interaction).toMatchObject({ requestId: 'request-1', kind: 'plan_review' })
        expect(store['pendingWebhooks/run-1']).toMatchObject({
            status: 'awaiting_user',
            interactionRequestId: 'request-1',
        })
        expect(store['vmSessions/project-1__chat-1']).toMatchObject({
            blockedByCorrelationId: 'run-1',
            blockedReason: 'plan_review',
            activeLeaseOwner: null,
        })
        expect(store['chatNotifications/project-1/user-1/comment-1']).toMatchObject({
            chatId: 'chat-1',
            chatType: 'tasks',
            followed: true,
            creatorId: 'assistant-1',
            creatorType: 'assistant',
            vmRunId: 'run-1',
            vmInteractionRequestId: 'request-1',
            vmInteractionKind: 'plan_review',
        })
    })

    test('creates a red actionable notification when the VM asks a question', async () => {
        const request = {
            db: db(),
            pendingRef: ref('pendingWebhooks/run-1'),
            sessionRef: ref('vmSessions/project-1__chat-1'),
            correlationId: 'run-1',
            requestId: 'request-1',
            userId: 'user-1',
            provider: 'codex',
            kind: 'clarification',
            payload: { questions: [{ question: 'Which implementation?' }] },
            now: 1000,
        }
        await createVmInteractionRequest(request)
        await createVmInteractionRequest(request)

        expect(store['chatNotifications/project-1/user-1/comment-1']).toMatchObject({
            followed: true,
            date: 1000,
            vmInteractionRequestId: 'request-1',
            vmInteractionKind: 'clarification',
        })
        // Retries upsert the notification for the live status comment instead of adding another.
        expect(Object.keys(store).filter(path => path.includes('chatNotifications/'))).toHaveLength(1)
    })

    test('answers exactly once and grants the resume attempt a dispatch lease', async () => {
        const database = db()
        await createVmInteractionRequest({
            db: database,
            pendingRef: ref('pendingWebhooks/run-1'),
            sessionRef: ref('vmSessions/project-1__chat-1'),
            correlationId: 'run-1',
            requestId: 'request-1',
            userId: 'user-1',
            provider: 'codex',
            kind: 'plan_review',
            payload: { plan: 'Do the work safely.' },
            now: 1000,
        })

        await expect(
            answerVmInteractionRequest({
                db: database,
                pendingRef: ref('pendingWebhooks/run-1'),
                sessionRef: ref('vmSessions/project-1__chat-1'),
                correlationId: 'run-1',
                requestId: 'request-1',
                userId: 'user-1',
                response: { action: 'approve' },
                executionAttemptId: 'attempt-2',
                now: 2000,
            })
        ).resolves.toMatchObject({ executionAttemptId: 'attempt-2' })
        expect(store['pendingWebhooks/run-1']).toMatchObject({
            status: 'pending',
            executionAttemptId: 'attempt-2',
            currentInteraction: null,
        })
        expect(store['vmSessions/project-1__chat-1']).toMatchObject({
            blockedByCorrelationId: null,
            activeLeaseOwner: 'dispatch:run-1',
        })
        expect(store['chatNotifications/project-1/user-1/comment-1']).toBeUndefined()

        await expect(
            answerVmInteractionRequest({
                db: database,
                pendingRef: ref('pendingWebhooks/run-1'),
                sessionRef: ref('vmSessions/project-1__chat-1'),
                correlationId: 'run-1',
                requestId: 'request-1',
                userId: 'user-1',
                response: { action: 'approve' },
                now: 3000,
            })
        ).rejects.toMatchObject({ code: 'stale_interaction' })
    })

    test('rejects a response from another user', async () => {
        const database = db()
        await createVmInteractionRequest({
            db: database,
            pendingRef: ref('pendingWebhooks/run-1'),
            sessionRef: ref('vmSessions/project-1__chat-1'),
            correlationId: 'run-1',
            requestId: 'request-1',
            userId: 'user-1',
            provider: 'claude',
            kind: 'clarification',
            payload: { questions: [] },
            now: 1000,
        })
        await expect(
            answerVmInteractionRequest({
                db: database,
                pendingRef: ref('pendingWebhooks/run-1'),
                sessionRef: ref('vmSessions/project-1__chat-1'),
                correlationId: 'run-1',
                requestId: 'request-1',
                userId: 'other-user',
                response: { action: 'submit', answers: {} },
                now: 2000,
            })
        ).rejects.toMatchObject({ code: 'permission_denied' })
    })

    test('routes cancellation through a fresh worker attempt so normal cleanup still runs', async () => {
        const database = db()
        await createVmInteractionRequest({
            db: database,
            pendingRef: ref('pendingWebhooks/run-1'),
            sessionRef: ref('vmSessions/project-1__chat-1'),
            correlationId: 'run-1',
            requestId: 'request-1',
            userId: 'user-1',
            provider: 'claude',
            kind: 'plan_review',
            payload: { plan: 'Plan' },
            now: 1000,
        })

        await expect(
            answerVmInteractionRequest({
                db: database,
                pendingRef: ref('pendingWebhooks/run-1'),
                sessionRef: ref('vmSessions/project-1__chat-1'),
                correlationId: 'run-1',
                requestId: 'request-1',
                userId: 'user-1',
                response: { action: 'cancel' },
                executionAttemptId: 'cancel-attempt',
                now: 2000,
            })
        ).resolves.toMatchObject({ cancelling: true, executionAttemptId: 'cancel-attempt' })
        expect(store['pendingWebhooks/run-1']).toMatchObject({
            status: 'cancel_requested',
            executionAttemptId: 'cancel-attempt',
        })
        expect(store['vmSessions/project-1__chat-1']).toMatchObject({
            blockedByCorrelationId: null,
            activeLeaseOwner: 'dispatch:run-1',
        })
        expect(store['chatNotifications/project-1/user-1/comment-1']).toBeUndefined()
    })

    test('clears a stale red notification when an unanswered interaction expires', async () => {
        const pendingDoc = {
            id: 'run-1',
            ref: ref('pendingWebhooks/run-1'),
            data: () => store['pendingWebhooks/run-1'],
        }
        const database = db([pendingDoc])
        await createVmInteractionRequest({
            db: database,
            pendingRef: pendingDoc.ref,
            sessionRef: ref('vmSessions/project-1__chat-1'),
            correlationId: 'run-1',
            requestId: 'request-1',
            userId: 'user-1',
            provider: 'claude',
            kind: 'plan_review',
            payload: { plan: 'Plan' },
            now: 1000,
            ttlMs: 100,
        })

        expect(store['chatNotifications/project-1/user-1/comment-1']).toMatchObject({ followed: true })
        await expect(expireVmInteractions(database, 1100)).resolves.toMatchObject({ expired: 1, errors: 0 })
        expect(store['pendingWebhooks/run-1']).toMatchObject({
            status: 'failed',
            failureReason: 'interaction_expired',
            currentInteraction: null,
        })
        expect(store['chatNotifications/project-1/user-1/comment-1']).toBeUndefined()
    })
})
