import React from 'react'
import { render, act } from '@testing-library/react'
import * as Y from 'yjs'
import NotesEditorView, { exportRef } from './NotesEditorView'
import { installAppResumeListener } from '../../../../utils/appResume'

const mockToolbar = jest.fn(() => null)
const mockSave = jest.fn(() => Promise.resolve(true))
const mockDownload = jest.fn()
let mockSeed
const mockState = {
    loggedUser: { uid: 'user', displayName: 'User' },
    isLoadingData: 1,
    notesInnerTasks: {},
    isLoadingNoteData: false,
    blockShortcuts: true,
    smallScreenNavigation: false,
}
jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState), useDispatch: () => jest.fn() }))
jest.mock('../../../../redux/store', () => ({ getState: () => mockState, subscribe: () => () => {} }))
jest.mock('react-hot-keys', () => () => null)
jest.mock('./EditorToolbar', () => {
    const Quill = require('react-quill-new').default.Quill
    class Meta {
        constructor(editor) {
            const id = editor.options.placeholder
            editor.container.classList.add(`ql-container-${id}`)
            editor.root.classList.add(`ql-editor-${id}`)
        }
    }
    Quill.register('modules/editorMeta', Meta, true)
    return {
        __esModule: true,
        default: props => mockToolbar(props),
        modules: { toolbar: false, editorMeta: true },
        formats: ['bold', 'image'],
    }
})
jest.mock('../../../TaskListView/Utils/TasksHelper', () => ({ getUserInProject: () => null }))
jest.mock('../../../../utils/BackendBridge', () => ({
    getNoteData: (...args) => mockDownload(...args),
    addNoteEditor: () => Promise.resolve(),
    removeNoteEditor: () => Promise.resolve(),
    watchNotesCollab: () => () => {},
    tryAddFollower: jest.fn(),
    setLinkedParentObjects: jest.fn(),
    logEvent: jest.fn(),
}))
jest.mock('../../../../URLSystem/Notes/URLsNotes', () => ({ push: jest.fn() }))
jest.mock('../../../styles/global', () => ({
    __esModule: true,
    default: {},
    colors: {},
    getRandomCollabColor: () => '#123456',
}))
jest.mock('../../../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../../../UIControls/CustomScrollView', () => {
    const React = require('react')
    return React.forwardRef(({ children }, ref) => {
        React.useImperativeHandle(ref, () => ({ scrollTo: jest.fn() }))
        return <div>{children}</div>
    })
})
jest.mock('../../../../utils/LinkingHelper', () => ({}))
jest.mock('../../../../utils/SharedHelper', () => ({ accessGranted: () => true }))
jest.mock('../../../Feeds/CommentsTextInput/textInputHelper', () => ({
    createPlaceholder: (_text, _type, id) => id,
    cleanTagsInteractionsPopus: jest.fn(),
}))
jest.mock('../../../ModalsManager/modalsManager', () => ({ removeModal: jest.fn(), storeModal: jest.fn() }))
jest.mock('./mentionsHelper', () => ({
    handleTextChangeForMentions: jest.fn(),
    loadMentionsData: jest.fn(),
    resetMentionsData: jest.fn(),
    onKeyDownInMentionsModal: jest.fn(),
    onChangeSelection: jest.fn(),
    getSelection: () => ({ index: 0, length: 0 }),
}))
jest.mock('../../NotesHelper', () => ({
    getNotePreviewText: (_project, editor) => editor.getText(0, 500),
    getScrollTolerance: () => 80,
}))
jest.mock('../../../Feeds/Utils/HelperFunctions', () => ({ updateNewAttachmentsDataInNotes: jest.fn() }))
jest.mock('../../../UIComponents/FloatModals/DateFormatPickerModal', () => ({}))
jest.mock('../../../UIComponents/ConfirmPopup', () => ({}))
jest.mock('../../../Feeds/CommentsTextInput/CustomTextInput3', () => ({ quillTextInputProjectIds: {} }))
jest.mock('../../../Premium/PremiumHelper', () => ({}))
jest.mock('../../../../utils/Levels', () => ({ updateXpByEditingNote: jest.fn() }))
jest.mock('../../../../utils/backends/firestore', () => ({
    getDb: () => ({}),
    getNotesCollaborationServerData: () => ({ NOTES_COLLABORATION_SERVER: 'ws://fixture' }),
}))
jest.mock('../../../../utils/backends/Notes/notesFirestore', () => ({ setNoteData: (...args) => mockSave(...args) }))
jest.mock('../../../../utils/connectionState', () => ({ isBrowserOffline: () => false }))
jest.mock('./noteLocalPersistence', () => ({
    createNoteLocalPersistence: (_id, document) => {
        require('yjs').applyUpdate(document, mockSeed)
        return { whenSynced: Promise.resolve(), destroy: jest.fn() }
    },
}))
jest.mock('y-websocket', () => ({
    WebsocketProvider: class {
        constructor(_url, _room, doc) {
            this.synced = false
            this.awareness = new (require('y-protocols/awareness').Awareness)(doc)
        }
        on() {}
        off() {}
        destroy() {
            this.awareness.destroy()
        }
    },
}))

