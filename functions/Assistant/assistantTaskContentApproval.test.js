'use strict'

const crypto = require('crypto')

jest.mock('firebase-admin', () => ({ firestore: () => null }))

const {
    sha256Hex,
    canonicalize,
    computeAssistantTaskContentHash,
    isAssistantTaskContentApprovedByUser,
} = require('./assistantTaskContentHash')
const {
    resolveWriterApproval,
    recordWriterApprovalFromEvent,
    approveAssistantTaskContent,
    evaluateScheduledRunApproval,
    buildBackfillApprovalUpdate,
} = require('./assistantTaskContentApproval')

function makeDb(docs) {
    const apply = (path, patch) => {
        const data = { ...docs.get(path) }
        for (const [key, value] of Object.entries(patch)) {
            const parts = key.split('.')
            let parent = data
            for (const part of parts.slice(0, -1)) parent = parent[part] = { ...parent[part] }
            parent[parts[parts.length - 1]] = value
        }
        docs.set(path, data)
    }
    const db = {
        doc: path => ({
            path,
            get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
        }),
        runTransaction: async run => run({ get: ref => ref.get(), update: (ref, patch) => apply(ref.path, patch) }),
    }
    return db
}

describe('content hash', () => {
    test('sha256Hex is SHA-256 (matches node crypto, including non-ASCII and multi-block input)', () => {
        for (const text of ['', 'abc', 'Grüße 👋 — ñ 日本', 'x'.repeat(1000), '{"a":1}\n ']) {
            expect(sha256Hex(text)).toBe(crypto.createHash('sha256').update(text, 'utf8').digest('hex'))
        }
    })

    test('key order does not matter, content does', () => {
        expect(canonicalize({ b: 1, a: { d: 2, c: [1, { f: 1, e: 2 }] } })).toBe(
            canonicalize({ a: { c: [1, { e: 2, f: 1 }], d: 2 }, b: 1 })
        )
        const base = { prompt: 'p', aiSystemMessage: 's', taskMetadata: { webhookUrl: 'https://a', b: 1 } }
        const hash = computeAssistantTaskContentHash(base)
        expect(
            computeAssistantTaskContentHash({
                taskMetadata: { b: 1, webhookUrl: 'https://a' },
                aiSystemMessage: 's',
                prompt: 'p',
            })
        ).toBe(hash)
        for (const change of [
            { prompt: 'q' },
            { aiSystemMessage: 'evil' },
            { aiModelOverride: 'MODEL_X' },
            { aiReasoningEffort: 'high' },
            { type: 'webhook' },
            { link: 'https://evil' },
            { executionMode: 'workflow' },
            { variables: [{ name: 'v' }] },
            { taskMetadata: { webhookUrl: 'https://evil', b: 1 } },
        ]) {
            expect(computeAssistantTaskContentHash({ ...base, ...change })).not.toBe(hash)
        }
    })

    test('schedule, display and bookkeeping fields do not change the content', () => {
        const base = { prompt: 'p' }
        const hash = computeAssistantTaskContentHash(base)
        expect(
            computeAssistantTaskContentHash({
                ...base,
                name: 'renamed',
                order: 3,
                recurrence: 'weekly',
                startTime: '09:00',
                activatedUserIds: ['x'],
                approvedContentHashByUser: { x: 'y' },
                aiModel: 'derived-on-read',
                executionMode: 'direct',
                aiModelOverride: '',
            })
        ).toBe(hash)
    })

    test('global catalog tasks need no approval; project tasks need the current hash', () => {
        const task = { prompt: 'p' }
        expect(isAssistantTaskContentApprovedByUser(task, 'u', 'globalProject')).toBe(true)
        expect(isAssistantTaskContentApprovedByUser(task, 'u', 'p1')).toBe(false)
        const approved = { ...task, approvedContentHashByUser: { u: computeAssistantTaskContentHash(task) } }
        expect(isAssistantTaskContentApprovedByUser(approved, 'u', 'p1')).toBe(true)
        expect(isAssistantTaskContentApprovedByUser({ ...approved, prompt: 'changed' }, 'u', 'p1')).toBe(false)
        expect(evaluateScheduledRunApproval({ ...approved, prompt: 'changed' }, 'u', 'p1').approved).toBe(false)
    })
})

