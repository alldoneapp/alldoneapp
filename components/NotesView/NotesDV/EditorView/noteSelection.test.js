import {
    captureNoteSelectionSnapshot,
    clearNoteSelectionSnapshot,
    consumeNoteSelectionSnapshot,
    EMPTY_SELECTION,
    isNonEmptySelection,
    normalizeSelection,
    pickBestSelection,
    resolveActionSelection,
    resolveEditorSelection,
} from './noteSelection'

// Quill's Selection constructor does `this.lastRange = this.savedRange = new Range(0, 0)`,
// so a real editor NEVER reports `savedRange === null`. Modelling it as null - which
// the previous version of this suite did - hid AT-2178: it made the "fall back to the
// cache" branch look reachable when in production it never is.
const makeEditor = ({ live = null, saved = { index: 0, length: 0 }, throwOnGetSelection = false } = {}) => ({
    getSelection: () => {
        if (throwOnGetSelection) throw new Error('Accessing non-instantiated editor')
        return live
    },
    selection: { savedRange: saved },
})

describe('normalizeSelection', () => {
    it('copies a valid Quill range into a plain object', () => {
        const range = { index: 4, length: 11, extra: 'ignored' }
        expect(normalizeSelection(range)).toEqual({ index: 4, length: 11 })
    })

    it('rejects the shapes Quill uses for "no selection"', () => {
        expect(normalizeSelection(null)).toBeNull()
        expect(normalizeSelection(undefined)).toBeNull()
        expect(normalizeSelection({})).toBeNull()
        expect(normalizeSelection({ index: 2 })).toBeNull()
        expect(normalizeSelection({ index: -1, length: 3 })).toBeNull()
        expect(normalizeSelection({ index: NaN, length: 3 })).toBeNull()
    })
})

describe('isNonEmptySelection / pickBestSelection', () => {
    it('separates a real selection from a bare caret', () => {
        expect(isNonEmptySelection({ index: 0, length: 3 })).toBe(true)
        expect(isNonEmptySelection({ index: 7, length: 0 })).toBe(false)
        expect(isNonEmptySelection(null)).toBe(false)
    })

    it('prefers the first candidate that covers text', () => {
        expect(
            pickBestSelection([
                { index: 0, length: 0 },
                { index: 6, length: 8 },
            ])
        ).toEqual({ index: 6, length: 8 })
    })

    it('keeps the first usable candidate when every candidate is a caret', () => {
        expect(
            pickBestSelection([
                { index: 9, length: 0 },
                { index: 0, length: 0 },
            ])
        ).toEqual({ index: 9, length: 0 })
    })

    it('skips unusable candidates and ends at an empty selection', () => {
        expect(pickBestSelection([null, undefined, { index: -1, length: 2 }])).toEqual(EMPTY_SELECTION)
    })
})

describe('resolveEditorSelection', () => {
    it('uses the live selection while the editor still has focus', () => {
        const editor = makeEditor({ live: { index: 6, length: 8 }, saved: { index: 0, length: 0 } })
        expect(resolveEditorSelection(editor, { index: 99, length: 99 })).toEqual({ index: 6, length: 8 })
    })

    it('falls back to savedRange once the editor lost focus to the toolbar', () => {
        const editor = makeEditor({ live: null, saved: { index: 6, length: 8 } })
        expect(resolveEditorSelection(editor, EMPTY_SELECTION)).toEqual({ index: 6, length: 8 })
    })

    // AT-2178. Quill's default savedRange is {index: 0, length: 0}, which is a
    // perfectly valid range, so an order that returned it unconditionally made the
    // caller's own cached range unreachable and the create-task popup opened empty.
    it('prefers a cached real selection over Quill’s default savedRange', () => {
        const editor = makeEditor({ live: null, saved: { index: 0, length: 0 } })
        expect(resolveEditorSelection(editor, { index: 4, length: 11 })).toEqual({ index: 4, length: 11 })
    })

    it('falls back to the cached selection when the editor knows nothing', () => {
        const editor = makeEditor({ live: null, saved: null })
        expect(resolveEditorSelection(editor, { index: 3, length: 5 })).toEqual({ index: 3, length: 5 })
    })

    it('returns an empty selection when nothing is available', () => {
        expect(resolveEditorSelection(makeEditor({ saved: null }), null)).toEqual(EMPTY_SELECTION)
        expect(resolveEditorSelection(null, null)).toEqual(EMPTY_SELECTION)
        expect(resolveEditorSelection(undefined, undefined)).toEqual(EMPTY_SELECTION)
    })

    it('reports a genuinely collapsed caret rather than resurrecting an old range', () => {
        const editor = makeEditor({ live: { index: 12, length: 0 }, saved: { index: 6, length: 8 } })
        expect(resolveEditorSelection(editor, { index: 6, length: 8 })).toEqual({ index: 12, length: 0 })
    })

    it('survives an editor that throws on getSelection', () => {
        const editor = makeEditor({ throwOnGetSelection: true, saved: { index: 1, length: 2 } })
        expect(resolveEditorSelection(editor, null)).toEqual({ index: 1, length: 2 })
    })

    it('does not hand back the caller-owned fallback object', () => {
        const cached = { index: 3, length: 5 }
        const resolved = resolveEditorSelection(makeEditor({ saved: null }), cached)
        expect(resolved).not.toBe(cached)
        expect(resolved).toEqual(cached)
    })
})

