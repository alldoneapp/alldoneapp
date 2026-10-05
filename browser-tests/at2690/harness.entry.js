import React from 'react'
import ReactDOM from 'react-dom'
import ReactQuill from 'react-quill-new'
import NoteQuill from '../../components/NotesView/NotesDV/EditorView/NoteQuill'
import * as Y from 'yjs'
import { QuillBinding } from 'y-quill'
import { WebsocketProvider } from 'y-websocket'
import { createNoteLocalPersistence } from '../../components/NotesView/NotesDV/EditorView/noteLocalPersistence'
import { createLocalFirstNoteSession } from '../../components/NotesView/NotesDV/EditorView/noteLocalFirst'
import { readCursorText, findMentionStart } from '../../components/NotesView/NotesDV/EditorView/noteCursorText'
import { noteDeltaWork } from '../../components/NotesView/NotesDV/EditorView/noteDeltaWork'
import MarkdownTableFormat from '../../components/NotesView/NotesDV/EditorView/MarkdownTableFormat'
import ReactEmbedBlot from '../../components/Feeds/CommentsTextInput/autoformat/formats/reactEmbedBlot'
import {
    renderEmbedContent,
    unmountEmbedReactRoots,
} from '../../components/Feeds/CommentsTextInput/autoformat/formats/embedReactRoot'
import { enableDeferredNoteEmbeds } from '../../components/Feeds/CommentsTextInput/autoformat/formats/noteEmbedVisibility'
import 'quill/dist/quill.snow.css'

const Quill = ReactQuill.Quill
Quill.register(MarkdownTableFormat, true)
let activeRoots = 0
function SyntheticTask({ text }) {
    React.useEffect(() => {
        activeRoots++
        return () => {
            activeRoots--
        }
    }, [])
    return <span style={{ display: 'inline-flex', width: 480, height: 24 }}>{text}</span>
}
class SyntheticTaskBlot extends ReactEmbedBlot {
    static create(data) {
        const node = super.create()
        node.setAttribute('data-text', data.text)
        node.setAttribute('data-id', data.id)
        renderEmbedContent(node, <SyntheticTask text={data.text} />, {
            editorId: 'synthetic-note',
            kind: 'task',
            label: data.text,
            width: 480,
            height: 24,
        })
        return node
    }
    static value(node) {
        return { text: node.getAttribute('data-text'), id: node.getAttribute('data-id') }
    }
}
SyntheticTaskBlot.blotName = 'syntheticTask'
SyntheticTaskBlot.tagName = 'span'
Quill.register(SyntheticTaskBlot, true)

const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const makeDelta = (size, shape) => {
    const ops = []
    for (let i = 0; i < size; i += 10) {
        ops.push({
            insert: 'abcdefghij',
            ...(shape === 'formatted'
                ? { attributes: i % 20 ? { italic: true, color: '#123456' } : { bold: true, background: '#ffff00' } }
                : {}),
        })
        if (shape === 'embeds' && i % 500 === 0) {
            ops.push({ insert: { syntheticTask: { id: `t${i}`, text: `Synthetic task ${i}` } } }, { insert: '\n' })
        }
        if (i % 100 === 90) ops.push({ insert: '\n' })
    }
    ops.push({ insert: '\n' })
    return { ops }
}
const mountEditor = optimized => {
    const host = document.createElement('div')
    host.className = 'editor-host'
    document.body.appendChild(host)
    let component
    let events = 0
    const ref = node => {
        component = node
    }
    const onChange = () => {
        events++
    }
    ReactDOM.render(
        optimized ? (
            <NoteQuill ref={ref} theme={null} modules={{ toolbar: false }} onChange={onChange} />
        ) : (
            <ReactQuill ref={ref} theme={null} modules={{ toolbar: false }} onChange={onChange} />
        ),
        host
    )
    const editor = component.getEditor()
    const doc = new Y.Doc()
    const binding = new QuillBinding(doc.getText('quill'), editor)
    return {
        editor,
        doc,
        get events() {
            return events
        },
        dispose() {
            binding.destroy()
            doc.destroy()
            unmountEmbedReactRoots(editor.root)
            ReactDOM.unmountComponentAtNode(host)
            host.remove()
        },
    }
}

