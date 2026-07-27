/**
 * Unit tests for execute_task_in_vm's `continue_in_object_id` resolution — the check that decides
 * whether a VM job may be hosted on an existing thread (and therefore resume its sandbox) instead
 * of a freshly created one.
 */
const {
    resolveVmContinuationThread,
    listContinuableVmThreads,
    formatContinuationCandidates,
} = require('./vmContinuationThread')

const PROJECT_ID = 'project-1'
const OBJECT_ID = 'task-1'
const USER_ID = 'user-1'

// Minimal Firestore double: doc(path).get() resolves from a path -> data map, getAll() batches the
// same lookup, and collection('vmSessions').where('projectId','==',x) filters the session docs.
function makeDb(docs) {
    const snapFor = path =>
        Object.prototype.hasOwnProperty.call(docs, path)
            ? { exists: true, data: () => docs[path] }
            : { exists: false, data: () => undefined }

    const db = {
        doc: path => ({ path, get: async () => snapFor(path) }),
        getAll: async (...refs) => refs.map(ref => snapFor(ref.path)),
        collection: name => ({
            where: (field, op, value) => ({
                get: async () => ({
                    docs: Object.entries(docs)
                        .filter(([path]) => path.startsWith(`${name}/`))
                        .map(([, data]) => data)
                        .filter(data => op === '==' && data?.[field] === value)
                        .map(data => ({ data: () => data })),
                }),
            }),
        }),
    }
    return db
}

const sessionPath = `vmSessions/${PROJECT_ID}__${OBJECT_ID}`
const chatPath = `chatObjects/${PROJECT_ID}/chats/${OBJECT_ID}`

describe('resolveVmContinuationThread', () => {
    it('resolves a thread that has a VM session and is public to all', async () => {
        const db = makeDb({
            [sessionPath]: { objectType: 'tasks', sandboxId: 'sbx-1' },
            [chatPath]: { isPublicFor: [0, 'someone-else'] },
        })

        await expect(
            resolveVmContinuationThread({ db, projectId: PROJECT_ID, objectId: OBJECT_ID, requestUserId: USER_ID })
        ).resolves.toEqual({ ok: true, objectType: 'tasks', objectId: OBJECT_ID })
    })

    it('resolves when the thread is shared with the requesting user specifically', async () => {
        const db = makeDb({
            [sessionPath]: { objectType: 'topics' },
            [chatPath]: { isPublicFor: [USER_ID] },
        })

        await expect(
            resolveVmContinuationThread({ db, projectId: PROJECT_ID, objectId: OBJECT_ID, requestUserId: USER_ID })
        ).resolves.toEqual({ ok: true, objectType: 'topics', objectId: OBJECT_ID })
    })

    it('defaults objectType to tasks when the session doc does not record one', async () => {
        const db = makeDb({
            [sessionPath]: {},
            [chatPath]: { isPublicFor: [0] },
        })

        const result = await resolveVmContinuationThread({
            db,
            projectId: PROJECT_ID,
            objectId: OBJECT_ID,
            requestUserId: USER_ID,
        })
        expect(result).toEqual({ ok: true, objectType: 'tasks', objectId: OBJECT_ID })
    })

    it('trims the supplied object id', async () => {
        const db = makeDb({
            [sessionPath]: { objectType: 'tasks' },
            [chatPath]: { isPublicFor: [0] },
        })

        const result = await resolveVmContinuationThread({
            db,
            projectId: PROJECT_ID,
            objectId: `  ${OBJECT_ID}  `,
            requestUserId: USER_ID,
        })
        expect(result).toEqual({ ok: true, objectType: 'tasks', objectId: OBJECT_ID })
    })

    it('rejects a thread with no VM session — nothing to continue', async () => {
        const db = makeDb({ [chatPath]: { isPublicFor: [0] } })

        const result = await resolveVmContinuationThread({
            db,
            projectId: PROJECT_ID,
            objectId: OBJECT_ID,
            requestUserId: USER_ID,
        })
        expect(result.ok).toBe(false)
        expect(result.message).toMatch(/no VM session to continue/i)
    })

    it('rejects a thread the requesting user cannot see', async () => {
        const db = makeDb({
            [sessionPath]: { objectType: 'tasks' },
            [chatPath]: { isPublicFor: ['another-user'] },
        })

        const result = await resolveVmContinuationThread({
            db,
            projectId: PROJECT_ID,
            objectId: OBJECT_ID,
            requestUserId: USER_ID,
        })
        expect(result.ok).toBe(false)
        expect(result.message).toMatch(/do not have access/i)
    })

    it('rejects when the chat object is gone', async () => {
        const db = makeDb({ [sessionPath]: { objectType: 'tasks' } })

        const result = await resolveVmContinuationThread({
            db,
            projectId: PROJECT_ID,
            objectId: OBJECT_ID,
            requestUserId: USER_ID,
        })
        expect(result.ok).toBe(false)
        expect(result.message).toMatch(/no longer exists/i)
    })

    it('rejects an empty or missing object id without touching Firestore', async () => {
        const db = {
            doc: () => {
                throw new Error('should not read')
            },
        }

        for (const objectId of ['', '   ', undefined, null]) {
            const result = await resolveVmContinuationThread({
                db,
                projectId: PROJECT_ID,
                objectId,
                requestUserId: USER_ID,
            })
            expect(result.ok).toBe(false)
        }
    })

    it('does not let a session in one project authorize the same object id in another', async () => {
        // Session exists for PROJECT_ID only; asking about the same object id in another project
        // must not resolve, because the session key is project-scoped.
        const db = makeDb({
            [sessionPath]: { objectType: 'tasks' },
            [chatPath]: { isPublicFor: [0] },
        })

        const result = await resolveVmContinuationThread({
            db,
            projectId: 'other-project',
            objectId: OBJECT_ID,
            requestUserId: USER_ID,
        })
        expect(result.ok).toBe(false)
    })
})

