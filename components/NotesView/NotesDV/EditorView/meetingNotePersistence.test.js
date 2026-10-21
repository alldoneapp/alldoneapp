import * as Y from 'yjs'
import Quill from 'quill'
import { QuillBinding } from 'y-quill'
import { createMeetingInsertionTarget, insertMeetingTranscript } from './meetingNotePersistence'

function setup(document = new Y.Doc()) {
    const element = window.document.createElement('div')
    window.document.body.appendChild(element)
    const editor = new Quill(element)
    // jsdom has no Range geometry. Scrolling is verified in the browser harness.
    editor.scrollSelectionIntoView = jest.fn()
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

const recordingChunk = (insertionTarget, sequence, text) => ({
    id: `recording:${sequence}`,
    sessionId: 'recording',
    insertionTarget,
    text,
})

test('recording inserts at the starting caret and keeps later chunks together when the user moves elsewhere', () => {
    const state = setup()
    state.editor.setText('Today\n\nOld notes\n')
    state.editor.setSelection(6, 0)
    const insertionTarget = createMeetingInsertionTarget(state)
    insertMeetingTranscript({ ...state, chunk: recordingChunk(insertionTarget, 0, 'First words.') })
    expect(state.editor.getText()).toBe('Today\nFirst words. \nOld notes\n')
    expect(state.editor.getSelection().index).toBe(19)
    state.editor.setSelection(0, 0)
    insertMeetingTranscript({ ...state, chunk: recordingChunk(insertionTarget, 1, 'Second words.') })
    expect(state.editor.getText()).toBe('Today\nFirst words. Second words. \nOld notes\n')
    expect(state.editor.getSelection().index).toBe(0)
    state.close()
})

test('a queued insertion follows collaborator edits before the recording position', () => {
    const state = setup()
    state.editor.setText('Today\n\nOld notes\n')
    state.editor.setSelection(6, 0)
    const insertionTarget = createMeetingInsertionTarget(state)
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(state.document))
    peer.getText('quill').insert(0, 'Collaborator edit\n')
    Y.applyUpdate(state.document, Y.encodeStateAsUpdate(peer), 'remote')
    insertMeetingTranscript({ ...state, chunk: recordingChunk(insertionTarget, 0, 'Recorded here.') })
    expect(state.editor.getText()).toBe('Collaborator edit\nToday\nRecorded here. \nOld notes\n')
    peer.destroy()
    state.close()
})

test('the insertion endpoint survives reload and retry without duplicates or using the current caret', () => {
    const first = setup()
    first.editor.setText('Today\n\nOld notes\n')
    first.editor.setSelection(6, 0)
    const insertionTarget = JSON.parse(JSON.stringify(createMeetingInsertionTarget(first)))
    const chunk = recordingChunk(insertionTarget, 0, 'First.')
    const updates = []
    first.document.on('update', update => updates.push(update))
    insertMeetingTranscript({ ...first, chunk })
    expect(updates).toHaveLength(1)
    const recovered = new Y.Doc()
    Y.applyUpdate(recovered, Y.encodeStateAsUpdate(first.document))
    first.close()
    const second = setup(recovered)
    second.editor.insertText(13, 'Typed later. ', 'user')
    second.editor.setSelection(0, 0)
    expect(insertMeetingTranscript({ ...second, chunk })).toBe(false)
    insertMeetingTranscript({ ...second, chunk: recordingChunk(insertionTarget, 1, 'Second.') })
    expect(second.editor.getText()).toBe('Today\nFirst. Second. Typed later. \nOld notes\n')
    expect(second.editor.getSelection().index).toBe(0)
    second.close()
})

test('a silent first chunk leaves the starting caret available for the next speech chunk', () => {
    const state = setup()
    state.editor.setText('Today\n\nOld notes\n')
    state.editor.setSelection(6, 0)
    const insertionTarget = createMeetingInsertionTarget(state)
    insertMeetingTranscript({ ...state, chunk: recordingChunk(insertionTarget, 0, '') })
    insertMeetingTranscript({ ...state, chunk: recordingChunk(insertionTarget, 1, 'Speech.') })
    expect(state.editor.getText()).toBe('Today\nSpeech. \nOld notes\n')
    state.close()
})

test('dictation in a list preserves its formatting and the following old content', () => {
    const state = setup()
    state.editor.setContents([
        { insert: 'Today' },
        { insert: '\n', attributes: { header: 1 } },
        { insert: '\n', attributes: { list: 'bullet' } },
        { insert: 'Old notes\n' },
    ])
    state.editor.setSelection(6, 0)
    const insertionTarget = createMeetingInsertionTarget(state)
    insertMeetingTranscript({ ...state, chunk: recordingChunk(insertionTarget, 0, 'Recorded item.') })
    expect(state.editor.getText()).toBe('Today\nRecorded item. \nOld notes\n')
    expect(state.editor.getFormat(6, 0)).toMatchObject({ list: 'bullet' })
    expect(state.editor.getFormat(0, 0)).toMatchObject({ header: 1 })
    state.close()
})

test('a recovered chunk waits for its anchor instead of guessing a new insertion position', () => {
    const original = setup()
    original.editor.setText('Unsynced note\n')
    original.editor.setSelection(5, 0)
    const insertionTarget = createMeetingInsertionTarget(original)
    const unrelated = setup()
    const chunk = recordingChunk(insertionTarget, 0, 'Keep queued.')
    expect(() => insertMeetingTranscript({ ...unrelated, chunk })).toThrow('note-pending')
    expect(unrelated.document.getMap('meeting-transcription-chunks').has(chunk.id)).toBe(false)
    expect(unrelated.editor.getText()).toBe('\n')
    original.close()
    unrelated.close()
})

test('reopening before the first result uses the queued starting position and preserves selected text', () => {
    const first = setup()
    first.editor.setText('Today\nExisting words\nOld notes\n')
    first.editor.setSelection(6, 8)
    const insertionTarget = JSON.parse(JSON.stringify(createMeetingInsertionTarget(first)))
    const recovered = new Y.Doc()
    Y.applyUpdate(recovered, Y.encodeStateAsUpdate(first.document))
    first.close()
    const second = setup(recovered)
    second.editor.setSelection(0, 0)
    insertMeetingTranscript({ ...second, chunk: recordingChunk(insertionTarget, 0, 'Recording.') })
    expect(second.editor.getText()).toBe('Today\nRecording. Existing words\nOld notes\n')
    expect(second.editor.getSelection().index).toBe(0)
    second.close()
})

test('notes with embeds before the caret retain their insertion position and paragraph spacing', () => {
    const state = setup()
    state.editor.setContents([{ insert: { image: 'https://example.com/image.png' } }, { insert: '\n\nOld notes\n' }])
    state.editor.setSelection(2, 0)
    const insertionTarget = createMeetingInsertionTarget(state)
    insertMeetingTranscript({ ...state, chunk: recordingChunk(insertionTarget, 0, 'After the image.') })
    expect(state.editor.getText()).toBe('\nAfter the image. \nOld notes\n')
    expect(state.editor.getContents().ops[0].insert).toEqual({ image: 'https://example.com/image.png' })
    state.close()
})

test('recording in the middle of a paragraph inserts between existing words', () => {
    const state = setup()
    state.editor.setText('Beforeafter\nOld notes\n')
    state.editor.setSelection(6, 0)
    const insertionTarget = createMeetingInsertionTarget(state)
    insertMeetingTranscript({ ...state, chunk: recordingChunk(insertionTarget, 0, 'Recorded words.') })
    expect(state.editor.getText()).toBe('Before Recorded words. after\nOld notes\n')
    state.close()
})
