/**
 * AT-2178 browser regression harness — entry point.
 *
 * Bundled by webpack with the app's own web-bundler config (see
 * `browser-tests/webpack.harness.js`) and driven by real Chromium through
 * Playwright (`browser-tests/at2178/run.js`).
 *
 * The point of this harness is that everything on the path under test is the
 * REAL app module, not a double:
 *   - a real `react-quill` note editor, wired to the real
 *     `mentionsHelper.onChangeSelection`
 *   - the real `EditorToolbarButton` (so the real mousedown/click behaviour of
 *     the toolbar Task button applies)
 *   - the real `mentionsHelper.captureSelectionFromEditor` press-time capture,
 *     exactly as `NotesEditorView.renderTask` calls it
 *   - the real `TaskEditionMode`, given the note's ReactQuill component as
 *     `editorRef` exactly as `TaskTagWrapper` passes it, rendered against the
 *     real Redux store
 *   - the real `CustomTextInput3` inside it, which is what turns `initialOps`
 *     into visible text in the create-task popup
 *
 * The assertion is made on the popup's DOM text, i.e. on what the user sees.
 */
import 'setimmediate'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import ReactQuill from 'react-quill'
import 'quill/dist/quill.snow.css'

import store from '../../redux/store'
import { createPlaceholder, QUILL_EDITOR_NOTE_TYPE } from '../../components/Feeds/CommentsTextInput/textInputHelper'
import EditorToolbarButton from '../../components/NotesView/NotesDV/EditorView/EditorToolbarButton'
import {
    captureSelectionFromEditor,
    getSelection,
    onChangeSelection,
} from '../../components/NotesView/NotesDV/EditorView/mentionsHelper'
import TaskEditionMode from '../../components/UIComponents/FloatModals/ManageTaskModal/TaskEditionMode'
import * as Y from 'yjs'
import { QuillBinding } from 'y-quill'
import Popover from 'react-tiny-popover'
import ManageTaskModal from '../../components/UIComponents/FloatModals/ManageTaskModal/ManageTaskModal'
import CustomTextInput3 from '../../components/Feeds/CommentsTextInput/CustomTextInput3'
import { CREATE_TASK_MODAL_THEME } from '../../components/Feeds/CommentsTextInput/textInputHelper'

const PROJECT_ID = 'proj-1'
const NOTE_ID = 'note-1'
const UID = 'user-1'

const user = {
    uid: UID,
    displayName: 'Test User',
    email: 't@e.st',
    photoURL: '',
    defaultProjectId: PROJECT_ID,
    activeProjects: [PROJECT_ID],
    inactiveProjects: [],
}

store.dispatch({ type: 'Init anonymous sesion', loggedUser: user, currentUser: user })
store.dispatch({
    type: 'Set project initial data',
    project: { id: PROJECT_ID, name: 'Proj', color: '#ffffff', isShared: false, parentTemplateId: null },
    users: [user],
    workstreams: [],
    contacts: [],
    assistants: [],
})
store.dispatch({ type: 'Set selected note', selectedNote: { id: NOTE_ID, isPrivate: false, isPublicFor: [0] } })

let noteRef = null

