import { captureSelectionFromEditor, getSelection, onChangeSelection, resetMentionsData } from './mentionsHelper'
import { consumeNoteSelectionSnapshot } from './noteSelection'

// Real Quill initialises savedRange to {index: 0, length: 0} and never sets it
// back to null, so that is the default here too.
const makeEditor = ({ live = null, saved = { index: 0, length: 0 } } = {}) => ({
    getSelection: () => live,
    selection: { savedRange: saved },
})

describe('mentionsHelper selection capture', () => {
    afterEach(() => {
        resetMentionsData()
    })

    it('starts from an empty selection', () => {
        expect(getSelection()).toEqual({ index: 0, length: 0 })
    })

    it('captures what is selected in the editor at press time', () => {
        captureSelectionFromEditor(makeEditor({ live: { index: 6, length: 8 } }))
        expect(getSelection()).toEqual({ index: 6, length: 8 })
    })

    it('captures the selection of an editor that already lost focus', () => {
        captureSelectionFromEditor(makeEditor({ live: null, saved: { index: 6, length: 8 } }))
        expect(getSelection()).toEqual({ index: 6, length: 8 })
    })

    it('keeps the previously cached selection when the editor knows nothing', () => {
        captureSelectionFromEditor(makeEditor({ live: { index: 2, length: 4 } }))
        captureSelectionFromEditor(makeEditor())
        expect(getSelection()).toEqual({ index: 2, length: 4 })
    })

    it('keeps the cached selection when there is no editor at all', () => {
        captureSelectionFromEditor(makeEditor({ live: { index: 2, length: 4 } }))
        captureSelectionFromEditor(null)
        expect(getSelection()).toEqual({ index: 2, length: 4 })
    })

    it('reports no selection when the caret is simply collapsed', () => {
        captureSelectionFromEditor(makeEditor({ live: { index: 2, length: 4 } }))
        captureSelectionFromEditor(makeEditor({ live: { index: 9, length: 0 } }))
        expect(getSelection()).toEqual({ index: 9, length: 0 })
    })

    // AT-2178: the capture only helps if it survives to the popup. Recording it
    // into the shared cache alone was not enough, because the popup re-read the
    // editor and the editor's own answer outranked the cache.
    it('leaves a press-time snapshot for the create-task popup to consume', () => {
        const editor = makeEditor({ live: { index: 6, length: 8 } })
        captureSelectionFromEditor(editor)
        expect(consumeNoteSelectionSnapshot(editor)).toEqual({ index: 6, length: 8 })
    })

    it('drops the snapshot when the note editor is torn down', () => {
        const editor = makeEditor({ live: { index: 6, length: 8 } })
        captureSelectionFromEditor(editor)
        resetMentionsData()
        expect(consumeNoteSelectionSnapshot(editor)).toBeNull()
    })
})

describe('mentionsHelper onChangeSelection', () => {
    afterEach(() => {
        resetMentionsData()
    })

    // `editorElement` is resolved by loadMentionsData and only positions the
    // mention popup. Gating the selection cache on it as well left the cache
    // frozen at {index: 0, length: 0} for every toolbar action until then.
    it('tracks the selection before the mention machinery is ready', () => {
        onChangeSelection({ index: 4, length: 11 })
        expect(getSelection()).toEqual({ index: 4, length: 11 })
    })

    it('ignores the null range Quill reports on blur', () => {
        onChangeSelection({ index: 4, length: 11 })
        onChangeSelection(null)
        expect(getSelection()).toEqual({ index: 4, length: 11 })
    })
})