describe('approval from a write', () => {
    const active = {
        prompt: 'p',
        recurrence: 'daily',
        activatedUserIds: ['victim'],
        recurrenceByUser: { victim: 'daily' },
    }

    test('a co-member editing content approves nothing for the activated user', () => {
        expect(
            resolveWriterApproval({
                projectId: 'p1',
                before: active,
                after: { ...active, prompt: 'evil' },
                authType: 'app_user',
                authId: 'attacker',
            })
        ).toBeNull()
    })

    test('activating, or editing while activated, approves for the writer only', () => {
        const before = { prompt: 'p', recurrence: 'daily', activatedUserIds: [], recurrenceByUser: {} }
        expect(
            resolveWriterApproval({ projectId: 'p1', before, after: active, authType: 'app_user', authId: 'victim' })
        ).toBe(computeAssistantTaskContentHash(active))
        const edited = { ...active, prompt: 'mine' }
        expect(
            resolveWriterApproval({
                projectId: 'p1',
                before: active,
                after: edited,
                authType: 'app_user',
                authId: 'victim',
            })
        ).toBe(computeAssistantTaskContentHash(edited))
    })

    test("an unrelated own write does not approve somebody else's earlier change, nor admin/unknown writes", () => {
        const changedByOther = { ...active, prompt: 'evil' }
        expect(
            resolveWriterApproval({
                projectId: 'p1',
                before: changedByOther,
                after: { ...changedByOther, order: 4 },
                authType: 'app_user',
                authId: 'victim',
            })
        ).toBeNull()
        expect(
            resolveWriterApproval({ projectId: 'p1', before: null, after: active, authType: 'admin', authId: 'victim' })
        ).toBeNull()
        expect(
            resolveWriterApproval({
                projectId: 'globalProject',
                before: null,
                after: active,
                authType: 'app_user',
                authId: 'victim',
            })
        ).toBeNull()
    })

    test('the trigger records the approval, unless the content moved on in between', async () => {
        const docs = new Map([['assistantTasks/p1/a/t', { ...active }]])
        const db = makeDb(docs)
        const before = { ...active, activatedUserIds: [], recurrenceByUser: {} }
        await recordWriterApprovalFromEvent({
            db,
            docPath: 'assistantTasks/p1/a/t',
            projectId: 'p1',
            before,
            after: active,
            authType: 'app_user',
            authId: 'victim',
        })
        expect(docs.get('assistantTasks/p1/a/t').approvedContentHashByUser.victim).toBe(
            computeAssistantTaskContentHash(active)
        )

        docs.set('assistantTasks/p1/a/t', { ...active, prompt: 'evil' })
        const result = await recordWriterApprovalFromEvent({
            db,
            docPath: 'assistantTasks/p1/a/t',
            projectId: 'p1',
            before,
            after: { ...active, recurrenceByUser: { victim: 'weekly' } },
            authType: 'app_user',
            authId: 'victim',
        })
        expect(result).toMatchObject({ approved: false, reason: 'superseded' })
    })
})

describe('approveAssistantTaskContent (callable)', () => {
    const task = { prompt: 'p', aiSystemMessage: 's' }
    const hash = computeAssistantTaskContentHash(task)

    test('approves exactly what the member was shown', async () => {
        const docs = new Map([
            ['projects/p1', { userIds: ['u'] }],
            ['assistantTasks/p1/a/t', { ...task }],
        ])
        await expect(
            approveAssistantTaskContent({
                db: makeDb(docs),
                userId: 'u',
                projectId: 'p1',
                assistantId: 'a',
                taskId: 't',
                expectedHash: hash,
            })
        ).resolves.toMatchObject({ approved: true })
        expect(docs.get('assistantTasks/p1/a/t').approvedContentHashByUser).toEqual({ u: hash })
    })

    test('refuses a changed task, a non-member and a missing task', async () => {
        const docs = new Map([
            ['projects/p1', { userIds: ['u'] }],
            ['assistantTasks/p1/a/t', { ...task, prompt: 'changed' }],
        ])
        const db = makeDb(docs)
        await expect(
            approveAssistantTaskContent({
                db,
                userId: 'u',
                projectId: 'p1',
                assistantId: 'a',
                taskId: 't',
                expectedHash: hash,
            })
        ).rejects.toMatchObject({ code: 'failed-precondition' })
        await expect(
            approveAssistantTaskContent({
                db,
                userId: 'outsider',
                projectId: 'p1',
                assistantId: 'a',
                taskId: 't',
                expectedHash: hash,
            })
        ).rejects.toMatchObject({ code: 'permission-denied' })
        await expect(
            approveAssistantTaskContent({
                db,
                userId: 'u',
                projectId: 'p1',
                assistantId: 'a',
                taskId: 'gone',
                expectedHash: hash,
            })
        ).rejects.toMatchObject({ code: 'not-found' })
        expect(docs.get('assistantTasks/p1/a/t').approvedContentHashByUser).toBeUndefined()
    })
})

describe('backfill of existing activations', () => {
    test('approves the current content for every activated user that lacks it, and nothing else', () => {
        const task = {
            prompt: 'p',
            recurrence: 'daily',
            activatedUserIds: ['a', 'b'],
            recurrenceByUser: { a: 'daily', b: 'daily' },
        }
        const hash = computeAssistantTaskContentHash(task)
        expect(buildBackfillApprovalUpdate({ ...task, approvedContentHashByUser: { a: hash } }, 'p1')).toEqual({
            'approvedContentHashByUser.b': hash,
        })
        expect(
            buildBackfillApprovalUpdate({ prompt: 'x', recurrence: 'daily', activatorUserId: 'legacy' }, 'p1')
        ).toEqual({
            'approvedContentHashByUser.legacy': computeAssistantTaskContentHash({ prompt: 'x' }),
        })
        expect(buildBackfillApprovalUpdate({ prompt: 'x', recurrence: 'never' }, 'p1')).toBeNull()
        expect(buildBackfillApprovalUpdate(task, 'globalProject')).toBeNull()
    })
})
