'use strict'

// AT-3165 follow-up: a star set in Gmail creates an email task. Gmail is a simulated mailbox here
// (history records, historyId, labels): no real mailbox is touched. The real gmailTaskStar registry
// logic runs in the loop (creation star, Done/reopen trigger), so Alldone's own stars and the
// user's stars meet the import exactly as they would in production.

jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))

const { importStarredGmailMessages, MAX_CURSOR_GAP_MS, starCameAfterDone } = require('./gmailStarTaskImport')
const { starEmailOfCreatedTask, syncTaskEmailStarOnTaskUpdate } = require('./gmailTaskStar')

const OWNER = 'owner-1'
const KEY = 'email_google_owner'
const EMAIL = 'owner@gmail.com'
const PROJECT = 'p1'

function createFakeDatabase(initial = {}) {
    const docs = new Map(Object.entries(initial))
    const docRef = path => ({
        path,
        id: path.split('/').pop(),
        get: async () => {
            const data = docs.get(path)
            return { exists: data !== undefined, id: path.split('/').pop(), data: () => data }
        },
        set: async (value, options) => {
            const previous = docs.get(path) || {}
            docs.set(path, options?.merge ? { ...previous, ...value } : value)
        },
        collection: name => collectionRef(`${path}/${name}`),
    })
    const collectionRef = path => ({
        doc: id => docRef(`${path}/${id}`),
        where: (field, op, value) => ({
            get: async () => {
                const matches = [...docs.entries()].filter(([docPath, data]) => {
                    const rest = docPath.slice(path.length + 1)
                    return docPath.startsWith(`${path}/`) && !rest.includes('/') && data?.[field] === value
                })
                const snapshotDocs = matches.map(([docPath, data]) => ({
                    id: docPath.split('/').pop(),
                    data: () => data,
                }))
                return { docs: snapshotDocs, forEach: callback => snapshotDocs.forEach(callback) }
            },
        }),
    })
    // Transactions run one at a time, like Firestore's serialisable transactions on one document.
    let chain = Promise.resolve()
    const runTransaction = fn => {
        const transaction = {
            get: ref => ref.get(),
            set: (ref, value, options) => ref.set(value, options),
        }
        const run = chain.then(() => fn(transaction))
        chain = run.catch(() => {})
        return run
    }
    return { docs, doc: docRef, collection: collectionRef, runTransaction }
}

// A mailbox: labels per message, a growing history of label changes, the current historyId.
function createMailbox({ starred = [], extraLabels = {}, missing = [] } = {}) {
    let historyId = 5000
    const labels = new Map()
    const history = []
    let expired = false
    const ensure = id => {
        if (!labels.has(id)) labels.set(id, new Set(['INBOX']))
        return labels.get(id)
    }
    starred.forEach(id => ensure(id).add('STARRED'))
    Object.entries(extraLabels).forEach(([id, list]) => list.forEach(label => ensure(id).add(label)))

    const change = (id, add = [], remove = []) => {
        const current = ensure(id)
        const added = add.filter(label => !current.has(label))
        const removed = remove.filter(label => current.has(label))
        added.forEach(label => current.add(label))
        removed.forEach(label => current.delete(label))
        if (!added.length && !removed.length) return null // Gmail records no history for a no-op
        historyId += 1
        const record = { id: String(historyId) }
        if (added.length) record.labelsAdded = [{ message: { id, threadId: `thread-${id}` }, labelIds: added }]
        if (removed.length) record.labelsRemoved = [{ message: { id, threadId: `thread-${id}` }, labelIds: removed }]
        history.push(record)
        return record
    }

    const calls = []
    const gmail = {
        users: {
            getProfile: jest.fn(async () => ({ data: { historyId: String(historyId) } })),
            history: {
                list: jest.fn(async ({ startHistoryId, historyTypes }) => {
                    calls.push({ type: 'history', startHistoryId, historyTypes })
                    if (expired) throw Object.assign(new Error('Requested entity was not found.'), { code: 404 })
                    const start = BigInt(startHistoryId)
                    return {
                        data: {
                            history: history.filter(record => BigInt(record.id) > start && record.labelsAdded),
                            historyId: String(historyId),
                        },
                    }
                }),
            },
            messages: {
                get: jest.fn(async ({ id }) => {
                    calls.push({ type: 'get', id })
                    if (missing.includes(id))
                        throw Object.assign(new Error('Requested entity was not found.'), { code: 404 })
                    return { data: { id, threadId: `thread-${id}`, labelIds: [...ensure(id)] } }
                }),
                modify: jest.fn(async ({ id, requestBody }) => {
                    calls.push({ type: 'modify', id, requestBody })
                    change(id, requestBody.addLabelIds || [], requestBody.removeLabelIds || [])
                    return { data: { id, labelIds: [...ensure(id)] } }
                }),
            },
        },
    }
    const withGmail = jest.fn(async (userId, connectionKey, run) => run(gmail))
    return {
        gmail,
        withGmail,
        calls,
        // What the user does in the Gmail UI.
        userStars: id => change(id, ['STARRED']),
        userUnstars: id => change(id, [], ['STARRED']),
        isStarred: id => !!labels.get(id)?.has('STARRED'),
        expireHistory: () => {
            expired = true
        },
        get historyId() {
            return historyId
        },
    }
}

