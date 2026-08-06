import { EMPTY_SELECTION, normalizeSelection, resolveEditorSelection } from './noteSelection'

const makeEditor = ({ live = null, saved = null, throwOnGetSelection = false } = {}) => ({
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

describe('resolveEditorSelection', () => {
    it('uses the live selection while the editor still has focus', () => {
        const editor = makeEditor({ live: { index: 6, length: 8 }, saved: { index: 0, length: 0 } })
        expect(resolveEditorSelection(editor, { index: 99, length: 99 })).toEqual({ index: 6, length: 8 })
    })

    // The regression: pressing a toolbar button blurs the contenteditable, so
    // Quill reports null and only savedRange still knows what was selected.
    it('falls back to savedRange once the editor lost focus to the toolbar', () => {
        const editor = makeEditor({ live: null, saved: { index: 6, length: 8 } })
        expect(resolveEditorSelection(editor, EMPTY_SELECTION)).toEqual({ index: 6, length: 8 })
    })

    it('falls back to the cached selection when the editor knows nothing', () => {
        const editor = makeEditor({ live: null, saved: null })
        expect(resolveEditorSelection(editor, { index: 3, length: 5 })).toEqual({ index: 3, length: 5 })
    })

    it('returns an empty selection when nothing is available', () => {
        expect(resolveEditorSelection(makeEditor(), null)).toEqual(EMPTY_SELECTION)
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
        const resolved = resolveEditorSelection(makeEditor(), cached)
        expect(resolved).not.toBe(cached)
        expect(resolved).toEqual(cached)
    })
})
