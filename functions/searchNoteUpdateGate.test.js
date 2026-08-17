const { noteUpdateNeedsIndexing } = require('./searchNoteUpdateGate')

/**
 * AT-2340 — a note document update that cannot have touched the content, and
 * changes no indexed field, must not download the whole note from Storage and
 * re-index it.
 *
 * This was not a rare case. `hasContentChanged` in `updateRecord` is
 * structurally TRUE on every note update: `objectBefore.content` is mapped from
 * the note DOCUMENT, which carries no `content` field (so it defaults to ''),
 * while `objectAfter.content` is the real text downloaded from Storage. So every
 * note doc write — backlink recomputation, followers, sticky data, privacy —
 * paid for a full note download plus a Typesense upsert. Combined with the
 * duplicate backlink write that every autosave produced, a single note save cost
 * two of each.
 *
 * The gate is deliberately its own dependency-free module: `updateRecord` sits
 * on top of the whole functions module graph (firebase-admin, typesense,
 * firebase-functions/params), so the decision would otherwise be untestable.
 */
const mapped = overrides => ({
    objectID: 'note-1p1',
    projectId: 'p1',
    id: 'note-1',
    extendedTitle: 'a note',
    title: 'a note',
    userId: 'user-1',
    content: '',
    lastEditionDate: 1000,
    isPrivate: false,
    isPublicFor: [0],
    parentObject: null,
    ...overrides,
})

const doc = overrides => ({ lastEditionDate: 1000, preview: 'first line', ...overrides })

describe('noteUpdateNeedsIndexing', () => {
    it('skips a backlink-only write — the duplicate write every autosave produced', () => {
        expect(noteUpdateNeedsIndexing(doc(), doc(), mapped(), mapped())).toBe(false)
    })

    it('skips a follower / sticky-data write', () => {
        // Neither is an indexed field, and neither can move the body.
        expect(noteUpdateNeedsIndexing(doc(), doc(), mapped(), mapped())).toBe(false)
    })

    it('indexes when lastEditionDate moved (the content signal)', () => {
        const after = doc({ lastEditionDate: 2000 })
        expect(noteUpdateNeedsIndexing(doc(), after, mapped(), mapped({ lastEditionDate: 2000 }))).toBe(true)
    })

    it('indexes when only the preview moved', () => {
        // Defensive: the preview is derived from the content, so a preview change
        // without a lastEditionDate change still means the body moved.
        const after = doc({ preview: 'edited line' })
        expect(noteUpdateNeedsIndexing(doc(), after, mapped(), mapped())).toBe(true)
    })

    it('indexes a rename even though the body cannot have changed', () => {
        // The record is upserted whole, so the caller must still fetch the body.
        const after = mapped({ title: 'renamed', extendedTitle: 'renamed' })
        expect(noteUpdateNeedsIndexing(doc(), doc(), mapped(), after)).toBe(true)
    })

    it('indexes a privacy change, which decides who can find the note', () => {
        const after = mapped({ isPrivate: true, isPublicFor: ['user-1'] })
        expect(noteUpdateNeedsIndexing(doc(), doc(), mapped(), after)).toBe(true)
    })

    it('indexes when an indexed array changed by value, not by reference', () => {
        expect(noteUpdateNeedsIndexing(doc(), doc(), mapped(), mapped({ isPublicFor: [0] }))).toBe(false)
        expect(noteUpdateNeedsIndexing(doc(), doc(), mapped(), mapped({ isPublicFor: [0, 'u2'] }))).toBe(true)
    })

    it('is safe on missing documents', () => {
        expect(noteUpdateNeedsIndexing(undefined, undefined, mapped(), mapped())).toBe(false)
        expect(noteUpdateNeedsIndexing(undefined, doc(), mapped(), mapped())).toBe(true)
    })
})
