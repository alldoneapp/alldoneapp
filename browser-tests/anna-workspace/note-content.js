import React from 'react'
import NoteQuill from '../../components/NotesView/NotesDV/EditorView/NoteQuill'

// Stub note transport and header content, keeping the production Header and
// NoteEditorContainer responsible for their own horizontal layout.
export const subscribeSharedNoteData = () => () => true
const modules = { toolbar: '#fixture-note-toolbar' }
export default function NoteContent({ project }) {
    if (!project) return <h1 style={{ font: '28px Arial' }}>High Level Roadmap</h1>
    return (
        <>
            <div className="ql-toolbar-container">
                <div id="fixture-note-toolbar" style={{ width: '100%', boxSizing: 'border-box' }}>
                    <button className="ql-bold" aria-label="Bold note text" />
                    <button className="ql-italic" aria-label="Italic note text" />
                    <button className="ql-list" value="bullet" aria-label="Note bullet list" />
                </div>
            </div>
            <NoteQuill theme="snow" modules={modules} placeholder="Type your note..." />
        </>
    )
}
