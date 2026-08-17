import * as Y from 'yjs'

// Importing the module at all exercises the y-indexeddb ESM transform allowlist
// entry in package.json — a missing entry fails here with "Unexpected token
// 'export'", not silently.
import { createNoteLocalPersistence } from './noteLocalPersistence'

describe('createNoteLocalPersistence', () => {
    it('returns null when the environment has no IndexedDB (jsdom default)', () => {
        expect(typeof indexedDB).toBe('undefined')
        const doc = new Y.Doc()
        expect(createNoteLocalPersistence('note-1', doc)).toBeNull()
        doc.destroy()
    })
})
