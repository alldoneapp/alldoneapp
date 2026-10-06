import React from 'react'
import ReactDOM from 'react-dom'
import TaskTagFormat from '../../components/Feeds/CommentsTextInput/autoformat/formats/taskTagFormat'
import NoteQuill from '../../components/NotesView/NotesDV/EditorView/NoteQuill'
import { enableDeferredNoteEmbeds } from '../../components/Feeds/CommentsTextInput/autoformat/formats/noteEmbedVisibility'
import '../../components/NotesView/NotesDV/EditorView/toolbar-styles.css'

const Quill = NoteQuill.Quill
Quill.register(TaskTagFormat, true)
let component
ReactDOM.render(
    <NoteQuill ref={value => (component = value)} theme={null} modules={{ toolbar: false }} />,
    document.getElementById('root')
)
const editor = component.getEditor()
let stopDeferred = () => {}
const tag = id => ({
    insert: {
        taskTagFormat: {
            id,
            editorId: 'note-1',
            taskId: 'task-1',
            objectUrl: 'https://alldone.app/task/fixture',
        },
    },
})

window.fixture = (shape = 'text', deferred = false) => {
    stopDeferred()
    stopDeferred = deferred ? enableDeferredNoteEmbeds('note-1', editor.root) : () => {}
    const ops = {
        text: [{ insert: 'AB' }, tag('tag-1'), { insert: 'CD\n' }],
        alone: [tag('tag-1'), { insert: '\n' }],
        adjacent: [tag('tag-1'), tag('tag-2'), { insert: '\n' }],
        lines: [{ insert: 'AB\n' }, tag('tag-1'), { insert: '\nCD\n' }],
    }[shape]
    editor.setContents(ops)
    editor.history.clear()
    editor.setSelection(0, 0)
    return editor.getContents()
}
window.editor = editor
window.caret = () => {
    const selection = document.getSelection()
    const range = selection.getRangeAt(0)
    const parent = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer
    const rect = range.getBoundingClientRect()
    const bounds = editor.getBounds(editor.getSelection().index)
    const container = editor.container.getBoundingClientRect()
    const [leaf, offset] = editor.getLeaf(editor.getSelection().index)
    const guard = offset === 0 ? leaf.leftGuard : leaf.rightGuard
    let guardRect
    if (guard) {
        const guardRange = document.createRange()
        guardRange.selectNodeContents(guard)
        guardRect = guardRange.getBoundingClientRect()
    }
    return {
        selection: editor.getSelection(),
        editable: parent.isContentEditable,
        height: rect.height,
        left: rect.left,
        top: rect.top,
        focus: editor.hasFocus(),
        bounds: guardRect?.height
            ? { left: guardRect.left, top: guardRect.top, height: guardRect.height }
            : { left: container.left + bounds.left, top: container.top + bounds.top, height: bounds.height },
    }
}
window.fixture()
window.__ready = true
