'use strict'

jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))
jest.mock('./menubarApp', () => ({
    __private__: {
        decodeAssistantMessageImage: jest.requireActual('./menubarApp').__private__.decodeAssistantMessageImage,
        resolveTokenUser: jest.fn(),
        isRateLimited: jest.fn(() => false),
        getMenubarAssistantActor: jest.fn(async (_, user) => ({
            assistantId: `assistant-${user.defaultProjectId}`,
            feedUser: { displayName: 'Anna' },
        })),
    },
}))
jest.mock('./writingAssistant', () => ({ runWritingAssistant: jest.fn() }))
jest.mock('../shared/ProjectService', () => ({
    ProjectService: class {
        async initialize() {}
        async getUserProjects() {
            return [
                { id: 'project-a', name: 'Acme', userIds: ['user-a'] },
                { id: 'project-b', name: 'Beta', userIds: ['user-a'] },
            ]
        }
    },
}))

const admin = require('firebase-admin')
const menubar = require('./menubarApp').__private__
const { runWritingAssistant } = require('./writingAssistant')
const {
    handleMenubarWritingStart,
    handleMenubarWritingSession,
    processMenubarWritingRun,
    __private__: helpers,
} = require('./menubarWriting')

// A transactional document store: rejects reads after writes just like Firestore,
// and commits staged writes only after the transaction succeeds.
function documentStore() {
    const clone = value => JSON.parse(JSON.stringify(value))
    const entries = new Map()
    const snapshot = path => ({
        id: path.split('/').at(-1),
        ref: doc(path),
        exists: entries.has(path),
        data: () => (entries.has(path) ? clone(entries.get(path)) : undefined),
    })
    const write = (path, data, merge) =>
        entries.set(path, merge ? { ...(entries.get(path) || {}), ...clone(data) } : clone(data))
    const doc = path => ({
        path,
        id: path.split('/').at(-1),
        get: async () => snapshot(path),
        set: async (data, options) => write(path, data, options?.merge),
        update: async data => {
            if (!entries.has(path)) throw new Error('Missing document')
            write(path, data, true)
        },
        delete: async () => entries.delete(path),
        collection: name => query(`${path}/${name}`),
    })
    const query = (path, filters = [], order = null, count = 999, cursor = null) => ({
        doc: name => doc(`${path}/${name}`),
        where: (field, _, value) => query(path, [...filters, [field, value]], order, count, cursor),
        orderBy: (field, direction) => query(path, filters, [field, direction], count, cursor),
        limit: n => query(path, filters, order, n, cursor),
        startAfter: snap => query(path, filters, order, count, snap.id),
        get: async () => {
            let docs = [...entries.keys()]
                .filter(key => key.startsWith(`${path}/`) && key.slice(path.length + 1).indexOf('/') < 0)
                .map(snapshot)
                .filter(snap => filters.every(([field, value]) => snap.data()[field] === value))
            if (order) docs.sort((a, b) => (a.data()[order[0]] - b.data()[order[0]]) * (order[1] === 'desc' ? -1 : 1))
            if (cursor) docs = docs.slice(docs.findIndex(snap => snap.id === cursor) + 1)
            docs = docs.slice(0, count)
            return { docs, size: docs.length }
        },
    })
    let tail = Promise.resolve()
    const db = {
        doc,
        collection: query,
        entries,
        runTransaction: fn => {
            const job = tail.then(async () => {
                let wrote = false
                const staged = []
                const transaction = {
                    get: async ref => {
                        if (wrote) throw new Error('Read after write')
                        return snapshot(ref.path)
                    },
                    set: (ref, data, options) => {
                        wrote = true
                        staged.push(() => write(ref.path, data, options?.merge))
                    },
                    update: (ref, data) => {
                        wrote = true
                        if (!entries.has(ref.path)) throw new Error('Missing document')
                        staged.push(() => write(ref.path, data, true))
                    },
                }
                const result = await fn(transaction)
                staged.forEach(commit => commit())
                return result
            })
            tail = job.catch(() => {})
            return job
        },
        recursiveDelete: async ref =>
            [...entries.keys()]
                .filter(key => key === ref.path || key.startsWith(`${ref.path}/`))
                .forEach(key => entries.delete(key)),
    }
    return db
}