window.profileNotes = async () => {
    const results = []
    for (const size of [10000, 50000, 100000])
        for (const shape of ['plain', 'formatted', 'embeds']) {
            const measurements = {}
            for (const optimized of [false, true]) {
                const note = mountEditor(optimized)
                const release =
                    optimized && shape === 'embeds'
                        ? enableDeferredNoteEmbeds('synthetic-note', note.editor.root)
                        : () => {}
                const started = performance.now()
                note.editor.setContents(makeDelta(size, shape))
                await nextFrame()
                const openMs = performance.now() - started
                const typing = [],
                    html = [],
                    mentions = [],
                    encode = []
                let htmlCalls = 0
                const original = note.editor.getSemanticHTML.bind(note.editor)
                note.editor.getSemanticHTML = (...args) => {
                    htmlCalls++
                    return original(...args)
                }
                // Unprivileged editor captured the original bound function. Count
                // direct calls only; default ReactQuill actually performs two.
                for (let i = 0; i < 9; i++) {
                    let t = performance.now()
                    note.editor.insertText(5, 'x', 'user')
                    typing.push(performance.now() - t)
                    t = performance.now()
                    if (!optimized) {
                        original()
                        original()
                    }
                    html.push(performance.now() - t)
                    t = performance.now()
                    if (optimized) findMentionStart(note.editor, size - 3)
                    else
                        note.editor
                            .getContents()
                            .ops.map(op => (typeof op.insert === 'string' ? op.insert : '&'))
                            .join('')
                    mentions.push(performance.now() - t)
                    t = performance.now()
                    Y.encodeStateAsUpdate(note.doc)
                    encode.push(performance.now() - t)
                    await nextFrame()
                }
                measurements[optimized ? 'after' : 'before'] = {
                    openMs,
                    typingMedianMs: median(typing.slice(2)),
                    htmlMedianMs: median(html.slice(2)),
                    mentionsMedianMs: median(mentions.slice(2)),
                    encodeMedianMs: median(encode.slice(2)),
                    htmlCalls,
                }
                release()
                note.dispose()
                await nextFrame()
            }
            results.push({ size, shape, ...measurements })
        }
    return results
}
window.verifyDeferredEmbeds = async () => {
    const note = mountEditor(true)
    const release = enableDeferredNoteEmbeds('synthetic-note', note.editor.root)
    note.editor.setContents(makeDelta(50000, 'embeds'))
    await nextFrame()
    await new Promise(resolve => setTimeout(resolve, 50))
    const pendingBefore = note.editor.root.querySelectorAll('[data-deferred-embed]').length
    const total = note.editor.root.querySelectorAll('.ql-embed-react-root').length
    const rootsBefore = activeRoots
    note.editor.setSelection(500, 2500, 'silent')
    const savedSelection = JSON.stringify(note.editor.getSelection())
    const savedDelta = JSON.stringify(note.editor.getContents())
    const pending = note.editor.root.querySelector('[data-deferred-embed]')
    const beforeHeight = pending?.getBoundingClientRect().height
    const beforeWidth = pending?.getBoundingClientRect().width
    pending?.scrollIntoView()
    await nextFrame()
    await new Promise(resolve => setTimeout(resolve, 50))
    const afterHeight = pending?.getBoundingClientRect().height
    const afterWidth = pending?.getBoundingClientRect().width
    const afterScroll = activeRoots
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }))
    await nextFrame()
    await new Promise(resolve => setTimeout(resolve, 50))
    const pendingAfterFind = note.editor.root.querySelectorAll('[data-deferred-embed]').length
    const deltaUnchanged = JSON.stringify(note.editor.getContents()) === savedDelta
    const selectionUnchanged = JSON.stringify(note.editor.getSelection()) === savedSelection
    release()
    note.dispose()
    await nextFrame()
    return {
        total,
        pendingBefore,
        rootsBefore,
        afterScroll,
        beforeHeight,
        afterHeight,
        beforeWidth,
        afterWidth,
        pendingAfterFind,
        deltaUnchanged,
        selectionUnchanged,
        rootsAfterClose: activeRoots,
    }
}

