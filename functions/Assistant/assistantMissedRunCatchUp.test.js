jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))
jest.mock('firebase-admin/functions', () => ({ getFunctions: jest.fn() }))

const fs = require('fs')
const path = require('path')
const { getObjectDocPath } = require('../shared/privacyAccess')
const {
    acquireAssistantRunLock,
    buildAssistantRunLockId,
    AssistantRunCancelledError,
} = require('./assistantRunIdempotency')
const {
    MISSED_RUN_GRACE_SECONDS,
    isMissedRunCandidate,
    enqueueMissedAssistantRunCheck,
    runMissedAssistantRun,
} = require('./assistantMissedRunCatchUp')

const NOW = 1792956600000
const now = () => NOW
const params = { projectId: 'project', objectType: 'topics', objectId: 'chat', commentId: 'message' }
const request = { projectId: 'project', objectType: 'topics', objectId: 'chat', assistantId: 'anna' }
const comment = {
    commentText: 'LinkedIn content idea',
    creatorId: 'human',
    fromAssistant: false,
    created: NOW - 95 * 1000,
    assistantRunRequest: request,
}
const object = { isAssistantEnabled: true, assistantId: 'thread-assistant', isPublicFor: [0, 'human'] }
const commentsPath = p => `chatComments/${p.projectId}/${p.objectType}/${p.objectId}/comments`
const lockPath = p =>
    `assistantRunLocks/${buildAssistantRunLockId({ ...p, messageId: p.commentId || params.commentId })}`

// A Firestore stand-in that serializes transactions, as Firestore does when two workers claim one
// message, and answers the "newest comment of the thread" query the worker asks.
function createDb(p = params, objectData = object, commentData = comment) {
    const docs = new Map([
        [getObjectDocPath(p.projectId, p.objectType, p.objectId), { ...objectData }],
        [`${commentsPath(p)}/${p.commentId}`, { ...commentData }],
        ['projects/project', { userIds: ['human', 'follower'] }],
        ['users/human', { language: 'de' }],
        [`followers/project/${p.objectType}/${p.objectId}`, { usersFollowing: ['follower', 'removed-user'] }],
    ])
    const reads = []
    let tail = Promise.resolve()
    const snapshot = refPath => ({ exists: docs.has(refPath), data: () => docs.get(refPath) })
    const write = (ref, data, options) => docs.set(ref.path, options?.merge ? { ...docs.get(ref.path), ...data } : data)
    const doc = refPath => ({
        path: refPath,
        firestore: db,
        get: async () => {
            reads.push(refPath)
            return snapshot(refPath)
        },
        set: async (data, options) => write({ path: refPath }, data, options),
        update: async data => {
            if (!docs.has(refPath)) throw Object.assign(new Error(`No document to update: ${refPath}`), { code: 5 })
            docs.set(refPath, { ...docs.get(refPath), ...data })
        },
    })
    const db = {
        docs,
        reads,
        doc,
        collection: collectionPath => ({
            doc: id => doc(`${collectionPath}/${id}`),
            orderBy: (field, direction) => ({
                limit: count => ({
                    get: async () => {
                        reads.push(`${collectionPath}?newest`)
                        const prefix = `${collectionPath}/`
                        const children = [...docs.entries()]
                            .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
                            .map(([key, data]) => ({ id: key.slice(prefix.length), data: () => data }))
                            .filter(child => child.data()[field] !== undefined)
                            .sort((a, b) =>
                                direction === 'desc'
                                    ? b.data()[field] - a.data()[field]
                                    : a.data()[field] - b.data()[field]
                            )
                        return { docs: children.slice(0, count) }
                    },
                }),
            }),
        }),
        runTransaction: callback => {
            const result = tail.then(() =>
                callback({ get: async ref => snapshot(ref.path), set: write, update: write })
            )
            tail = result.catch(() => {})
            return result
        },
    }
    return db
}