function response() {
    return {
        statusCode: 200,
        set: jest.fn(),
        status(code) {
            this.statusCode = code
            return this
        },
        json(body) {
            this.body = body
            return this
        },
    }
}
function input(overrides = {}) {
    return {
        token: 'adapp_user-a',
        requestId: 'request-123',
        instructions: 'Write a polite email',
        projectId: 'project-b',
        image: {
            mimeType: 'image/jpeg',
            dataBase64: Buffer.from([255, 216, 255, 0]).toString('base64'),
            width: 100,
            height: 50,
        },
        textbox: {
            appName: 'Chrome',
            windowTitle: 'Gmail',
            label: 'Message Body',
            text: 'Hi',
            selectedText: 'Hi',
            selectionLocation: 0,
            selectionLength: 2,
        },
        ...overrides,
    }
}
async function start(body = input()) {
    const res = response()
    await handleMenubarWritingStart({ method: 'POST', body, ip: '127.0.0.1' }, res)
    return res
}
async function session(body) {
    const res = response()
    await handleMenubarWritingSession(
        { method: 'POST', body: { token: 'adapp_user-a', ...body }, ip: '127.0.0.1' },
        res
    )
    return res
}

let db
beforeEach(async () => {
    jest.clearAllMocks()
    db = documentStore()
    admin.firestore.mockReturnValue(db)
    menubar.resolveTokenUser.mockImplementation(async token =>
        token === 'bad'
            ? null
            : {
                  userId: token === 'adapp_user-b' ? 'user-b' : 'user-a',
                  userData: { gold: 100, defaultProjectId: 'project-a' },
              }
    )
    await db.doc('users/user-a').set({ gold: 100, defaultProjectId: 'project-a' })
    await db.doc('projects/project-a').set({ name: 'Acme', userIds: ['user-a'] })
    await db.doc('projects/project-b').set({ name: 'Beta', userIds: ['user-a'] })
    runWritingAssistant.mockResolvedValue({
        draftText: 'Hello there.',
        assistantId: 'assistant-project-b',
        assistantName: 'Beta assistant',
    })
})