// A real IndexedDB cache and real two-client WebSocket room; Storage is a
// synthetic delayed download, never a request to the connected Firebase project.
window.startSyncScenario = async wsUrl => {
    const id = `at2690-${Date.now()}`
    const seedDoc = new Y.Doc()
    seedDoc.getText('quill').insert(0, 'Original\n')
    const initialBytes = Y.encodeStateAsUpdate(seedDoc)
    const persistence = createNoteLocalPersistence(id, seedDoc)
    await persistence.whenSynced
    seedDoc.getText('quill').insert(0, 'Cached ')
    await new Promise(resolve => setTimeout(resolve, 100))
    await persistence.destroy()
    seedDoc.destroy()
    let resolveStorage
    const download = new Promise(resolve => {
        resolveStorage = resolve
    })
    const started = performance.now()
    const session = createLocalFirstNoteSession({
        createLocalPersistence: doc => createNoteLocalPersistence(id, doc),
        createProvider: doc => new WebsocketProvider(wsUrl, id, doc),
        loadStorage: () => download,
    })
    const local = await session.ready
    const readyMs = performance.now() - started
    const localEditor = mountEditor(true)
    // mountEditor comes with its own binding; this scenario uses a separate
    // plain editor so it can bind directly to the restored live document.
    localEditor.dispose()
    const host = document.createElement('div')
    document.body.appendChild(host)
    let component
    ReactDOM.render(
        <NoteQuill
            ref={node => {
                component = node
            }}
            theme={null}
            modules={{ toolbar: false }}
        />,
        host
    )
    const editor = component.getEditor()
    const binding = new QuillBinding(local.document.getText('quill'), editor, local.provider.awareness)
    const remoteDoc = new Y.Doc()
    const remoteProvider = new WebsocketProvider(wsUrl, id, remoteDoc)
    const sync = provider =>
        provider.synced
            ? Promise.resolve()
            : new Promise(resolve => {
                  const cb = value => {
                      if (value) {
                          provider.off('synced', cb)
                          resolve()
                      }
                  }
                  provider.on('synced', cb)
              })
    await sync(local.provider)
    await sync(remoteProvider)
    remoteDoc.getText('quill').insert(0, 'Remote ')
    editor.insertText(editor.getLength() - 1, ' Local', 'user')
    resolveStorage(initialBytes)
    await session.refreshed
    window.syncFixture = {
        id,
        session,
        local,
        editor,
        binding,
        host,
        remoteDoc,
        remoteProvider,
        readyMs,
        close() {
            binding.destroy()
            session.dispose()
            remoteProvider.destroy()
            remoteDoc.destroy()
            ReactDOM.unmountComponentAtNode(host)
            host.remove()
        },
    }
    return { readyMs, text: editor.getText(), cachedShown: editor.getText().includes('Cached') }
}
window.editDisconnected = () => {
    const f = window.syncFixture
    f.local.provider.disconnect()
    f.remoteProvider.disconnect()
    f.editor.insertText(0, 'Offline-local ', 'user')
    f.remoteDoc.getText('quill').insert(0, 'Offline-remote ')
    return f.editor.getText()
}
window.reconnectClients = () => {
    window.syncFixture.local.provider.connect()
    window.syncFixture.remoteProvider.connect()
}
window.verifySync = () => {
    const f = window.syncFixture
    const localText = f.local.document.getText('quill').toString()
    const remoteText = f.remoteDoc.getText('quill').toString()
    return { localText, remoteText, synced: f.local.provider.synced && f.remoteProvider.synced }
}
window.reopenOfflineCache = async () => {
    const f = window.syncFixture
    const id = f.id
    f.close()
    await new Promise(resolve => setTimeout(resolve, 100))
    const reopened = createLocalFirstNoteSession({
        createLocalPersistence: doc => createNoteLocalPersistence(id, doc),
        createProvider: doc => new WebsocketProvider('ws://127.0.0.1:1', id, doc, { connect: false }),
        loadStorage: () => null,
    })
    const ready = await reopened.ready
    const text = ready.document.getText('quill').toString()
    await reopened.refreshed
    reopened.dispose()
    return text
}
window.__ready = true