describe('catching up a user message whose assistant run never started', () => {
    describe('the comment trigger', () => {
        test('schedules one delayed check per requested run', async () => {
            const queue = { enqueue: jest.fn().mockResolvedValue() }
            await expect(enqueueMissedAssistantRunCheck(params, comment, { queue, now })).resolves.toEqual({
                enqueued: true,
            })
            expect(queue.enqueue).toHaveBeenCalledWith(
                { kind: 'missed_user_run', ...params },
                {
                    id: expect.stringMatching(/^missed-run-[a-f0-9]{64}$/),
                    scheduleDelaySeconds: MISSED_RUN_GRACE_SECONDS,
                    dispatchDeadlineSeconds: 1800,
                }
            )
            // Long enough for a cold-starting callable to take its lock first.
            expect(MISSED_RUN_GRACE_SECONDS).toBeGreaterThanOrEqual(60)
        })

        test.each([
            ['an assistant comment', { fromAssistant: true }],
            ['a comment whose client did not start a run', { assistantRunRequest: undefined }],
            [
                'a request copied with its thread into another project',
                { assistantRunRequest: { ...request, projectId: 'other' } },
            ],
            ['a request copied onto another object', { assistantRunRequest: { ...request, objectId: 'other-chat' } }],
            ['an empty comment', { commentText: '   ' }],
            ['a comment without an author', { creatorId: '' }],
            ['a day-old comment from a redelivered event', { created: NOW - 25 * 60 * 60 * 1000 }],
        ])('ignores %s', async (_, change) => {
            const queue = { enqueue: jest.fn() }
            const changed = { ...comment, ...change }
            expect(await enqueueMissedAssistantRunCheck(params, changed, { queue, now })).toEqual({ skipped: true })
            expect(queue.enqueue).not.toHaveBeenCalled()
        })

        test('treats a redelivered event as a duplicate and surfaces real queue failures', async () => {
            const queue = { enqueue: jest.fn().mockRejectedValueOnce({ code: 6 }) }
            expect(await enqueueMissedAssistantRunCheck(params, comment, { queue, now })).toEqual({ duplicate: true })
            queue.enqueue.mockRejectedValueOnce(new Error('queue unavailable'))
            await expect(enqueueMissedAssistantRunCheck(params, comment, { queue, now })).rejects.toThrow(
                'queue unavailable'
            )
        })

        test('starts a request only the server runs (MCP ask_assistant) at once, without the grace period', async () => {
            const queue = { enqueue: jest.fn().mockResolvedValue() }
            const serverStarted = { ...comment, assistantRunRequest: { ...request, startOnServer: true } }
            await enqueueMissedAssistantRunCheck(params, serverStarted, { queue, now })
            // Same task id as the client-request check, so the trigger and the tool start it once.
            const [, options] = queue.enqueue.mock.calls[0]
            expect(options.scheduleDelaySeconds).toBe(0)
            await enqueueMissedAssistantRunCheck(params, comment, { queue, now })
            expect(queue.enqueue.mock.calls[1][1].id).toBe(options.id)
        })

        test('rejects unsupported object types', () => {
            expect(isMissedRunCandidate(comment, { ...params, objectType: 'unknown' })).toBe(false)
        })
    })

    describe('the delayed check', () => {
        test.each(['running', 'completed', 'failed', 'cancelled'])(
            'stops after one read when the client run started (%s)',
            async status => {
                const db = createDb()
                db.docs.set(lockPath(params), { status })
                const askToBot = jest.fn()
                expect(await runMissedAssistantRun(params, { db, askToBot, now })).toEqual({ alreadyStarted: true })
                expect(askToBot).not.toHaveBeenCalled()
                expect(db.reads).toEqual([lockPath(params)])
            }
        )

        test('starts the run the client never sent, for its author and with the assistant it chose', async () => {
            const db = createDb()
            const askToBot = jest.fn()
            expect(await runMissedAssistantRun(params, { db, askToBot, now })).toEqual({ caughtUp: true })
            expect(askToBot).toHaveBeenCalledTimes(1)
            expect(askToBot).toHaveBeenCalledWith(
                'human',
                'message',
                'project',
                'topics',
                'chat',
                ['follower', 'human'],
                [0, 'human'],
                'de',
                'anna',
                ['follower'],
                expect.any(Number),
                buildAssistantRunLockId({ ...params, messageId: 'message' }),
                { maxRunWallClockMs: 25 * 60 * 1000 }
            )
            expect(db.docs.get(lockPath(params)).status).toBe('completed')
        })

        test('a client request that arrives afterwards meets the lock and is skipped', async () => {
            const db = createDb()
            await runMissedAssistantRun(params, { db, askToBot: jest.fn(), now })
            // What askToBotSecondGen does first.
            const lateClient = await acquireAssistantRunLock(db, { ...params, messageId: 'message' })
            expect(lateClient).toMatchObject({ acquired: false, reason: 'already_completed' })
        })

        test('a client run that starts and fails while the check is reading is not repeated', async () => {
            const db = createDb()
            const collection = db.collection
            db.collection = collectionPath => {
                const ref = collection(collectionPath)
                const orderBy = ref.orderBy
                ref.orderBy = (...args) => {
                    const query = orderBy(...args)
                    const limit = query.limit
                    query.limit = count => ({
                        get: async () => {
                            db.docs.set(lockPath(params), { status: 'failed' })
                            return limit(count).get()
                        },
                    })
                    return query
                }
                return ref
            }
            const askToBot = jest.fn()
            expect(await runMissedAssistantRun(params, { db, askToBot, now })).toEqual({ alreadyStarted: true })
            expect(askToBot).not.toHaveBeenCalled()
        })

        test('two deliveries of the check run the prompt once', async () => {
            const db = createDb()
            const askToBot = jest.fn()
            const results = await Promise.all([
                runMissedAssistantRun(params, { db, askToBot, now }),
                runMissedAssistantRun(params, { db, askToBot, now }),
            ])
            expect(results).toContainEqual({ caughtUp: true })
            expect(results).toContainEqual({ alreadyStarted: true })
            expect(askToBot).toHaveBeenCalledTimes(1)
        })

        test("falls back to the thread's assistant for a request that named none", async () => {
            const db = createDb(params, object, { ...comment, assistantRunRequest: { ...request, assistantId: null } })
            const askToBot = jest.fn()
            await runMissedAssistantRun(params, { db, askToBot, now })
            expect(askToBot.mock.calls[0][8]).toBe('thread-assistant')
        })

        test.each([
            [
                'a later message in the thread',
                db => db.docs.set(`${commentsPath(params)}/later`, { created: NOW - 1000 }),
            ],
            [
                'the assistant switched off meanwhile',
                db =>
                    db.docs.set(getObjectDocPath('project', 'topics', 'chat'), {
                        ...object,
                        isAssistantEnabled: false,
                    }),
            ],
            ['a deleted comment', db => db.docs.delete(`${commentsPath(params)}/message`)],
            ['a deleted thread', db => db.docs.delete(getObjectDocPath('project', 'topics', 'chat'))],
            ['an author who left the project', db => db.docs.set('projects/project', { userIds: ['follower'] })],
            [
                'an author who can no longer read the thread',
                db =>
                    db.docs.set(getObjectDocPath('project', 'topics', 'chat'), {
                        ...object,
                        isPublicFor: ['follower'],
                    }),
            ],
            [
                'no assistant at all',
                db => {
                    db.docs.set(`${commentsPath(params)}/message`, {
                        ...comment,
                        assistantRunRequest: { ...request, assistantId: null },
                    })
                    db.docs.set(getObjectDocPath('project', 'topics', 'chat'), { ...object, assistantId: '' })
                },
            ],
        ])('does not answer when there is %s, and says why on the question', async (_, change) => {
            const db = createDb()
            change(db)
            const askToBot = jest.fn()
            const result = await runMissedAssistantRun(params, { db, askToBot, now })
            expect(result).toHaveProperty('skipped')
            expect(askToBot).not.toHaveBeenCalled()
            expect(db.docs.has(lockPath(params))).toBe(false)
            // The task runs once: whoever waits for the answer (MCP ask_assistant) reads this.
            const question = db.docs.get(`${commentsPath(params)}/message`)
            if (question) expect(question.assistantRunSkipped).toEqual({ reason: result.skipped, at: NOW })
        })

        test('never recreates a deleted question to say why', async () => {
            const db = createDb()
            db.docs.delete(`${commentsPath(params)}/message`)
            expect(await runMissedAssistantRun(params, { db, askToBot: jest.fn(), now })).toEqual({
                skipped: 'missing',
            })
            expect(db.docs.has(`${commentsPath(params)}/message`)).toBe(false)
        })

        test('a check that fails before taking the lock says so on the question', async () => {
            const db = createDb()
            const doc = db.doc
            db.doc = refPath => {
                const ref = doc(refPath)
                if (refPath === 'users/human') ref.get = async () => Promise.reject(new Error('deadline exceeded'))
                return ref
            }
            await expect(runMissedAssistantRun(params, { db, askToBot: jest.fn(), now })).rejects.toThrow(
                'deadline exceeded'
            )
            expect(db.docs.get(`${commentsPath(params)}/message`).assistantRunSkipped).toEqual({
                reason: 'error',
                at: NOW,
                detail: 'deadline exceeded',
            })
            expect(db.docs.has(lockPath(params))).toBe(false)
        })

        describe('a later automatic assistant comment (goal routing, VM status) in the thread', () => {
            const addAutomaticComment = db =>
                db.docs.set(`${commentsPath(params)}/goal-routing`, {
                    created: NOW - 1000,
                    fromAssistant: true,
                    creatorId: 'routing-assistant',
                })

            test('does not swallow a request only the server runs', async () => {
                const db = createDb(params, object, {
                    ...comment,
                    assistantRunRequest: { ...request, startOnServer: true },
                })
                addAutomaticComment(db)
                const askToBot = jest.fn()
                expect(await runMissedAssistantRun(params, { db, askToBot, now })).toEqual({ caughtUp: true })
                expect(askToBot).toHaveBeenCalledTimes(1)
            })

            test('still ends a client request, whose run may have answered without a lock', async () => {
                const db = createDb()
                addAutomaticComment(db)
                const askToBot = jest.fn()
                expect(await runMissedAssistantRun(params, { db, askToBot, now })).toEqual({ skipped: 'superseded' })
                expect(askToBot).not.toHaveBeenCalled()
            })

            test('a later user message behind it still supersedes a server request', async () => {
                const db = createDb(params, object, {
                    ...comment,
                    assistantRunRequest: { ...request, startOnServer: true },
                })
                db.docs.set(`${commentsPath(params)}/user-later`, { created: NOW - 2000, creatorId: 'follower' })
                addAutomaticComment(db)
                const askToBot = jest.fn()
                expect(await runMissedAssistantRun(params, { db, askToBot, now })).toEqual({ skipped: 'superseded' })
                expect(askToBot).not.toHaveBeenCalled()
            })
        })

        test('leaves webhook tasks to their own flow', async () => {
            const p = { ...params, objectType: 'tasks', objectId: 'task' }
            const taskRequest = { projectId: 'project', objectType: 'tasks', objectId: 'task', assistantId: 'anna' }
            const db = createDb(
                p,
                { ...object, taskMetadata: { isWebhookTask: true } },
                { ...comment, assistantRunRequest: taskRequest }
            )
            const askToBot = jest.fn()
            expect(await runMissedAssistantRun(p, { db, askToBot, now })).toEqual({ skipped: 'assistant_disabled' })
            expect(askToBot).not.toHaveBeenCalled()
        })

        test.each(['failed', 'cancelled'])('settles a %s run and never repeats it', async status => {
            const db = createDb()
            const error = status === 'cancelled' ? new AssistantRunCancelledError() : new Error('provider unavailable')
            const askToBot = jest.fn().mockRejectedValue(error)
            const run = runMissedAssistantRun(params, { db, askToBot, now })
            if (status === 'failed') await expect(run).rejects.toThrow('provider unavailable')
            else expect(await run).toEqual({ cancelled: true })
            expect(db.docs.get(lockPath(params)).status).toBe(status)
            expect(await runMissedAssistantRun(params, { db, askToBot, now })).toEqual({ alreadyStarted: true })
            expect(askToBot).toHaveBeenCalledTimes(1)
        })
    })

    // index.js cannot be require()d here (it registers every function), so the wiring is read as source,
    // as assistantRunIdempotencyHosts.test.js does. Without either half the feature silently does nothing.
    describe('wiring in index.js', () => {
        const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
        const registration = name => {
            const start = source.indexOf(`exports.${name} = `)
            const next = source.indexOf('\nexports.', start + 1)
            return start === -1 ? '' : source.slice(start, next === -1 ? source.length : next)
        }

        test('the comment trigger schedules the check', () => {
            expect(registration('onCreateObjectCommentSecondGen')).toContain('enqueueMissedAssistantRunCheck(')
        })

        test('the comment reply worker runs it', () => {
            const worker = registration('runAssistantCommentReply')
            expect(worker).toContain('isMissedAssistantRunTask(req.data)')
            expect(worker).toContain('runMissedAssistantRun(req.data)')
        })
    })
})