test('concurrent retries queue once and store screenshots only in the owner-private subtree', async () => {
    const replies = await Promise.all([start(), start()])
    expect(replies.every(reply => reply.statusCode === 200)).toBe(true)
    expect(replies[0].body.runId).toBe(replies[1].body.runId)
    const keys = [...db.entries.keys()]
    expect(keys.filter(key => key.startsWith('menubarWritingRuns/'))).toHaveLength(1)
    const images = keys.filter(key => key.includes('/imageChunks/'))
    expect(images).toHaveLength(1)
    expect(images[0]).toMatch(/^users\/user-a\/private\/writing\/sessions\//)
    expect(JSON.stringify([...db.entries.values()])).not.toContain('downloadToken')
    expect((await start(input({ instructions: 'Different request' }))).statusCode).toBe(409)
})

test('another user cannot read, revise, cancel or delete a private session', async () => {
    const { sessionId, runId } = (await start()).body
    for (const action of ['read', 'revision', 'cancel', 'delete']) {
        const res = await session({ action, sessionId, runId, token: 'adapp_user-b' })
        expect(action === 'delete' ? res.body.success : res.statusCode === 404).toBe(true)
    }
    expect((await start(input({ token: 'adapp_user-b', requestId: 'other-request', sessionId }))).statusCode).toBe(404)
    expect((await session({ action: 'read', sessionId })).statusCode).toBe(200)
})

test('selected project assistant receives the screen and existing selection, and completion is tied to its run', async () => {
    const { sessionId, runId } = (await start()).body
    await processMenubarWritingRun({ data: { after: await db.doc(`menubarWritingRuns/${runId}`).get() } })
    expect(runWritingAssistant).toHaveBeenCalledWith(
        expect.objectContaining({
            projectId: 'project-b',
            assistantId: 'assistant-project-b',
            textbox: expect.objectContaining({ selectedText: 'Hi' }),
            image: expect.objectContaining({ mimeType: 'image/jpeg' }),
        })
    )
    const poll = await session({ action: 'revision', sessionId, runId })
    expect(poll.body.revision.status).toBe('completed')
    expect(poll.body.revision.draftText).toBe('Hello there.')
    expect(poll.body.revision.image).toBeUndefined()
    const detail = await session({ action: 'revision', sessionId, runId, includeImage: true })
    expect(detail.body.revision.image).toEqual(input().image)
    await processMenubarWritingRun({ data: { after: await db.doc(`menubarWritingRuns/${runId}`).get() } })
    expect(runWritingAssistant).toHaveBeenCalledTimes(1)
})

test('deletion during generation removes all screenshot chunks and a late result cannot recreate the session', async () => {
    const { sessionId, runId } = (await start()).body
    let release
    let notify
    const began = new Promise(resolve => {
        notify = resolve
    })
    runWritingAssistant.mockImplementationOnce(() => {
        notify()
        return new Promise(resolve => {
            release = resolve
        })
    })
    const worker = processMenubarWritingRun({ data: { after: await db.doc(`menubarWritingRuns/${runId}`).get() } })
    await began
    expect((await session({ action: 'delete', sessionId })).body.success).toBe(true)
    release({ draftText: 'Late result' })
    await worker
    expect([...db.entries.keys()].some(key => key.includes(sessionId))).toBe(false)
})

test('cancelled runs remain cancelled and inaccessible explicit projects fail without generation', async () => {
    const { sessionId, runId } = (await start()).body
    expect((await session({ action: 'cancel', sessionId, runId })).body.success).toBe(true)
    await processMenubarWritingRun({ data: { after: await db.doc(`menubarWritingRuns/${runId}`).get() } })
    expect(runWritingAssistant).not.toHaveBeenCalled()
    const second = (await start(input({ requestId: 'request-456', projectId: 'unavailable' }))).body
    await processMenubarWritingRun({ data: { after: await db.doc(`menubarWritingRuns/${second.runId}`).get() } })
    const failure = await session({ action: 'revision', sessionId: second.sessionId, runId: second.runId })
    expect(failure.body.revision.status).toBe('failed')
    expect(runWritingAssistant).not.toHaveBeenCalled()
})

test('automatic matching rejects unknown or low-confidence projects and falls back to the default', async () => {
    const projects = [
        { id: 'project-a', name: 'Acme' },
        { id: 'project-b', name: 'Beta' },
    ]
    expect(helpers.parseRouting('{"projectId":"outside","confidence":1}', projects).project).toBeNull()
    expect(helpers.parseRouting('{"projectId":"project-b","confidence":0.4}', projects).project).toBeNull()
    expect(helpers.parseRouting('{"projectId":"project-b","confidence":0.9}', projects).project.id).toBe('project-b')
    const generate = jest.fn().mockResolvedValue({ draftText: '{"projectId":null,"confidence":0.1}' })
    const resolution = await helpers.resolveWritingProject(
        db,
        'user-a',
        { defaultProjectId: 'project-a' },
        { instructions: 'Say thanks', textbox: {} },
        null,
        projects,
        generate
    )
    expect(resolution.project.id).toBe('project-a')
})

test('invalid image bytes, path-like IDs and unauthenticated requests are rejected before queueing', async () => {
    expect(
        (
            await start(
                input({ image: { ...input().image, dataBase64: Buffer.from('not an image').toString('base64') } })
            )
        ).statusCode
    ).toBe(400)
    expect((await start(input({ sessionId: '../another-user' }))).statusCode).toBe(400)
    expect((await start(input({ token: 'bad' }))).statusCode).toBe(401)
    expect([...db.entries.keys()].some(key => key.startsWith('menubarWritingRuns/'))).toBe(false)
})
