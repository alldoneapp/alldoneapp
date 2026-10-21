import * as Y from 'yjs'
import Quill from 'quill'
import { QuillBinding } from 'y-quill'
import { insertMeetingTranscript } from './meetingNotePersistence'

function setup(document = new Y.Doc()) {
    const element = window.document.createElement('div')
    window.document.body.appendChild(element)
    const editor = new Quill(element)
    const binding = new QuillBinding(document.getText('quill'), editor)
    return {
        document,
        editor,
        close: () => {
            binding.destroy()
            document.destroy()
            element.remove()
        },
    }
}

test('real Quill/Yjs insertion and chunk marker persist atomically; replay after reload does not duplicate', () => {
    const first = setup()
    const updates = []
    first.document.on('update', update => updates.push(update))
    const chunk = { id: 'session:0', text: 'Erster Abschnitt.' }
    expect(insertMeetingTranscript({ ...first, chunk })).toBe(true)
    expect(updates).toHaveLength(1)
    const recovered = new Y.Doc()
    Y.applyUpdate(recovered, Y.encodeStateAsUpdate(first.document))
    first.close()
    const second = setup(recovered)
    expect(insertMeetingTranscript({ ...second, chunk })).toBe(false)
    expect(second.editor.getText().match(/Erster Abschnitt/g)).toHaveLength(1)
    insertMeetingTranscript({ ...second, chunk: { id: 'session:1', text: 'Zweiter Abschnitt.' } })
    expect(second.editor.getText()).toContain('Erster Abschnitt.\nZweiter Abschnitt.')
    second.close()
})

test('empty transcripts are marked too, without inserting an empty paragraph', () => {
    const state = setup()
    const text = state.editor.getText()
    insertMeetingTranscript({ ...state, chunk: { id: 'session:0', text: '' } })
    expect(state.document.getMap('meeting-transcription-chunks').has('session:0')).toBe(true)
    expect(state.editor.getText()).toBe(text)
    state.close()
})