describe('listContinuableVmThreads', () => {
    function makeProjectDb(entries) {
        const docs = {}
        for (const entry of entries) {
            docs[`vmSessions/${PROJECT_ID}__${entry.objectId}`] = {
                projectId: entry.projectId || PROJECT_ID,
                objectId: entry.objectId,
                objectType: entry.objectType || 'tasks',
                lastUsedAt: entry.lastUsedAt,
                lastRunAt: entry.lastRunAt || entry.lastUsedAt,
                lastRunStatus: entry.lastRunStatus || 'completed',
                lastObjective: entry.lastObjective || '',
                ...(entry.activeCorrelationId ? { activeCorrelationId: entry.activeCorrelationId } : {}),
            }
            if (entry.chat !== null) {
                docs[`chatObjects/${PROJECT_ID}/chats/${entry.objectId}`] = entry.chat || {
                    title: entry.title || '',
                    isPublicFor: [0],
                }
            }
        }
        return makeDb(docs)
    }

    it('returns visible sessions most recently used first', async () => {
        const db = makeProjectDb([
            { objectId: 'older', lastUsedAt: 100, title: 'Older work' },
            { objectId: 'newer', lastUsedAt: 900, title: 'Newer work' },
            { objectId: 'middle', lastUsedAt: 500, title: 'Middle work' },
        ])

        const threads = await listContinuableVmThreads({ db, projectId: PROJECT_ID, requestUserId: USER_ID })
        expect(threads.map(t => t.objectId)).toEqual(['newer', 'middle', 'older'])
        expect(threads[0].title).toBe('Newer work')
    })

    it('excludes sessions from other projects', async () => {
        const db = makeProjectDb([
            { objectId: 'mine', lastUsedAt: 100, title: 'Mine' },
            { objectId: 'theirs', lastUsedAt: 900, title: 'Theirs', projectId: 'other-project' },
        ])

        const threads = await listContinuableVmThreads({ db, projectId: PROJECT_ID, requestUserId: USER_ID })
        expect(threads.map(t => t.objectId)).toEqual(['mine'])
    })

    it('excludes threads the user cannot see and threads whose chat is gone', async () => {
        const db = makeProjectDb([
            { objectId: 'visible', lastUsedAt: 300, title: 'Visible' },
            { objectId: 'private', lastUsedAt: 200, chat: { title: 'Private', isPublicFor: ['someone-else'] } },
            { objectId: 'orphaned', lastUsedAt: 100, chat: null },
        ])

        const threads = await listContinuableVmThreads({ db, projectId: PROJECT_ID, requestUserId: USER_ID })
        expect(threads.map(t => t.objectId)).toEqual(['visible'])
    })

    it('surfaces the stored objective and running state', async () => {
        const db = makeProjectDb([
            {
                objectId: 'busy',
                lastUsedAt: 300,
                title: 'Login refactor',
                lastObjective: 'Refactor the login flow',
                activeCorrelationId: 'corr-1',
            },
        ])

        const [thread] = await listContinuableVmThreads({ db, projectId: PROJECT_ID, requestUserId: USER_ID })
        expect(thread.lastObjective).toBe('Refactor the login flow')
        expect(thread.isRunning).toBe(true)
        expect(thread.lastRunStatus).toBe('completed')
    })

    it('honours the limit', async () => {
        const db = makeProjectDb([
            { objectId: 'a', lastUsedAt: 300 },
            { objectId: 'b', lastUsedAt: 200 },
            { objectId: 'c', lastUsedAt: 100 },
        ])

        const threads = await listContinuableVmThreads({ db, projectId: PROJECT_ID, requestUserId: USER_ID, limit: 2 })
        expect(threads).toHaveLength(2)
    })

    it('returns an empty list without a project or when nothing ran', async () => {
        expect(await listContinuableVmThreads({ db: makeDb({}), projectId: '', requestUserId: USER_ID })).toEqual([])
        expect(
            await listContinuableVmThreads({ db: makeDb({}), projectId: PROJECT_ID, requestUserId: USER_ID })
        ).toEqual([])
    })

    it('fails soft when the query throws rather than breaking dispatch', async () => {
        const db = {
            collection: () => ({
                where: () => ({
                    get: async () => {
                        throw new Error('index missing')
                    },
                }),
            }),
        }
        await expect(listContinuableVmThreads({ db, projectId: PROJECT_ID, requestUserId: USER_ID })).resolves.toEqual(
            []
        )
    })
})

