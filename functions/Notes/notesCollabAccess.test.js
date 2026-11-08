'use strict'

// security audit 2026-11 (notes-collab:y-websocket-room-by-noteId-without-credential): the
// collab server asks this endpoint who may join a note's room. It must decide exactly like
// storage.notes.rules decides who may read and write the note body.

const { decideNoteRoomAccess, createNotesCollabAccessHandler, secretMatches } = require('./notesCollabAccess')

const SECRET = 'shared-test-secret'

function createDb(docs) {
    const read = path => ({ exists: path in docs, data: () => docs[path] })
    return {
        collection: name => ({
            doc: id => ({
                get: async () => read(`${name}/${id}`),
                collection: sub => ({ doc: subId => ({ get: async () => read(`${name}/${id}/${sub}/${subId}`) }) }),
            }),
        }),
    }
}

const auth = {
    verifyIdToken: async token => {
        if (!token.startsWith('valid-')) throw new Error('bad token')
        return { uid: token.slice('valid-'.length), exp: 1900000000 }
    },
}

function createRes() {
    const res = { statusCode: null, body: null, headersSent: false }
    res.status = code => {
        res.statusCode = code
        return res
    }
    res.json = body => {
        res.body = body
        res.headersSent = true
        return res
    }
    return res
}

const docs = {
    'projects/p1': { userIds: ['member', 'owner'], isShared: 2 },
    'projects/shared': { userIds: ['owner'], isShared: 0 },
    'noteItems/p1/notes/public': { isPublicFor: [0], readerIds: [0, 'member', 'owner'] },
    'noteItems/p1/notes/private': { isPublicFor: ['owner'], readerIds: ['owner'] },
    'noteItems/p1/notes/fresh': { isPublicFor: ['member'] },
    'noteItems/shared/notes/public': { isPublicFor: [0], readerIds: [0, 'owner'] },
    'noteItems/shared/notes/private': { isPublicFor: ['owner'], readerIds: ['owner'] },
}

async function call({ secret = SECRET, method = 'POST', body }) {
    const handler = createNotesCollabAccessHandler({ db: createDb(docs), auth, getSecret: () => SECRET })
    const res = createRes()
    await handler({ method, get: name => (name === 'X-Notes-Access-Secret' ? secret : undefined), body }, res)
    return res
}

describe('notesCollabAccess endpoint', () => {
    test('refuses a caller without the shared secret', async () => {
        expect((await call({ secret: 'wrong', body: {} })).statusCode).toBe(401)
        expect((await call({ secret: null, body: {} })).statusCode).toBe(401)
    })

    test('refuses a missing or invalid ID token', async () => {
        expect((await call({ body: { projectId: 'p1', noteId: 'public' } })).statusCode).toBe(400)
        expect((await call({ body: { idToken: 'forged', projectId: 'p1', noteId: 'public' } })).statusCode).toBe(401)
    })

    test('refuses ids that are not plain document ids', async () => {
        expect(
            (await call({ body: { idToken: 'valid-member', projectId: 'p1/x', noteId: 'public' } })).statusCode
        ).toBe(400)
    })

    test('gives a member read and write on a note readable to them', async () => {
        const res = await call({ body: { idToken: 'valid-member', projectId: 'p1', noteId: 'public' } })
        expect(res.statusCode).toBe(200)
        expect(res.body).toEqual({ read: true, write: true, uid: 'member', expiresAt: 1900000000000 })
    })

    test('refuses a member a private note of somebody else', async () => {
        expect((await call({ body: { idToken: 'valid-member', projectId: 'p1', noteId: 'private' } })).statusCode).toBe(
            403
        )
    })

    test('refuses somebody who is not a member of a private project', async () => {
        expect(
            (await call({ body: { idToken: 'valid-outsider', projectId: 'p1', noteId: 'public' } })).statusCode
        ).toBe(403)
        expect(
            (await call({ body: { idToken: 'valid-outsider', projectId: 'p1', noteId: 'missing' } })).statusCode
        ).toBe(403)
    })

    test('gives a non-member of a public project read-only access to a public note only', async () => {
        const res = await call({ body: { idToken: 'valid-outsider', projectId: 'shared', noteId: 'public' } })
        expect(res.statusCode).toBe(200)
        expect(res.body).toMatchObject({ read: true, write: false })
        expect(
            (await call({ body: { idToken: 'valid-outsider', projectId: 'shared', noteId: 'private' } })).statusCode
        ).toBe(403)
    })

    test('refuses everything but POST', async () => {
        expect((await call({ method: 'GET', body: {} })).statusCode).toBe(405)
    })
})

describe('decideNoteRoomAccess', () => {
    test('a member may use the room of a note whose document does not exist yet', () => {
        expect(decideNoteRoomAccess({ uid: 'member', project: docs['projects/p1'], note: null })).toEqual({
            read: true,
            write: true,
        })
    })

    test('isPublicFor counts only while no access projection exists', () => {
        expect(
            decideNoteRoomAccess({
                uid: 'member',
                project: docs['projects/p1'],
                note: docs['noteItems/p1/notes/fresh'],
            })
        ).toEqual({ read: true, write: true })
        expect(
            decideNoteRoomAccess({
                uid: 'member',
                project: docs['projects/p1'],
                note: { isPublicFor: ['member'], readerIds: ['owner'] },
            })
        ).toEqual({ read: false, write: false })
    })

    test('projection maps name a reader by key', () => {
        const project = docs['projects/p1']
        expect(
            decideNoteRoomAccess({ uid: 'member', project, note: { readerIds: [], roleIdsVisibleTo: { member: [] } } })
                .write
        ).toBe(true)
        expect(
            decideNoteRoomAccess({
                uid: 'member',
                project,
                note: { readerIds: [], followedByVisibleTo: { member: false } },
            }).read
        ).toBe(false)
    })

    test('a missing project gives nothing', () => {
        expect(decideNoteRoomAccess({ uid: 'member', project: null, note: null })).toEqual({
            read: false,
            write: false,
        })
    })
})

describe('secretMatches', () => {
    test('needs a configured secret', () => {
        expect(secretMatches('', '')).toBe(false)
        expect(secretMatches('x', undefined)).toBe(false)
        expect(secretMatches(SECRET, SECRET)).toBe(true)
    })
})
