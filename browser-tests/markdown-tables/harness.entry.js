import Quill from 'quill'
import '../../components/Feeds/CommentsTextInput/quill2Setup'
import MarkdownTableFormat from '../../components/NotesView/NotesDV/EditorView/MarkdownTableFormat'
import '../../components/NotesView/NotesDV/EditorView/markdownTableEditing'
import '../../components/NotesView/NotesDV/EditorView/toolbar-styles.css'
import { onCopy } from '../../components/Feeds/CommentsTextInput/textInputHelper'
import { applyPastedClipboard } from '../../components/NotesView/NotesDV/EditorView/notePaste'
import { markdownToDelta } from '../../components/NotesView/NotesDV/EditorView/markdownToDelta'
import { hasMarkdownTableClipboardHtml } from '../../components/NotesView/NotesDV/EditorView/markdownTableClipboard'

Quill.register('formats/markdownTable', MarkdownTableFormat, true)
const editor = new Quill(document.getElementById('editor'), {
    modules: {
        toolbar: false,
        editorMeta: true,
        markdownTableEditing: true,
        history: { userOnly: true },
    },
})
editor.enablePasteListener = false
editor.setContents([
    { insert: 'Before the table\n' },
    {
        insert: {
            markdownTable: {
                rows: [
                    ['Name', 'Status'],
                    ['**Alice**', 'Open'],
                    ['Bob', 'Done'],
                ],
                alignments: ['left', 'right'],
            },
        },
    },
    { insert: 'After the table\n' },
])
editor.history.clear()
// The notes editor owns these events on the root. They must never receive an
// event from the cell input, where the browser supplies native editing.
window.documentClipboardEvents = []
;['copy', 'cut', 'paste'].forEach(type =>
    editor.root.addEventListener(type, event => {
        window.documentClipboardEvents.push(type)
        event.preventDefault()
        if (type === 'copy' || type === 'cut') onCopy(event, editor, 'PROJ1', type === 'cut')
        else {
            const textData = event.clipboardData.getData('text/plain')
            const htmlData = event.clipboardData.getData('text/html')
            applyPastedClipboard(
                editor,
                { textData, htmlData },
                (target, text, html) =>
                    (hasMarkdownTableClipboardHtml(html) ? null : markdownToDelta(text, Quill.import('delta'))) ||
                    target.clipboard.convert({ html, text }),
                Quill.import('delta')
            )
        }
    })
)
window.editor = editor
window.tableValue = () => editor.getContents().ops.find(op => op.insert?.markdownTable).insert.markdownTable
