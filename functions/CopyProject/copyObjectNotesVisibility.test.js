'use strict'

// Security audit 2026-11 (high): copying a project read each copied object's note by id with no
// privacy check, so a note private to one member rode along with a project-shared task.

jest.mock('./FollowObjectHelper', () => ({ addFollower: jest.fn(async () => {}), FOLLOW_TYPE_NOTES: 'notes' }))
jest.mock('./NoteHandlerHelper', () => ({
    getBucketsAndDb: () => ({
        notesBucket: {
            name: 'notes-bucket',
            file: () => ({ exists: async () => [true], copy: async () => {} }),
        },
    }),
}))

const { createFirestoreDouble } = require('../Assistant/__securityFirestoreDouble')
const { copyObjectNotes } = require('./NoteObject')

test('copies only object notes shared with the whole project', async () => {
    const db = createFirestoreDouble({
        'noteItems/src/notes/shared': { title: 'shared', isPublicFor: [0, 'member'] },
        'noteItems/src/notes/private': { title: 'private', isPublicFor: ['otherMember'] },
        'noteItems/src/notes/legacy': { title: 'legacy' },
    })
    // The copy code addresses documents with a leading slash.
    const firestore = () => ({ doc: p => db.doc(p.replace(/^\//, '')) })
    await copyObjectNotes({ firestore }, 'src', 'dst', { uid: 'member' }, ['shared', 'private', 'legacy', 'missing'])
    const copied = db.writes.filter(w => w.path.startsWith('noteItems/dst/')).map(w => w.path)
    expect(copied.sort()).toEqual(['noteItems/dst/notes/legacy', 'noteItems/dst/notes/shared'])
})