const props = {
    project: { id: 'project' },
    note: { id: 'note', preview: 'Original' },
    readOnly: false,
    isFullscreen: false,
    setFullscreen: jest.fn(),
    followState: true,
}
let resolveDownload
let originalBytes
let stopAppResumeListener
let visibilityDescriptor
beforeEach(() => {
    jest.useFakeTimers()
    visibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    stopAppResumeListener = installAppResumeListener({
        evaluateConnection: jest.fn(),
        runIntegrityCheck: jest.fn(),
        updateServiceWorker: jest.fn(),
    })
    mockToolbar.mockClear()
    mockSave.mockClear()
    const doc = new Y.Doc()
    doc.getText('quill').insert(0, 'Original\n')
    originalBytes = Y.encodeStateAsUpdate(doc)
    doc.getText('quill').insert(0, 'Cached ')
    mockSeed = Y.encodeStateAsUpdate(doc)
    doc.destroy()
    mockDownload.mockImplementation(
        () =>
            new Promise(resolve => {
                resolveDownload = resolve
            })
    )
    Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 })
    Range.prototype.getClientRects = () => []
})
afterEach(() => {
    stopAppResumeListener()
    if (visibilityDescriptor) Object.defineProperty(document, 'visibilityState', visibilityDescriptor)
    else delete document.visibilityState
    jest.useRealTimers()
})

it('shows cached content before download, skips renders per key, then saves the merged document', async () => {
    let view
    await act(async () => {
        view = render(<NotesEditorView {...props} />)
    })
    const editor = exportRef.getEditor()
    expect(editor.getText()).toContain('Cached Original')
    const renders = mockToolbar.mock.calls.length
    act(() => {
        editor.insertText(0, 'Typed ', 'user')
        editor.insertText(0, 'More ', 'user')
    })
    expect(mockToolbar).toHaveBeenCalledTimes(renders)
    await act(async () => {
        await jest.advanceTimersByTimeAsync(3000)
    })
    expect(mockSave).not.toHaveBeenCalled() // first Storage union is pending
    await act(async () => {
        resolveDownload(originalBytes)
    })
    expect(mockSave).toHaveBeenCalledTimes(1)
    const saved = new Y.Doc()
    Y.applyUpdate(saved, mockSave.mock.calls[0][2])
    expect(saved.getText('quill').toString()).toBe('More Typed Cached Original\n')
    saved.destroy()
    view.unmount()
})
it('captures edits during an in-flight save before close and uploads them after the first snapshot', async () => {
    let releaseUpload
    mockSave
        .mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    releaseUpload = resolve
                })
        )
        .mockResolvedValue(true)
    let view
    await act(async () => {
        view = render(<NotesEditorView {...props} />)
    })
    await act(async () => {
        resolveDownload(originalBytes)
    })
    expect(mockSave).toHaveBeenCalledTimes(1)
    act(() => exportRef.getEditor().insertText(0, 'Last edit ', 'user'))
    view.unmount()
    await act(async () => {
        releaseUpload(true)
    })
    expect(mockSave).toHaveBeenCalledTimes(2)
    const saved = new Y.Doc()
    Y.applyUpdate(saved, mockSave.mock.calls[1][2])
    expect(saved.getText('quill').toString()).toContain('Last edit Cached Original')
    saved.destroy()
})
it.each(['visibilitychange', 'freeze', 'pagehide', 'beforeunload'])(
    'queues final metadata immediately on %s during an upload and keeps the editor alive',
    async signal => {
        let releaseUpload
        mockSave
            .mockImplementationOnce(
                () =>
                    new Promise(resolve => {
                        releaseUpload = resolve
                    })
            )
            .mockResolvedValue(true)
        let view
        await act(async () => {
            view = render(<NotesEditorView {...props} />)
        })
        await act(async () => {
            resolveDownload(originalBytes)
        })
        act(() => exportRef.getEditor().insertText(0, 'Hidden edit ', 'user'))
        const target = ['visibilitychange', 'freeze'].includes(signal) ? document : window
        if (signal === 'visibilitychange') {
            Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
        }
        act(() => target.dispatchEvent(new Event(signal)))
        expect(mockSave).toHaveBeenCalledTimes(2)
        expect(mockSave.mock.calls[1][3]).toContain('Hidden edit')
        expect(exportRef.getEditor().getText()).toContain('Hidden edit')
        const saved = new Y.Doc()
        Y.applyUpdate(saved, mockSave.mock.calls[1][2])
        expect(saved.getText('quill').toString()).toContain('Hidden edit Cached Original')
        saved.destroy()
        // A single hide can emit all three signals. Clean snapshots must not be reissued.
        act(() => {
            document.dispatchEvent(new Event('freeze'))
            window.dispatchEvent(new Event('pagehide'))
        })
        expect(mockSave).toHaveBeenCalledTimes(2)
        await act(async () => {
            releaseUpload(true)
        })
        // Returning must leave autosave usable for the next edit without another hide.
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'))
            window.dispatchEvent(new Event('pageshow'))
            window.dispatchEvent(new Event('focus'))
            exportRef.getEditor().insertText(0, 'After return ', 'user')
        })
        await act(async () => {
            await jest.advanceTimersByTimeAsync(3000)
        })
        expect(mockSave).toHaveBeenCalledTimes(3)
        expect(mockSave.mock.calls[2][3]).toContain('After return Hidden edit')
        view.unmount()
        // The shared owner outlives the editor; an old subscriber must not touch destroyed Quill/Yjs.
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        act(() => document.dispatchEvent(new Event('freeze')))
        expect(mockSave).toHaveBeenCalledTimes(3)
        expect(warn).not.toHaveBeenCalled()
        warn.mockRestore()
    }
)
