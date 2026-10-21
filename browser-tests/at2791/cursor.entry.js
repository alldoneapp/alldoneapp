// Real Quill/Yjs cursor insertion with simulated transcription results. No microphone,
// provider request or production note is involved.
import Quill from 'quill'
import * as Y from 'yjs'
import { QuillBinding } from 'y-quill'
import {
    createMeetingInsertionTarget,
    insertMeetingTranscript,
} from '../../components/NotesView/NotesDV/EditorView/meetingNotePersistence'
import 'quill/dist/quill.snow.css'

const style = document.createElement('style')
style.textContent = `
@font-face { font-family: Roboto; src: url(/review-font.ttf); }
body { margin: 24px; color: #04142f; font: 14px/22px Roboto, sans-serif; }
main { max-width: 900px; margin: auto; }
button { padding: 8px 12px; margin: 0 8px 8px 0; border: 1px solid #c6cdd2; border-radius: 4px; background: white; font: inherit; color: inherit; cursor: pointer; }
.ql-container { height: 380px; font: inherit; }
.ql-editor { padding: 16px; }
[role=status] { padding: 12px 0; }
`
document.head.appendChild(style)
const main = document.createElement('main')
main.innerHTML = `
<h2>Note recording — cursor insertion</h2>
<p>Simulated transcription results in the real Quill/Yjs editor.</p>
<nav></nav>
<div role="status">Ready. The caret is in today's empty bullet.</div>
<div id="note"></div>
`
document.body.appendChild(main)
const status = main.querySelector('[role=status]')
let documentState, editor, binding, insertionTarget, sequence
const mount = bytes => {
    binding?.destroy()
    documentState?.destroy()
    const host = main.querySelector('#note')
    host.replaceChildren()
    documentState = new Y.Doc()
    if (bytes) Y.applyUpdate(documentState, bytes)
    editor = new Quill(host, { theme: 'snow', modules: { toolbar: false } })
    binding = new QuillBinding(documentState.getText('quill'), editor)
    if (!bytes) {
        editor.setContents([
            { insert: '21.10.2026' },
            { insert: '\n', attributes: { header: 1 } },
            { insert: '\n', attributes: { list: 'bullet' } },
            { insert: 'Earlier notes\n' + 'Older meeting entry\n'.repeat(45) },
        ])
        editor.setSelection(11, 0)
    } else editor.setSelection(0, 0)
}
const action = (label, run) => {
    const button = document.createElement('button')
    button.textContent = label
    button.onmousedown = event => event.preventDefault()
    button.onclick = run
    main.querySelector('nav').appendChild(button)
}
action('Start recording', () => {
    insertionTarget = createMeetingInsertionTarget({ document: documentState, editor })
    sequence = 0
    status.textContent = 'Recording position captured. Simulate an arriving transcript.'
})
action('Receive transcript', () => {
    if (!insertionTarget) return
    const chunk = {
        id: `cursor-test:${sequence}`,
        sessionId: 'cursor-test',
        insertionTarget,
        text: sequence === 0 ? 'This recording belongs here.' : 'The next chunk stays with it.',
    }
    insertMeetingTranscript({ document: documentState, editor, chunk })
    sequence++
    status.textContent = `Inserted ${sequence} transcript chunk(s) at the recording position.`
})
action('Reopen note', () => {
    insertionTarget = insertionTarget && JSON.parse(JSON.stringify(insertionTarget))
    mount(Y.encodeStateAsUpdate(documentState))
    status.textContent = 'Note reopened with the caret at its beginning. The recording position is preserved.'
})
mount()