const App = () => {
    const [open, setOpen] = React.useState(window.location.search.includes('autoopen'))

    // Optional: bind the note editor to a Yjs document exactly the way
    // NotesEditorView does, so the collaborative editing layer is part of the
    // path under test too.
    React.useEffect(() => {
        if (!window.location.search.includes('yjs') || !noteRef) return
        const ydoc = new Y.Doc()
        const binding = new QuillBinding(ydoc.getText('quill'), noteRef.getEditor())
        window.__yjs = { ydoc, binding }
        return () => binding.destroy()
    }, [])
    window.__renders = (window.__renders || 0) + 1

    // Mirrors NotesEditorView.renderTask.
    const pressTask = () => {
        const editor = noteRef ? noteRef.getEditor() : null
        captureSelectionFromEditor(editor)
        window.__pressInfo = {
            cache: { ...getSelection() },
            live: editor && editor.getSelection(),
            saved: editor && editor.selection && { ...editor.selection.savedRange },
            activeElement:
                document.activeElement && (document.activeElement.className || document.activeElement.tagName),
        }
        if (window.location.search.includes('textinput')) {
            window.__harnessOps = window.__constructTaskEditionMode().delta
        }
        setOpen(true)
    }

    return (
        <Provider store={store}>
            <div>
                <div id="toolbar" style={{ padding: 8 }}>
                    <EditorToolbarButton id="task-button" onClick={pressTask}>
                        <span>Task</span>
                    </EditorToolbarButton>
                </div>
                <div id="note" style={{ background: '#fff' }}>
                    <ReactQuill
                        ref={el => {
                            noteRef = el
                            window.__noteRef = el
                        }}
                        theme="snow"
                        modules={{ toolbar: false }}
                        placeholder={createPlaceholder('Type your note...', QUILL_EDITOR_NOTE_TYPE, NOTE_ID)}
                        onChangeSelection={onChangeSelection}
                    />
                </div>
                <div id="popup" style={{ background: '#fff', marginTop: 20 }}>
                    {open && window.location.search.includes('textinput') && (
                        <CustomTextInput3
                            placeholder={'Type to add task'}
                            onChangeText={(...args) => {
                                window.__onChangeTextCalls = (window.__onChangeTextCalls || []).concat([args[0]])
                            }}
                            multiline={true}
                            caretColor="black"
                            autoFocus={true}
                            setMentionsModalActive={() => {}}
                            projectId={PROJECT_ID}
                            styleTheme={CREATE_TASK_MODAL_THEME}
                            initialTextExtended={''}
                            externalEditorId={'harness-editor'}
                            initialDeltaOps={window.__harnessOps}
                            initialCursorIndex={0}
                            forceTriggerEnterActionForBreakLines={() => {}}
                        />
                    )}
                    {open && window.location.search.includes('modal') && (
                        <Popover
                            content={
                                <ManageTaskModal
                                    projectId={PROJECT_ID}
                                    setModalHeight={() => {}}
                                    closeModal={() => {}}
                                    editorRef={noteRef}
                                    noteId={NOTE_ID}
                                    editing={undefined}
                                    task={null}
                                    tagId={undefined}
                                    unwatchTask={() => {}}
                                    objectUrl={undefined}
                                />
                            }
                            align={'start'}
                            position={['bottom']}
                            onClickOutside={() => {}}
                            isOpen={true}
                        >
                            <div />
                        </Popover>
                    )}
                    {open && window.location.search.includes('popover') && (
                        <Popover
                            content={
                                <TaskEditionMode
                                    projectId={PROJECT_ID}
                                    closeModal={() => {}}
                                    editorRef={noteRef}
                                    noteId={NOTE_ID}
                                    task={null}
                                    unwatchTask={() => {}}
                                    toggleEditionMode={() => {}}
                                    pressIcon={() => {}}
                                    isSubtask={false}
                                />
                            }
                            align={'start'}
                            position={['bottom']}
                            onClickOutside={() => {}}
                            isOpen={true}
                        >
                            <div />
                        </Popover>
                    )}
                    {open &&
                        !window.location.search.includes('nopopup') &&
                        !window.location.search.includes('textinput') &&
                        !window.location.search.includes('popover') && (
                            <TaskEditionMode
                                projectId={PROJECT_ID}
                                closeModal={() => {}}
                                editorRef={noteRef}
                                noteId={NOTE_ID}
                                task={null}
                                unwatchTask={() => {}}
                                toggleEditionMode={() => {}}
                                pressIcon={() => {}}
                                isSubtask={false}
                            />
                        )}
                </div>
            </div>
        </Provider>
    )
}

// Production is never quiet: Firestore snapshots, presence and modal state keep
// dispatching, so every component in the popup re-renders repeatedly while the
// create-task input is being filled. Reproduce that churn on demand.
window.__churn = ms => {
    const end = Date.now() + ms
    const tick = () => {
        store.dispatch({ type: 'Set selected note', selectedNote: { id: NOTE_ID, isPrivate: false, n: Math.random() } })
        if (Date.now() < end) setTimeout(tick, 30)
    }
    tick()
}

window.__seedNote = text => {
    const editor = noteRef.getEditor()
    editor.setText(text)
    return editor.getText()
}

// Constructs the REAL TaskEditionMode the same way TaskArea does, without
// rendering its (heavy) subtree, and reports what its constructor resolved.
// This is the exact code path that produces `initialOps` for the popup.
window.__constructTaskEditionMode = () => {
    const instance = new TaskEditionMode({
        projectId: PROJECT_ID,
        closeModal: () => {},
        editorRef: noteRef,
        noteId: NOTE_ID,
        task: null,
        unwatchTask: () => {},
        toggleEditionMode: () => {},
        pressIcon: () => {},
        isSubtask: false,
    })
    const initialOps = instance.state.initialOps
    return {
        capturedNoteSelection: instance.capturedNoteSelection,
        delta: initialOps,
        ops: initialOps ? initialOps.ops : null,
        text: initialOps ? initialOps.ops.map(o => (typeof o.insert === 'string' ? o.insert : '[e]')).join('') : null,
    }
}

// Every create-task input currently on the page. The popup the user sees is the
// last one mounted, so an assertion that only looks at the first can pass while
// the visible one is empty.
window.__popupTexts = () => {
    const els = document.querySelectorAll('.ql-createTaskModalTextInputEditor')
    if (!els.length) {
        const fallback = document.querySelector('#popup .ql-editor')
        return fallback ? [fallback.textContent] : []
    }
    return Array.prototype.map.call(els, el => el.textContent)
}

window.__popupText = () => {
    const texts = window.__popupTexts()
    return texts.length ? texts[texts.length - 1] : null
}

createRoot(document.getElementById('root')).render(<App />)
window.__ready = true