function createWorld({ starred = [], extraLabels = {}, missing = [], premium = true, now = 1_800_000_000_000 } = {}) {
    const db = createFakeDatabase({
        [`users/${OWNER}`]: { premium: { status: premium ? 'premium' : 'free' }, projectIds: [PROJECT] },
        [`projects/${PROJECT}`]: { userIds: [OWNER] },
    })
    const mail = createMailbox({ starred, extraLabels, missing })
    const clock = { now }
    let taskCounter = 0
    const starOptions = { database: db, withGmail: mail.withGmail }

    const taskDoc = (messageId, extra = {}) => ({
        name: `Task for ${messageId}`,
        userId: OWNER,
        userIds: [OWNER],
        inDone: false,
        done: false,
        gmailData: { provider: 'google', accountUserId: OWNER, gmailEmail: EMAIL, messageId, connectionId: KEY },
        ...extra,
    })

    // The existing creation path, reduced to what matters here: linked-task guard, task, star.
    const createTask = jest.fn(async ({ messageId, adoptExistingStar, projectId: connectionKey }) => {
        const linked = [...db.docs.entries()].find(
            ([path, data]) => path.startsWith(`items/${PROJECT}/tasks/`) && data?.gmailData?.messageId === messageId
        )
        if (linked) return { taskId: linked[0].split('/').pop(), projectId: PROJECT, existing: true }
        taskCounter += 1
        const taskId = `task-${taskCounter}`
        db.docs.set(`items/${PROJECT}/tasks/${taskId}`, taskDoc(messageId))
        await starEmailOfCreatedTask(
            {
                userId: OWNER,
                connectionKey,
                gmailEmail: EMAIL,
                messageId,
                projectId: PROJECT,
                taskId,
                adoptExistingStar,
            },
            starOptions
        )
        return { taskId, projectId: PROJECT }
    })

    // A task created with the "Create task" button (not by a star): Alldone stars it itself.
    const createTaskByButton = async messageId => {
        taskCounter += 1
        const taskId = `task-${taskCounter}`
        db.docs.set(`items/${PROJECT}/tasks/${taskId}`, taskDoc(messageId))
        await starEmailOfCreatedTask(
            { userId: OWNER, connectionKey: KEY, gmailEmail: EMAIL, messageId, projectId: PROJECT, taskId },
            starOptions
        )
        return taskId
    }

    const taskPath = taskId => `items/${PROJECT}/tasks/${taskId}`
    // Done / reopen in the app, followed by the onUpdateTask trigger.
    const markDone = async taskId => {
        const before = db.docs.get(taskPath(taskId))
        const after = { ...before, inDone: true, done: true, completed: clock.now }
        db.docs.set(taskPath(taskId), after)
        await syncTaskEmailStarOnTaskUpdate({ projectId: PROJECT, taskId, before, after }, starOptions)
    }
    const reopenInApp = async taskId => {
        const before = db.docs.get(taskPath(taskId))
        const after = { ...before, inDone: false, done: false, completed: null }
        db.docs.set(taskPath(taskId), after)
        await syncTaskEmailStarOnTaskUpdate({ projectId: PROJECT, taskId, before, after }, starOptions)
    }
    const reopenTask = jest.fn(async ({ projectId, taskId }) => {
        const task = db.docs.get(`items/${projectId}/tasks/${taskId}`)
        if (!task?.done) return { reactivated: false, reason: 'not_done' }
        await reopenInApp(taskId)
        return { reactivated: true }
    })
    const findLinkedTask = jest.fn(async ({ messageId }) => {
        const linked = [...db.docs.entries()].find(
            ([path, data]) => path.startsWith(`items/${PROJECT}/tasks/`) && data?.gmailData?.messageId === messageId
        )
        return linked ? { taskId: linked[0].split('/').pop(), projectId: PROJECT } : null
    })

    const deps = {
        database: db,
        withGmail: mail.withGmail,
        now: () => clock.now,
        resolveConnection: async () => ({ connection: { provider: 'google', emailAddress: EMAIL, connected: true } }),
        findLinkedTask,
        createTask,
        reopenTask,
    }
    const tick = (config = {}, ms = 5 * 60 * 1000) => {
        clock.now += ms
        return importStarredGmailMessages({ userId: OWNER, connectionKey: KEY, config }, deps)
    }
    const cursor = () => db.docs.get(`users/${OWNER}/gmailStarImports/cursor_${KEY}`)
    const registry = taskId => db.docs.get(`users/${OWNER}/gmailTaskStars/${taskId}`)
    const task = taskId => db.docs.get(taskPath(taskId))
    return {
        db,
        mail,
        clock,
        deps,
        tick,
        cursor,
        registry,
        task,
        createTask,
        createTaskByButton,
        reopenTask,
        findLinkedTask,
        markDone,
        reopenInApp,
    }
}

