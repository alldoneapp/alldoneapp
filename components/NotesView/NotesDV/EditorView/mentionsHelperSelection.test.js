import { captureSelectionFromEditor, getSelection, resetMentionsData } from './mentionsHelper'

const makeEditor = ({ live = null, saved = null } = {}) => ({
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

    // The toolbar Task button case: the press blurred the editor, so Quill only
    // reports the range through savedRange. Without this the create-task popup
    // reads {index: 0, length: 0} and opens empty.
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
})