describe('resolveActionSelection', () => {
    // The whole point of AT-2178: by the time the create-task popup is built the
    // note editor may report nothing at all, and savedRange may have been reset.
    it('uses the press-time snapshot when the editor can no longer answer', () => {
        const editor = makeEditor({ live: null, saved: { index: 0, length: 0 } })
        expect(resolveActionSelection(editor, { index: 4, length: 11 }, EMPTY_SELECTION)).toEqual({
            index: 4,
            length: 11,
        })
    })

    it('uses the press-time snapshot even when the editor reports a collapsed caret', () => {
        const editor = makeEditor({ live: { index: 0, length: 0 }, saved: { index: 0, length: 0 } })
        expect(resolveActionSelection(editor, { index: 4, length: 11 }, EMPTY_SELECTION)).toEqual({
            index: 4,
            length: 11,
        })
    })

    it('still resolves to empty when the user pressed the button without selecting', () => {
        const editor = makeEditor({ live: { index: 7, length: 0 }, saved: { index: 0, length: 0 } })
        expect(resolveActionSelection(editor, { index: 7, length: 0 }, EMPTY_SELECTION)).toEqual({
            index: 7,
            length: 0,
        })
    })

    it('reads the editor when there is no snapshot at all', () => {
        const editor = makeEditor({ live: { index: 2, length: 5 } })
        expect(resolveActionSelection(editor, null, EMPTY_SELECTION)).toEqual({ index: 2, length: 5 })
    })

    it('falls back to the shared cache when neither snapshot nor editor knows', () => {
        const editor = makeEditor({ live: null, saved: { index: 0, length: 0 } })
        expect(resolveActionSelection(editor, null, { index: 1, length: 9 })).toEqual({ index: 1, length: 9 })
    })
})

describe('press-time snapshot', () => {
    afterEach(() => {
        clearNoteSelectionSnapshot()
    })

    it('carries the selection from the button press to the popup', () => {
        const editor = makeEditor({ live: { index: 4, length: 11 } })
        expect(captureNoteSelectionSnapshot(editor, EMPTY_SELECTION)).toEqual({ index: 4, length: 11 })
        expect(consumeNoteSelectionSnapshot(editor)).toEqual({ index: 4, length: 11 })
    })

    it('is single use, so it cannot pre-fill an unrelated task later', () => {
        const editor = makeEditor({ live: { index: 4, length: 11 } })
        captureNoteSelectionSnapshot(editor, EMPTY_SELECTION)
        expect(consumeNoteSelectionSnapshot(editor)).toEqual({ index: 4, length: 11 })
        expect(consumeNoteSelectionSnapshot(editor)).toBeNull()
    })

    it('is ignored by a different editor', () => {
        const editor = makeEditor({ live: { index: 4, length: 11 } })
        captureNoteSelectionSnapshot(editor, EMPTY_SELECTION)
        expect(consumeNoteSelectionSnapshot(makeEditor())).toBeNull()
    })

    it('records nothing when there is no editor to snapshot', () => {
        captureNoteSelectionSnapshot(null, { index: 4, length: 11 })
        expect(consumeNoteSelectionSnapshot(makeEditor())).toBeNull()
    })

    it('can be dropped explicitly when the note editor goes away', () => {
        const editor = makeEditor({ live: { index: 4, length: 11 } })
        captureNoteSelectionSnapshot(editor, EMPTY_SELECTION)
        clearNoteSelectionSnapshot()
        expect(consumeNoteSelectionSnapshot(editor)).toBeNull()
    })
})