describe('gmailStarTaskImport (AT-3165 follow-up)', () => {
    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => {})
        jest.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => jest.restoreAllMocks())

    describe('no backfill', () => {
        it('the first run only stores the cursor: stars that already exist are never imported', async () => {
            const world = createWorld({ starred: ['old-1', 'old-2'] })
            world.mail.userStars('old-3') // starred before the import ever ran

            const first = await world.tick()
            expect(first).toEqual({ state: 'initialized', reason: 'first_run' })
            expect(world.cursor().historyId).toBe(String(world.mail.historyId))

            const second = await world.tick()
            expect(second.state).toBe('ok')
            expect(second.events).toBe(0)
            expect(world.createTask).not.toHaveBeenCalled()
            expect(world.mail.gmail.users.history.list).toHaveBeenLastCalledWith(
                expect.objectContaining({ historyTypes: ['labelAdded'] })
            )
        })

        it('a gap longer than the limit restarts the cursor without importing what happened in it', async () => {
            const world = createWorld()
            await world.tick()
            world.mail.userStars('during-gap')
            const result = await world.tick({}, MAX_CURSOR_GAP_MS + 1)
            expect(result).toEqual({ state: 'initialized', reason: 'gap' })
            await world.tick()
            expect(world.createTask).not.toHaveBeenCalled()
        })

        it('an expired history id restarts the cursor without importing', async () => {
            const world = createWorld()
            await world.tick()
            world.mail.userStars('m1')
            world.mail.expireHistory()
            expect(await world.tick()).toEqual({ state: 'initialized', reason: 'history_expired' })
            expect(world.createTask).not.toHaveBeenCalled()
        })

        it('switched off: nothing is imported and the cursor is dropped; switching on starts fresh', async () => {
            const world = createWorld()
            await world.tick()
            world.mail.userStars('while-off')
            expect(await world.tick({ createTaskOnStar: false })).toEqual({ state: 'disabled' })
            expect(world.cursor().historyId).toBeNull()
            expect(world.mail.gmail.users.history.list).not.toHaveBeenCalled()

            expect(await world.tick({ createTaskOnStar: true })).toEqual({ state: 'initialized', reason: 're_enabled' })
            await world.tick({ createTaskOnStar: true })
            expect(world.createTask).not.toHaveBeenCalled()
        })

        it('needs premium like the labeling it runs with', async () => {
            const world = createWorld({ premium: false })
            expect(await world.tick()).toEqual({ state: 'skipped', reason: 'premium_required' })
            expect(world.mail.withGmail).not.toHaveBeenCalled()
        })
    })

    describe('a new manual star', () => {
        it('creates one task for exactly that message through the existing creation path', async () => {
            const world = createWorld()
            await world.tick()
            world.mail.userStars('m-new')

            const result = await world.tick()

            expect(result.results).toEqual([
                expect.objectContaining({ messageId: 'm-new', state: 'created', taskId: 'task-1' }),
            ])
            expect(world.createTask).toHaveBeenCalledTimes(1)
            expect(world.createTask).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: OWNER,
                    projectId: KEY, // the connection the star was set in
                    messageId: 'm-new',
                    adoptExistingStar: true,
                })
            )
            expect(world.task('task-1').gmailData.messageId).toBe('m-new')
            // The star belongs to the task (decision 2026-11-26).
            expect(world.registry('task-1')).toMatchObject({
                messageId: 'm-new',
                state: 'starred',
                wasStarredBefore: false,
                origin: 'gmail_star',
            })
            // The user's star is kept: no removal while the task is open.
            expect(world.mail.isStarred('m-new')).toBe(true)
        })

        it('Done removes that star, reopening in the app puts it back, and neither creates a task', async () => {
            const world = createWorld()
            await world.tick()
            world.mail.userStars('m1')
            await world.tick()

            await world.markDone('task-1')
            expect(world.mail.isStarred('m1')).toBe(false)
            await world.tick()

            await world.reopenInApp('task-1') // Alldone stars again: a new labelAdded event
            expect(world.mail.isStarred('m1')).toBe(true)
            const afterReopen = await world.tick()
            expect(afterReopen.results).toEqual([expect.objectContaining({ messageId: 'm1', state: 'linked_open' })])
            expect(world.createTask).toHaveBeenCalledTimes(1)
            expect(world.reopenTask).not.toHaveBeenCalled()
        })

        it('a star that is gone again by the time it is read creates nothing', async () => {
            const world = createWorld()
            await world.tick()
            world.mail.userStars('m1')
            world.mail.userUnstars('m1')
            const result = await world.tick()
            expect(result.results).toEqual([expect.objectContaining({ messageId: 'm1', state: 'not_starred' })])
            expect(world.createTask).not.toHaveBeenCalled()
        })

        it('a message deleted before it is read creates nothing', async () => {
            const world = createWorld({ missing: ['gone'] })
            await world.tick()
            world.mail.userStars('gone')
            const result = await world.tick()
            expect(result.results).toEqual([expect.objectContaining({ state: 'message_missing' })])
            expect(world.createTask).not.toHaveBeenCalled()
        })

        it('ignores stars on mail in Trash, Spam or Drafts', async () => {
            const world = createWorld({ extraLabels: { trashed: ['TRASH'] } })
            await world.tick()
            world.mail.userStars('trashed')
            const result = await world.tick()
            expect(result.results).toEqual([expect.objectContaining({ state: 'skipped_label' })])
            expect(world.createTask).not.toHaveBeenCalled()
        })

        it('a message that already has a task (without a star record) creates no second one', async () => {
            const world = createWorld()
            world.db.docs.set(`items/${PROJECT}/tasks/legacy`, {
                userId: OWNER,
                inDone: false,
                gmailData: { accountUserId: OWNER, messageId: 'm1' },
            })
            await world.tick()
            world.mail.userStars('m1')
            const result = await world.tick()
            expect(result.results).toEqual([expect.objectContaining({ state: 'linked_open', taskId: 'legacy' })])
            expect(world.createTask).not.toHaveBeenCalled()
        })
    })

    describe('repeated and parallel events', () => {
        it('star, unstar, star in one window: one task', async () => {
            const world = createWorld()
            await world.tick()
            world.mail.userStars('m1')
            world.mail.userUnstars('m1')
            world.mail.userStars('m1')
            const result = await world.tick()
            expect(result.events).toBe(1)
            expect(world.createTask).toHaveBeenCalledTimes(1)
        })

        it('a replayed history window (cursor not advanced after a crash) creates nothing twice', async () => {
            const world = createWorld()
            await world.tick()
            const cursorBefore = world.cursor().historyId
            world.mail.userStars('m1')
            await world.tick()
            expect(world.createTask).toHaveBeenCalledTimes(1)

            // Simulate the crash: the cursor is back where it was, the same events are read again.
            world.db.docs.set(`users/${OWNER}/gmailStarImports/cursor_${KEY}`, {
                ...world.cursor(),
                historyId: cursorBefore,
            })
            const replay = await world.tick()
            expect(replay.results).toEqual([expect.objectContaining({ messageId: 'm1', state: 'duplicate' })])
            expect(world.createTask).toHaveBeenCalledTimes(1)
        })

        it('the same event without its claim (claim lost) is still a no-op on the current state', async () => {
            const world = createWorld()
            await world.tick()
            const cursorBefore = world.cursor().historyId
            world.mail.userStars('m1')
            await world.tick()
            for (const path of [...world.db.docs.keys()]) {
                if (path.includes('/gmailStarImports/event_')) world.db.docs.delete(path)
            }
            world.db.docs.set(`users/${OWNER}/gmailStarImports/cursor_${KEY}`, {
                ...world.cursor(),
                historyId: cursorBefore,
            })
            const replay = await world.tick()
            expect(replay.results).toEqual([expect.objectContaining({ state: 'linked_open' })])
            expect(world.createTask).toHaveBeenCalledTimes(1)
        })

        it('two overlapping poll runs for one connection: one runs, the other stands down', async () => {
            const world = createWorld()
            await world.tick()
            world.mail.userStars('m1')
            world.clock.now += 5 * 60 * 1000
            const [a, b] = await Promise.all([
                importStarredGmailMessages({ userId: OWNER, connectionKey: KEY, config: {} }, world.deps),
                importStarredGmailMessages({ userId: OWNER, connectionKey: KEY, config: {} }, world.deps),
            ])
            expect([a.state, b.state].sort()).toEqual(['locked', 'ok'])
            expect(world.createTask).toHaveBeenCalledTimes(1)
            // The lease is released for the next tick.
            expect((await world.tick()).state).toBe('ok')
        })

        it('a transient failure keeps the cursor before the event; the next tick finishes it once', async () => {
            const world = createWorld()
            await world.tick()
            world.mail.userStars('m1')
            world.createTask.mockRejectedValueOnce(Object.assign(new Error('Backend Error'), { code: 503 }))

            const failed = await world.tick()
            expect(failed.results).toEqual([])
            expect(world.task('task-1')).toBeUndefined()

            const retried = await world.tick()
            expect(retried.results).toEqual([expect.objectContaining({ messageId: 'm1', state: 'created' })])
            expect(world.createTask).toHaveBeenCalledTimes(2) // one failed attempt, one task
            expect((await world.tick()).results).toEqual([])
        })

        it('insufficient Gold is final: no retry loop, no task', async () => {
            const world = createWorld()
            await world.tick()
            world.mail.userStars('m1')
            world.createTask.mockRejectedValueOnce(
                Object.assign(new Error('INSUFFICIENT_GOLD'), { code: 'INSUFFICIENT_GOLD' })
            )
            const result = await world.tick()
            expect(result.results).toEqual([expect.objectContaining({ state: 'insufficient_gold' })])
            await world.tick()
            expect(world.createTask).toHaveBeenCalledTimes(1)
        })
    })

    describe("Alldone's own stars never create tasks", () => {
        it('the star set by "Create task" is recognised as Alldone\'s (registry written before the star)', async () => {
            const world = createWorld()
            await world.tick()
            const taskId = await world.createTaskByButton('m1')
            expect(world.mail.isStarred('m1')).toBe(true)

            const result = await world.tick()
            expect(result.events).toBe(1)
            expect(result.results).toEqual([expect.objectContaining({ state: 'linked_open', taskId })])
            expect(world.createTask).not.toHaveBeenCalled()
        })

        it("a late event of Alldone's own star, read after the task is Done, neither creates nor reopens", async () => {
            const world = createWorld()
            await world.tick()
            // The user's own earlier star (preexisting) on a task created by the button, then Done
            // before the import reads the star event: Done keeps the user's star, Gmail still shows it.
            world.mail.userStars('m1')
            const taskId = await world.createTaskByButton('m1')
            await world.markDone(taskId)
            expect(world.mail.isStarred('m1')).toBe(true)

            const result = await world.tick()
            expect(result.results).toEqual([expect.objectContaining({ state: 'linked_done_before_star' })])
            expect(world.reopenTask).not.toHaveBeenCalled()
            expect(world.createTask).not.toHaveBeenCalled()
        })

        it('the race "Create task" clicked while the star event waits: one task', async () => {
            const world = createWorld()
            await world.tick()
            world.mail.userStars('m1')
            await world.createTaskByButton('m1') // the click lands before the tick
            await world.tick()
            expect(world.createTask).not.toHaveBeenCalled()
            expect([...world.db.docs.keys()].filter(path => path.startsWith(`items/${PROJECT}/tasks/`))).toHaveLength(1)
        })
    })

    describe('a star on an email whose task is Done reopens it (decision 2026-11-26)', () => {
        it('reopens the task, the star now belongs to it, and the next Done removes it', async () => {
            const world = createWorld()
            await world.tick()
            const taskId = await world.createTaskByButton('m1')
            await world.markDone(taskId)
            expect(world.mail.isStarred('m1')).toBe(false)
            await world.tick()

            world.mail.userStars('m1')
            const result = await world.tick()
            expect(result.results).toEqual([expect.objectContaining({ state: 'reopened', taskId })])
            expect(world.reopenTask).toHaveBeenCalledWith(
                expect.objectContaining({ projectId: PROJECT, taskId, actorUserId: OWNER })
            )
            expect(world.task(taskId).inDone).toBe(false)
            expect(world.registry(taskId)).toMatchObject({ state: 'starred', wasStarredBefore: false })
            expect(world.createTask).not.toHaveBeenCalled()

            await world.markDone(taskId)
            expect(world.mail.isStarred('m1')).toBe(false)
            // Alldone's removal is no star event: nothing reopens it.
            expect((await world.tick()).results).toEqual([])
        })

        it('a task created by a star, done, and starred again is reopened, not duplicated', async () => {
            const world = createWorld()
            await world.tick()
            world.mail.userStars('m1')
            await world.tick()
            await world.markDone('task-1')
            await world.tick()
            world.mail.userStars('m1')
            const result = await world.tick()
            expect(result.results).toEqual([expect.objectContaining({ state: 'reopened', taskId: 'task-1' })])
            expect(world.createTask).toHaveBeenCalledTimes(1)
        })

        it('a linked task without a star record is reopened only if the mailbox owner owns it', async () => {
            const world = createWorld()
            world.db.docs.set(`items/${PROJECT}/tasks/legacy`, {
                userId: 'someone-else',
                inDone: true,
                done: true,
                completed: world.clock.now - 24 * 60 * 60 * 1000,
                gmailData: { accountUserId: OWNER, messageId: 'm1' },
            })
            await world.tick()
            world.mail.userStars('m1')
            const result = await world.tick()
            expect(result.results).toEqual([
                expect.objectContaining({ state: 'linked_done_before_star', reason: 'not_owner' }),
            ])
            expect(world.reopenTask).not.toHaveBeenCalled()
        })

        it('an older own task completed inside the window is not reopened (the star may be older)', async () => {
            const world = createWorld()
            world.db.docs.set(`items/${PROJECT}/tasks/legacy`, {
                userId: OWNER,
                inDone: false,
                gmailData: { accountUserId: OWNER, messageId: 'm1' },
            })
            await world.tick()
            world.mail.userStars('m1')
            world.db.docs.set(`items/${PROJECT}/tasks/legacy`, {
                ...world.task('legacy'),
                inDone: true,
                done: true,
                completed: world.clock.now + 60 * 1000,
            })
            const result = await world.tick()
            expect(result.results).toEqual([expect.objectContaining({ state: 'linked_done_before_star' })])
            expect(world.reopenTask).not.toHaveBeenCalled()
        })

        it('an older own task without a star record is reopened when it was done well before the window', async () => {
            const world = createWorld()
            world.db.docs.set(`items/${PROJECT}/tasks/legacy`, {
                userId: OWNER,
                inDone: true,
                done: true,
                completed: world.clock.now - 24 * 60 * 60 * 1000,
                gmailData: { accountUserId: OWNER, messageId: 'm1' },
            })
            await world.tick()
            world.mail.userStars('m1')
            const result = await world.tick()
            expect(result.results).toEqual([expect.objectContaining({ state: 'reopened', taskId: 'legacy' })])
            expect(world.registry('legacy')).toMatchObject({ messageId: 'm1', state: 'starred', origin: 'gmail_star' })
        })
    })

    describe('starCameAfterDone', () => {
        const event = { maxRecordId: 120n }
        it('uses the history position stored at Done when there is one', () => {
            expect(starCameAfterDone({ event, entry: { doneHistoryId: '119' }, task: {} })).toBe(true)
            expect(starCameAfterDone({ event, entry: { doneHistoryId: '120' }, task: {} })).toBe(false)
            expect(starCameAfterDone({ event, entry: { doneHistoryId: '500' }, task: { completed: 1 } })).toBe(false)
        })
        it('otherwise needs the task to be completed well before the window started', () => {
            const windowStartedAt = 1_000_000_000
            expect(
                starCameAfterDone({
                    event,
                    entry: null,
                    task: { completed: windowStartedAt - 11 * 60000 },
                    windowStartedAt,
                })
            ).toBe(true)
            expect(
                starCameAfterDone({ event, entry: null, task: { completed: windowStartedAt - 60000 }, windowStartedAt })
            ).toBe(false)
            expect(starCameAfterDone({ event, entry: null, task: {}, windowStartedAt })).toBe(false)
        })
    })
})

