/**
 * @jest-environment jsdom
 *
 * AT-2441 — an image dragged into the rich comment modal was added twice.
 *
 * Two handlers claimed the same `drop`: the app's `AttachmentDropZone` (which inserts the
 * real named attachment) and Quill 2's built-in `uploader` module, which adds its OWN
 * listener on `quill.root` and inserts png/jpeg as a base64 `image` embed. `quill.root` is
 * a descendant of the drop zone, so in the bubble phase Quill's listener ran first and the
 * drop zone's `stopPropagation` could not cancel it.
 *
 * These tests therefore drive the REAL Quill 2 inside the REAL AttachmentDropZone through
 * react-dom, and dispatch a REAL `drop` event on the editor node. Nothing less can see the
 * defect: it lives entirely in the order two listeners on two different nodes are called,
 * which a mocked editor or a hand-called `props.onDrop` cannot reproduce — the previous
 * suite did exactly that and passed throughout.
 */
jest.mock('../../../utils/BackendBridge', () => ({}))
jest.mock('../Utils/HelperFunctions', () => ({
    ATTACHMENT_TRIGGER: 'ATTACHMENT_TRIGGER',
    IMAGE_TRIGGER: 'IMAGE_TRIGGER',
    KARMA_TRIGGER: 'KARMA_TRIGGER',
    MENTION_SPACE_CODE: 'MENTION_SPACE_CODE',
    REGEX_ATTACHMENT: /(?:)/,
    REGEX_EMAIL: /(?:)/,
    REGEX_GENERIC: /(?:)/,
    REGEX_HASHTAG: /(?:)/,
    REGEX_IMAGE: /(?:)/,
    REGEX_KARMA: /(?:)/,
    REGEX_MENTION: /(?:)/,
    REGEX_MILESTONE_TAG: /(?:)/,
    REGEX_URL: /(?:)/,
    REGEX_VIDEO: /(?:)/,
    tryToextractPeopleForMention: jest.fn(),
    VIDEO_TRIGGER: 'VIDEO_TRIGGER',
}))
jest.mock('../../../utils/LinkingHelper', () => ({
    formatUrl: jest.fn(),
    getDvMainTabLink: jest.fn(),
    getUrlObject: jest.fn(),
}))
jest.mock('../../Premium/PremiumHelper', () => ({ checkIsLimitedByTraffic: jest.fn(() => false) }))
jest.mock('../../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../../styles/global', () => ({ colors: { UtilityBlue125: '#0066ff' } }))
jest.mock('react-native', () => jest.requireActual('react-native-web'))

import fs from 'fs'
import path from 'path'
import React, { act, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import Quill from 'quill'
import ReactQuill from 'react-quill-new'

import './quill2Setup'
import AttachmentDropZone from './AttachmentDropZone'
import { createPlaceholder, QUILL_EDITOR_TEXT_INPUT_TYPE } from './textInputHelper'
import { checkIsLimitedByTraffic } from '../../Premium/PremiumHelper'

const EDITOR_ID = 'b4b2b2c1-1f6a-4a7a-9d2f-1d9c0c4a1f11'
const PROJECT_ID = 'project-1'

// jsdom has no layout and Quill measures the caret on every setSelection.
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
Range.prototype.getClientRects = () => Object.assign([], { item: () => null })

// The app's embed blots render React components; inert stand-ins with the same blot names
// let a real document hold them and keep the index arithmetic honest.
const Embed = Quill.import('blots/embed')
const registerStubEmbed = blotName => {
    class StubEmbed extends Embed {
        static create(value) {
            const node = super.create()
            node.setAttribute('data-name', value?.text || '')
            return node
        }
        static value(node) {
            return { text: node.getAttribute('data-name') }
        }
    }
    StubEmbed.blotName = blotName
    StubEmbed.tagName = 'span'
    StubEmbed.className = `stub-${blotName}`
    Quill.register(StubEmbed, true)
}
registerStubEmbed('customImageFormat')
registerStubEmbed('videoFormat')
registerStubEmbed('attachment')

// Exactly the modules and formats the comment composer builds its editor with
// (CustomTextInput3 + EditForm), minus `autoformat`, which needs the redux store.
const MODULES = { editorMeta: true, toolbar: false }
const FORMATS = ['image', 'attachment', 'customImageFormat', 'videoFormat']

const imageFile = (name = 'shot.png') => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })

const embedNamesInOrder = editor =>
    editor
        .getContents()
        .ops.map(
            op => op.insert?.customImageFormat?.text || op.insert?.attachment?.text || op.insert?.videoFormat?.text
        )
        .filter(Boolean)

const rawImageOps = editor => editor.getContents().ops.filter(op => op.insert?.image)

// The composer's shape: the drop zone wraps the editor, and only learns the Quill instance
// once it has mounted — the same `setEditor` handshake EditForm makes.
function Composer({ onReady }) {
    const quillRef = useRef(null)
    const [editor, setEditor] = useState(null)

    useEffect(() => {
        const instance = quillRef.current.getEditor()
        setEditor(instance)
        onReady(instance)
    }, [])

    return (
        <AttachmentDropZone
            testID="drop-zone"
            editor={editor}
            inputCursorIndex={0}
            projectId={PROJECT_ID}
            setInputCursorIndex={() => {}}
        >
            <ReactQuill
                ref={quillRef}
                modules={MODULES}
                formats={FORMATS}
                value=""
                placeholder={createPlaceholder('Type to add new comment', QUILL_EDITOR_TEXT_INPUT_TYPE, EDITOR_ID)}
            />
        </AttachmentDropZone>
    )
}

