'use strict'

// security audit 2026-11: POST /api/menubar/notes moves and updates notes through the Admin SDK by
// an id from the request. A project member must not be able to move or overwrite another member's
// private note that way.

const crypto = require('crypto')

const mockDocs = new Map()
const mockMoveNote = jest.fn(async () => ({ moved: true }))

jest.mock('firebase-admin', () => {
    const snapshot = path => ({
        id: path.split('/').at(-1),
        exists: mockDocs.has(path),
        data: () => mockDocs.get(path),
    })
    const doc = path => ({
        id: path.split('/').at(-1),
        get: async () => snapshot(path),
        set: async (data, options) =>
            mockDocs.set(path, options?.merge ? { ...(mockDocs.get(path) || {}), ...data } : data),
    })
    return {
        firestore: () => ({
            doc,
            collection: name => ({ doc: id => doc(`${name}/${id}`) }),
            batch: () => ({ set: () => {}, delete: () => {}, commit: async () => {} }),
        }),
    }
})
jest.mock('../envFunctionsHelper', () => ({ getEnvFunctions: () => ({}) }))
jest.mock('../shared/moveNoteToDifferentProject', () => ({ moveNoteToDifferentProject: mockMoveNote }))

const { handleMenubarPushNote, __private__ } = require('./menubarApp')

const TOKEN = `adapp_${'b'.repeat(64)}`

const response = () => {
    const res = { statusCode: 200, body: null }
    res.set = () => res
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

const pushMove = async (move, extra = {}) => {
    const res = response()
    await handleMenubarPushNote(
        {
            method: 'POST',
            headers: {},
            ip: '203.0.113.7',
            body: {
                token: TOKEN,
                title: 'Meeting',
                content: 'transcript',
                projectId: move.targetProjectId,
                move: { noteId: move.noteId, sourceProjectId: move.sourceProjectId },
                meeting: { externalId: 'meeting-1' },
                ...extra,
            },
        },
        res
    )
    return res
}

beforeEach(() => {
    mockDocs.clear()
    mockMoveNote.mockClear()
    const tokenHash = crypto.createHash('sha256').update(TOKEN).digest('hex')
    mockDocs.set(`menubarAppTokens/${tokenHash}`, { userId: 'attacker' })
    mockDocs.set('users/attacker', { projectIds: ['shared', 'own'] })
    mockDocs.set('projects/shared', { name: 'Shared', userIds: ['attacker', 'victim'] })
    mockDocs.set('projects/own', { name: 'Own', userIds: ['attacker'] })
    mockDocs.set('noteItems/shared/notes/victim-note', { title: 'Private', isPublicFor: ['victim'] })
})

describe('menubar note push access', () => {
    test("refuses to move another member's private note out of the shared project", async () => {
        const res = await pushMove({ noteId: 'victim-note', sourceProjectId: 'shared', targetProjectId: 'own' })

        expect(res.statusCode).toBe(403)
        expect(mockMoveNote).not.toHaveBeenCalled()
        expect([...mockDocs.keys()].some(key => key.startsWith('menubarNotePushes/'))).toBe(false)
    })

    test('refuses to bind a push record to a private note that already sits in the target', async () => {
        const res = await pushMove({ noteId: 'victim-note', sourceProjectId: 'own', targetProjectId: 'shared' })

        expect(res.statusCode).toBe(403)
        expect(mockMoveNote).not.toHaveBeenCalled()
        expect([...mockDocs.keys()].some(key => key.startsWith('menubarNotePushes/'))).toBe(false)
    })

    test('lets the user reach a note they can read in a project they belong to', async () => {
        mockDocs.set('noteItems/shared/notes/team-note', { isPublicFor: [0] })
        const { menubarUserCanAccessNote } = __private__
        const db = require('firebase-admin').firestore()

        await expect(menubarUserCanAccessNote(db, 'attacker', 'shared', 'team-note')).resolves.toBe(true)
        await expect(menubarUserCanAccessNote(db, 'attacker', 'shared', 'victim-note')).resolves.toBe(false)
        mockDocs.set('noteItems/foreign/notes/open', { isPublicFor: [0] })
        mockDocs.set('projects/foreign', { userIds: ['victim'] })
        await expect(menubarUserCanAccessNote(db, 'attacker', 'foreign', 'open')).resolves.toBe(false)
    })
})
