/**
 * @jest-environment jsdom
 *
 * AT-2441 (second half) — a pasted screenshot never reached the posted comment.
 *
 * Quill 2's Clipboard intercepts a paste that carries files and hands it to the SAME uploader
 * module that owns drops: `onCapturePaste` -> `quill.uploader.upload(range, files)`, whose
 * default handler inserts a base64 data-URL `image` embed. The app's inputs serialize
 * `attachment` / `customImageFormat` / `videoFormat` and nothing else, so that embed showed in
 * the composer and was silently dropped on submit. (Quill 1 did not intercept: the browser's
 * own paste put an <img> into the contenteditable and the autoformat matcher turned it into a
 * real attachment, so this regressed at the quill 2 migration.)
 *
 * Driven against a REAL Quill with the REAL GatedUploader: the defect is in which module
 * claims the event, which no mock can reproduce.
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

import fs from 'fs'
import path from 'path'
import Quill from 'quill'

import './quill2Setup'
import { createAppManagedFileUpload, createPlaceholder, QUILL_EDITOR_TEXT_INPUT_TYPE } from './textInputHelper'
import { checkIsLimitedByTraffic } from '../../Premium/PremiumHelper'

const EDITOR_ID = 'a1f2c3d4-0000-4000-8000-abcdefabcdef'
const PROJECT_ID = 'project-1'

Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
Range.prototype.getClientRects = () => Object.assign([], { item: () => null })

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

const buildEditor = () => {
    const node = document.createElement('div')
    document.body.appendChild(node)
    return new Quill(node, {
        modules: { editorMeta: true, toolbar: false },
        placeholder: createPlaceholder('Type to add new comment', QUILL_EDITOR_TEXT_INPUT_TYPE, EDITOR_ID),
    })
}

const fileOf = (name, type) => new File([new Uint8Array([1, 2, 3])], name, { type })

const pasteFiles = (editor, files) => {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    event.clipboardData = { files, types: ['Files'], getData: () => '' }
    editor.root.dispatchEvent(event)
}

const embedNames = editor =>
    editor
        .getContents()
        .ops.map(
            op => op.insert?.customImageFormat?.text || op.insert?.attachment?.text || op.insert?.videoFormat?.text
        )
        .filter(Boolean)

const rawImageOps = editor => editor.getContents().ops.filter(op => op.insert?.image)

// Quill's uploader reads each file through a real FileReader and only then applies its delta,
// so every assertion here has to wait out a chain of genuine event-loop turns. A single fixed
// sleep is a bet on how long that takes: 20ms was enough on an idle machine and failed roughly
// one run in three once the suite shared workers with anything else, always as "the paste
// inserted nothing". Turning the wall clock into event-loop TURNS removes the bet — a starved
// worker gets the same number of chances to run the reader, it just takes longer to hand them out.
const SETTLE_TURNS = 20
const settle = async () => {
    for (let turn = 0; turn < SETTLE_TURNS; turn += 1) {
        await new Promise(resolve => setTimeout(resolve, 1))
    }
}

describe('a pasted image becomes a real attachment (AT-2441)', () => {
    let editor
    let setInputCursorIndex

    beforeEach(() => {
        jest.clearAllMocks()
        checkIsLimitedByTraffic.mockReturnValue(false)
        global.alert = jest.fn()
        global.URL.createObjectURL = jest.fn(file => `blob:${file.name}`)
        setInputCursorIndex = jest.fn()
        editor = buildEditor()
        // What CustomTextInput3 installs on every attachment-capable input.
        editor.appManagedFileUpload = createAppManagedFileUpload({
            editor,
            projectId: PROJECT_ID,
            setInputCursorIndex,
        })
    })

    afterEach(() => {
        document.body.innerHTML = ''
    })

    it('inserts the app attachment, not quill’s base64 image', async () => {
        editor.setSelection(0, 0)

        pasteFiles(editor, [fileOf('pasted.png', 'image/png')])
        await settle()

        expect(embedNames(editor)).toEqual(['pasted.png'])
        expect(rawImageOps(editor)).toEqual([])
        expect(setInputCursorIndex).toHaveBeenCalledWith(3)
    })

    it('pastes at the caret, not at the start of the draft', async () => {
        editor.setText('before after')
        editor.setSelection(7, 0)

        pasteFiles(editor, [fileOf('pasted.png', 'image/png')])
        await settle()

        const text = editor.getText()
        expect(text.indexOf('before')).toBeLessThan(text.indexOf('after'))
        expect(embedNames(editor)).toEqual(['pasted.png'])
    })

    it('takes a pasted file quill would have thrown away — it only ever handled png and jpeg', async () => {
        editor.setSelection(0, 0)

        pasteFiles(editor, [fileOf('report.pdf', 'application/pdf')])
        await settle()

        expect(embedNames(editor)).toEqual(['report.pdf'])
    })

    it('inserts nothing while the project is limited by traffic', async () => {
        checkIsLimitedByTraffic.mockReturnValue(true)
        editor.setSelection(0, 0)

        pasteFiles(editor, [fileOf('pasted.png', 'image/png')])
        await settle()

        expect(embedNames(editor)).toEqual([])
        expect(rawImageOps(editor)).toEqual([])
    })

    it('also rescues a DROP on an attachment input that has no drop zone above it', async () => {
        // EditChat, the description modal and the two topic composers accept attachments but
        // are not wrapped in an AttachmentDropZone, so a drop there reaches quill's uploader —
        // and used to become the same lost base64 image. They inherit the fix for free; the
        // three surfaces that DO have a drop zone never get here, because it claims the event
        // in the capture phase (attachmentDropDuplicate.test.js).
        document.caretRangeFromPoint = () => {
            const range = document.createRange()
            range.setStart(editor.root.firstChild, 0)
            range.setEnd(editor.root.firstChild, 0)
            return range
        }
        const event = new Event('drop', { bubbles: true, cancelable: true })
        event.clientX = 5
        event.clientY = 5
        event.dataTransfer = { files: [fileOf('dropped.png', 'image/png')], types: ['Files'] }
        editor.root.dispatchEvent(event)
        await settle()

        expect(embedNames(editor)).toEqual(['dropped.png'])
        expect(rawImageOps(editor)).toEqual([])
        delete document.caretRangeFromPoint
    })

    it('leaves an editor that declares no handler on quill’s own path', async () => {
        // The notes editor switches the uploader off entirely; headless editors have neither.
        // Nothing outside the app's own inputs may change behaviour.
        delete editor.appManagedFileUpload
        editor.setSelection(0, 0)

        pasteFiles(editor, [fileOf('pasted.png', 'image/png')])
        await settle()

        expect(rawImageOps(editor)).toHaveLength(1)
        expect(embedNames(editor)).toEqual([])
    })

    it('is wired from the inputs that accept attachments only', () => {
        const source = fs.readFileSync(path.join(__dirname, 'CustomTextInput3.js'), 'utf8')

        expect(source).toMatch(/appManagedFileUpload = supportsAttachments/)
        expect(source).toMatch(
            /otherFormats\.some\(format => format === 'attachment' \|\| format === 'customImageFormat'\)/
        )
    })
})