const PortalComposer = ({ host, onReady }) => createPortal(<Composer onReady={onReady} />, host)

describe('one dropped image is added exactly once (AT-2441)', () => {
    let container
    let root
    let editor

    beforeAll(() => {
        global.IS_REACT_ACT_ENVIRONMENT = true
    })

    beforeEach(() => {
        jest.clearAllMocks()
        checkIsLimitedByTraffic.mockReturnValue(false)
        global.alert = jest.fn()
        global.URL.createObjectURL = jest.fn(file => `blob:${file.name}`)
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)

        act(() => {
            root.render(<Composer onReady={instance => (editor = instance)} />)
        })

        // Quill's uploader resolves the drop position through the caret APIs jsdom lacks.
        document.caretRangeFromPoint = () => {
            const range = document.createRange()
            range.setStart(editor.root.firstChild, 0)
            range.setEnd(editor.root.firstChild, 0)
            return range
        }
    })

    afterEach(() => {
        act(() => root.unmount())
        document.body.innerHTML = ''
        delete document.caretRangeFromPoint
    })

    // A real drop, dispatched where the user drops it: inside the editor. The probe measures
    // the thing the fix is actually about — whether the event still reaches the editor node,
    // where Quill's uploader is listening.
    const dropOnEditor = files => {
        const event = new Event('drop', { bubbles: true, cancelable: true })
        event.clientX = 5
        event.clientY = 5
        event.dataTransfer = { files, types: files.length ? ['Files'] : [], dropEffect: 'none' }

        let reachedEditor = false
        const probe = () => (reachedEditor = true)
        editor.root.addEventListener('drop', probe)
        act(() => {
            editor.root.dispatchEvent(event)
        })
        editor.root.removeEventListener('drop', probe)

        return { event, reachedEditor: () => reachedEditor }
    }

    // Quill's own insert is asynchronous (FileReader), so the duplicate only shows up a
    // turn later — which is exactly why it was invisible to a synchronous assertion.
    const settle = async () => {
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 20))
        })
    }

    it('inserts the dropped image once — the app attachment, not a second base64 copy', async () => {
        const { reachedEditor } = dropOnEditor([imageFile('shot.png')])
        await settle()

        expect(embedNamesInOrder(editor)).toEqual(['shot.png'])
        expect(rawImageOps(editor)).toEqual([])
        // The drop zone owns file drops in its subtree: the event never gets to Quill.
        expect(reachedEditor()).toBe(false)
    })

    it('keeps every image of a multi-image drop, still once each', async () => {
        dropOnEditor([imageFile('first.png'), imageFile('second.jpg')])
        await settle()

        expect(embedNamesInOrder(editor)).toEqual(['first.png', 'second.jpg'])
        expect(rawImageOps(editor)).toEqual([])
    })

    it('prevents the browser from navigating away to the dropped file', async () => {
        const { event } = dropOnEditor([imageFile('shot.png')])
        await settle()

        expect(event.defaultPrevented).toBe(true)
    })

    it('leaves a drop that carries no files to the editor', async () => {
        // Dragging a selection inside the editor is a drop event too. Claiming it would
        // break Quill's own drag-and-drop of text.
        const { reachedEditor } = dropOnEditor([])
        await settle()

        expect(embedNamesInOrder(editor)).toEqual([])
        expect(reachedEditor()).toBe(true)
    })

    it('inserts nothing at all while the project is limited by traffic', async () => {
        checkIsLimitedByTraffic.mockReturnValue(true)

        dropOnEditor([imageFile('shot.png')])
        await settle()

        // Neither handler may act: before the fix Quill still added its base64 copy, so a
        // limited project got the image anyway.
        expect(embedNamesInOrder(editor)).toEqual([])
        expect(rawImageOps(editor)).toEqual([])
    })

    it('claims it inside a portal too — where the rich comment modal actually lives', async () => {
        // The modal renders through react-tiny-popover, i.e. into a node outside the React
        // root. React attaches its delegated listeners to portal containers as well, but the
        // fix depends on that, so pin it: a portalled composer must behave identically.
        act(() => root.unmount())

        const portalHost = document.createElement('div')
        document.body.appendChild(portalHost)
        act(() => {
            root = createRoot(container)
            root.render(<PortalComposer host={portalHost} onReady={instance => (editor = instance)} />)
        })

        dropOnEditor([imageFile('portalled.png')])
        await settle()

        expect(embedNamesInOrder(editor)).toEqual(['portalled.png'])
        expect(rawImageOps(editor)).toEqual([])
    })

    it('is a real conflict: quill 2 still claims png/jpeg drops on the editor node', () => {
        // Guards the reasoning behind the capture-phase handler. If a future Quill stops
        // handling drops, this fails and the phase can be reconsidered.
        expect(editor.uploader.options.mimetypes).toContain('image/png')
        expect(editor.uploader.options.mimetypes).toContain('image/jpeg')
    })

    it('claims the drop in the capture phase, where it still can', () => {
        // The whole fix is the phase: a bubble-phase handler is called after Quill's.
        const source = fs.readFileSync(path.join(__dirname, 'AttachmentDropZone.js'), 'utf8')

        expect(source).toMatch(/onDropCapture=\{onDrop\}/)
        expect(source).not.toMatch(/\bonDrop=\{onDrop\}/)
    })
})