describe('resolveVmContinuationThread with the "latest" sentinel', () => {
    function makeSessionsDb(entries) {
        const docs = {}
        for (const entry of entries) {
            docs[`vmSessions/${PROJECT_ID}__${entry.objectId}`] = {
                projectId: PROJECT_ID,
                objectId: entry.objectId,
                objectType: entry.objectType || 'tasks',
                lastUsedAt: entry.lastUsedAt,
            }
            docs[`chatObjects/${PROJECT_ID}/chats/${entry.objectId}`] = { title: entry.objectId, isPublicFor: [0] }
        }
        return makeDb(docs)
    }

    it('resolves to the most recently used thread', async () => {
        const db = makeSessionsDb([
            { objectId: 'old', lastUsedAt: 100 },
            { objectId: 'recent', lastUsedAt: 900, objectType: 'topics' },
        ])

        await expect(
            resolveVmContinuationThread({ db, projectId: PROJECT_ID, objectId: 'latest', requestUserId: USER_ID })
        ).resolves.toEqual({ ok: true, objectType: 'topics', objectId: 'recent' })
    })

    it('is case-insensitive and tolerates whitespace', async () => {
        const db = makeSessionsDb([{ objectId: 'recent', lastUsedAt: 900 }])

        await expect(
            resolveVmContinuationThread({ db, projectId: PROJECT_ID, objectId: '  LATEST ', requestUserId: USER_ID })
        ).resolves.toEqual({ ok: true, objectType: 'tasks', objectId: 'recent' })
    })

    it('skips a most-recent thread the user cannot see', async () => {
        const db = makeDb({
            [`vmSessions/${PROJECT_ID}__hidden`]: { projectId: PROJECT_ID, objectId: 'hidden', lastUsedAt: 900 },
            [`chatObjects/${PROJECT_ID}/chats/hidden`]: { title: 'Hidden', isPublicFor: ['other'] },
            [`vmSessions/${PROJECT_ID}__mine`]: { projectId: PROJECT_ID, objectId: 'mine', lastUsedAt: 100 },
            [`chatObjects/${PROJECT_ID}/chats/mine`]: { title: 'Mine', isPublicFor: [USER_ID] },
        })

        await expect(
            resolveVmContinuationThread({ db, projectId: PROJECT_ID, objectId: 'latest', requestUserId: USER_ID })
        ).resolves.toEqual({ ok: true, objectType: 'tasks', objectId: 'mine' })
    })

    it('explains when there is nothing to continue', async () => {
        const result = await resolveVmContinuationThread({
            db: makeDb({}),
            projectId: PROJECT_ID,
            objectId: 'latest',
            requestUserId: USER_ID,
        })
        expect(result.ok).toBe(false)
        expect(result.message).toMatch(/no earlier VM run/i)
    })
})

describe('candidate listing on a failed resolution', () => {
    it('lists continuable threads when the supplied id has no session', async () => {
        const db = makeDb({
            [`vmSessions/${PROJECT_ID}__real`]: {
                projectId: PROJECT_ID,
                objectId: 'real',
                lastUsedAt: 500,
                lastObjective: 'Refactor the login flow',
            },
            [`chatObjects/${PROJECT_ID}/chats/real`]: { title: 'Login refactor', isPublicFor: [0] },
        })

        const result = await resolveVmContinuationThread({
            db,
            projectId: PROJECT_ID,
            objectId: 'made-up-id',
            requestUserId: USER_ID,
        })
        expect(result.ok).toBe(false)
        expect(result.message).toMatch(/no VM session to continue/i)
        expect(result.message).toContain('real')
        expect(result.message).toContain('Login refactor')
    })

    it('omits the candidate block when there is nothing to suggest', async () => {
        const result = await resolveVmContinuationThread({
            db: makeDb({}),
            projectId: PROJECT_ID,
            objectId: 'made-up-id',
            requestUserId: USER_ID,
        })
        expect(result.ok).toBe(false)
        expect(result.message).not.toMatch(/Threads in this project/i)
    })
})

describe('formatContinuationCandidates', () => {
    it('returns an empty string for no candidates', () => {
        expect(formatContinuationCandidates([])).toBe('')
    })

    it('renders id, label, objective and running state', () => {
        const text = formatContinuationCandidates([
            { objectId: 't1', title: 'Login refactor', lastObjective: 'Refactor the login flow', isRunning: true },
            { objectId: 't2', title: '', lastObjective: 'Build the pricing page', isRunning: false },
        ])
        expect(text).toContain('- t1: Login refactor — Refactor the login flow (currently running)')
        expect(text).toContain('- t2: Build the pricing page')
        expect(text).not.toContain('t2: Build the pricing page — Build the pricing page')
    })

    it('falls back to the id when there is no title or objective', () => {
        expect(formatContinuationCandidates([{ objectId: 't3', title: '', lastObjective: '' }])).toContain('- t3: t3')
    })
})