describe('gmailStarTaskImport wiring', () => {
    const fs = require('fs')
    const path = require('path')
    const read = file => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8')

    test('runs on every labeling poll tick, due or not, and while the labeling lock is held', () => {
        const sync = read('functions/Gmail/serverSideGmailLabelingSync.js')
        const poller = sync.slice(sync.indexOf('async function processEnabledGmailLabelingConfigs'))
        expect(poller.match(/runStarImportOnPollTick\(userId, syncKey, data\)/g)).toHaveLength(3)
        expect(read('functions/index.js')).toContain("schedule: '*/5 * * * *'")
    })

    test('only the server can adopt a star: the callable createTask action never passes adoptExistingStar', () => {
        const service = read('functions/Email/emailLine/emailLineService.js')
        const action = service.slice(
            service.indexOf("case 'createTask':"),
            service.indexOf('default:', service.indexOf("case 'createTask':"))
        )
        expect(action).not.toContain('adoptExistingStar')
        expect(service).toContain('adoptExistingStar: adoptExistingStar === true')
    })

    test('cursor and claims are server-written in firestore.rules', () => {
        const rules = read('firestore.rules')
        const serverOwned = rules.slice(
            rules.indexOf('function isServerOwnedUserCollection'),
            rules.indexOf('function ownerUpdatePreservesProjectMembership')
        )
        expect(serverOwned).toContain("'gmailStarImports'")
    })
})
