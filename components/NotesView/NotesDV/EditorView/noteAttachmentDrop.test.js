/**
 * @jest-environment jsdom
 *
 * AT-2365 — dropping several images at once into a note.
 *
 * These tests drive a REAL Quill 2 document (with stand-in embed blots, since the app's
 * blots render React) because the defect was never in a single call: it was in how N
 * concurrent inserts composed. A mocked editor cannot reproduce "the second image lands
 * before the first" — only real index arithmetic against a real document can.
 */
jest.mock('../../../../utils/BackendBridge', () => ({}))
jest.mock('../../../Feeds/Utils/HelperFunctions', () => ({
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
    updateNewAttachmentsDataInNotes: jest.fn(() => Promise.resolve()),
    VIDEO_TRIGGER: 'VIDEO_TRIGGER',
}))
jest.mock('../../../../utils/LinkingHelper', () => ({
    formatUrl: jest.fn(),
    getDvMainTabLink: jest.fn(),
    getUrlObject: jest.fn(),
}))
jest.mock('../../../Premium/PremiumHelper', () => ({ checkIsLimitedByTraffic: jest.fn(() => false) }))
jest.mock('../../../../i18n/TranslationService', () => ({ translate: text => text }))

import fs from 'fs'
import path from 'path'
import Quill from 'quill'

import '../../../Feeds/CommentsTextInput/quill2Setup'
import NoteAttachmentDropModule, {
    handleNoteFilesDrop,
    insertDroppedFilesInNote,
    NOTE_ATTACHMENT_UPLOAD_CONCURRENCY,
    resolveDropIndex,
    uploadDroppedNoteAttachments,
} from './noteAttachmentDrop'
import { createPlaceholder, QUILL_EDITOR_NOTE_TYPE } from '../../../Feeds/CommentsTextInput/textInputHelper'
import { checkIsLimitedByTraffic } from '../../../Premium/PremiumHelper'

const NOTE_ID = 'note-7'

// jsdom has no layout, and Quill measures the caret on every setSelection. Stub the two
// geometry calls it makes so a real editor can run here at all.
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
Range.prototype.getClientRects = () => Object.assign([], { item: () => null })

// The app's embed blots render React components; register inert stand-ins with the same
// blot names so a real document can hold them and the index arithmetic stays honest.
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

const buildEditor = (initialText = '') => {
    const node = document.createElement('div')
    document.body.appendChild(node)
    const quill = new Quill(node, {
        modules: { editorMeta: true, toolbar: false, uploader: false },
        placeholder: createPlaceholder('Write a note', QUILL_EDITOR_NOTE_TYPE, NOTE_ID),
    })
    if (initialText) quill.setText(initialText)
    return quill
}

const imageFile = (name, size = 1024) => ({ name, size, type: 'image/png' })

// The document as a flat list of "what is on each line", so ordering assertions read the
// way a user would describe the note.
const embedNamesInOrder = editor =>
    editor
        .getContents()
        .ops.map(op => op.insert?.customImageFormat || op.insert?.videoFormat || op.insert?.attachment)
        .filter(Boolean)
        .map(embed => embed.text)

const linesWithEmbeds = editor => {
    const lines = [[]]
    editor.getContents().ops.forEach(op => {
        const { insert } = op
        if (typeof insert === 'string') {
            insert.split('\n').forEach((_, i) => {
                if (i > 0) lines.push([])
            })
            return
        }
        const embed = insert.customImageFormat || insert.videoFormat || insert.attachment
        if (embed) lines[lines.length - 1].push(embed.text)
    })
    return lines
}

describe('multi-file drag & drop into a note (AT-2365)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        global.alert = jest.fn()
        global.URL.createObjectURL = jest.fn(file => `blob:${file.name}`)
        checkIsLimitedByTraffic.mockReturnValue(false)
    })

    afterEach(() => {
        document.body.innerHTML = ''
        delete document.caretRangeFromPoint
        delete document.caretPositionFromPoint
    })

    it('inserts every dropped file, in drop order', () => {
        const editor = buildEditor()
        const files = [imageFile('first.png'), imageFile('second.png'), imageFile('third.png')]

        const inserted = insertDroppedFilesInNote({ editor, files, startIndex: 0 })

        expect(inserted.map(item => item.name)).toEqual(['first.png', 'second.png', 'third.png'])
        expect(embedNamesInOrder(editor)).toEqual(['first.png', 'second.png', 'third.png'])
    })

    it('puts each dropped file on its own line', () => {
        const editor = buildEditor()

        insertDroppedFilesInNote({
            editor,
            files: [imageFile('a.png'), imageFile('b.png')],
            startIndex: 0,
        })

        const populated = linesWithEmbeds(editor).filter(line => line.length > 0)
        expect(populated).toEqual([['a.png'], ['b.png']])
    })

    it('breaks the line first when the drop lands in the middle of existing text', () => {
        const editor = buildEditor('hello world')

        insertDroppedFilesInNote({ editor, files: [imageFile('a.png')], startIndex: 5 })

        const text = editor.getText()
        expect(text.startsWith('hello\n')).toBe(true)
        expect(linesWithEmbeds(editor).filter(line => line.length > 0)).toEqual([['a.png']])
    })

    it('does not add a leading blank line when the drop is already at the start of a line', () => {
        const editor = buildEditor()

        insertDroppedFilesInNote({ editor, files: [imageFile('a.png')], startIndex: 0 })

        expect(editor.getText().startsWith('\n')).toBe(false)
    })

    it('keeps drop order regardless of how the uploads resolve (the original defect)', async () => {
        const editor = buildEditor()
        const files = [imageFile('big.png', 9_000_000), imageFile('small.png', 10), imageFile('mid.png', 500_000)]

        const inserted = handleNoteFilesDrop({
            editor,
            files,
            event: {},
            projectId: 'p1',
            // Resolve in the reverse of drop order, and only after the inserts are done:
            // this is exactly the timing that used to reorder the document.
            uploadOptions: {
                upload: (_editor, _id, name) =>
                    new Promise(resolve => setTimeout(resolve, name === 'small.png' ? 0 : 5)),
            },
        })

        expect(inserted).toHaveLength(3)
        await new Promise(resolve => setTimeout(resolve, 30))
        expect(embedNamesInOrder(editor)).toEqual(['big.png', 'small.png', 'mid.png'])
    })

    it('routes each file type through its matching embed', () => {
        const editor = buildEditor()

        insertDroppedFilesInNote({
            editor,
            files: [imageFile('shot.png'), { name: 'clip.mp4', size: 10 }, { name: 'spec.pdf', size: 10 }],
            startIndex: 0,
        })

        const ops = editor.getContents().ops
        expect(ops.some(op => op.insert?.customImageFormat)).toBe(true)
        expect(ops.some(op => op.insert?.videoFormat)).toBe(true)
        expect(ops.some(op => op.insert?.attachment)).toBe(true)
    })

    it('normalises whitespace in file names, as the single-file path always did', () => {
        const editor = buildEditor()

        const inserted = insertDroppedFilesInNote({
            editor,
            files: [imageFile('my holiday photo.png')],
            startIndex: 0,
        })

        expect(inserted[0].name).toBe('my_holiday_photo.png')
    })

    it('skips a file over the size limit, warns, and still inserts the rest in order', () => {
        const editor = buildEditor()

        const inserted = insertDroppedFilesInNote({
            editor,
            files: [imageFile('ok.png'), imageFile('huge.png', 80 * 1024 * 1024), imageFile('also-ok.png')],
            startIndex: 0,
        })

        expect(global.alert).toHaveBeenCalledTimes(1)
        expect(inserted.map(item => item.name)).toEqual(['ok.png', 'also-ok.png'])
        expect(embedNamesInOrder(editor)).toEqual(['ok.png', 'also-ok.png'])
    })

    it('inserts nothing into a read-only note', () => {
        const editor = buildEditor()
        editor.disable()

        const inserted = handleNoteFilesDrop({ editor, files: [imageFile('a.png')], event: {}, projectId: 'p1' })

        expect(inserted).toEqual([])
        expect(embedNamesInOrder(editor)).toEqual([])
    })

    it('inserts nothing when the project is over its traffic quota', () => {
        checkIsLimitedByTraffic.mockReturnValue(true)
        const editor = buildEditor()

        const inserted = handleNoteFilesDrop({ editor, files: [imageFile('a.png')], event: {}, projectId: 'p1' })

        expect(inserted).toEqual([])
        expect(embedNamesInOrder(editor)).toEqual([])
    })
})

describe('resolving where the drop landed', () => {
    beforeEach(() => {
        global.URL.createObjectURL = jest.fn(file => `blob:${file.name}`)
    })

    afterEach(() => {
        document.body.innerHTML = ''
        delete document.caretRangeFromPoint
        delete document.caretPositionFromPoint
    })

    it('uses the caret under the pointer', () => {
        const editor = buildEditor('hello world')
        const textNode = editor.root.querySelector('p').firstChild
        document.caretRangeFromPoint = jest.fn(() => {
            const range = document.createRange()
            range.setStart(textNode, 5)
            range.setEnd(textNode, 5)
            return range
        })

        expect(resolveDropIndex(editor, { clientX: 40, clientY: 12 })).toBe(5)
    })

    it('supports the caretPositionFromPoint browsers instead', () => {
        const editor = buildEditor('hello world')
        const textNode = editor.root.querySelector('p').firstChild
        document.caretPositionFromPoint = jest.fn(() => ({ offsetNode: textNode, offset: 3 }))

        expect(resolveDropIndex(editor, { clientX: 40, clientY: 12 })).toBe(3)
    })

    it('falls back to the live selection when the point cannot be resolved', () => {
        const editor = buildEditor('hello world')
        document.caretRangeFromPoint = jest.fn(() => null)
        editor.setSelection(4, 0)

        expect(resolveDropIndex(editor, { clientX: 40, clientY: 12 })).toBe(4)
    })

    it('falls back to the end of the note when there is no selection either', () => {
        const editor = buildEditor('hello')
        document.caretRangeFromPoint = jest.fn(() => null)
        editor.setSelection(null)

        expect(resolveDropIndex(editor, { clientX: 40, clientY: 12 })).toBe(editor.getLength())
    })

    it('never returns an index past the end of the document', () => {
        const editor = buildEditor('hi')
        expect(resolveDropIndex(editor, {})).toBeLessThanOrEqual(editor.getLength())
    })

    it('survives a browser that throws from caretRangeFromPoint', () => {
        const editor = buildEditor('hello')
        document.caretRangeFromPoint = jest.fn(() => {
            throw new Error('nope')
        })

        expect(() => resolveDropIndex(editor, { clientX: 1, clientY: 1 })).not.toThrow()
    })
})

describe('bounded upload concurrency', () => {
    it('never runs more uploads at once than the configured limit', async () => {
        let inFlight = 0
        let peak = 0
        const upload = () =>
            new Promise(resolve => {
                inFlight += 1
                peak = Math.max(peak, inFlight)
                setTimeout(() => {
                    inFlight -= 1
                    resolve()
                }, 1)
            })

        const items = Array.from({ length: 9 }, (_, i) => ({ id: `id-${i}`, name: `f${i}.png`, uri: 'blob:x' }))
        await uploadDroppedNoteAttachments({}, items, { concurrency: 3, upload })

        expect(peak).toBe(3)
    })

    it('uploads every dropped file exactly once', async () => {
        const upload = jest.fn(() => Promise.resolve())
        const items = Array.from({ length: 7 }, (_, i) => ({ id: `id-${i}`, name: `f${i}.png`, uri: 'blob:x' }))

        await uploadDroppedNoteAttachments({}, items, { upload })

        expect(upload).toHaveBeenCalledTimes(7)
        expect(new Set(upload.mock.calls.map(call => call[1])).size).toBe(7)
    })

    it('keeps uploading the rest when one file fails', async () => {
        const upload = jest.fn(name => (name === 'id-1' ? Promise.reject(new Error('boom')) : Promise.resolve()))
        const failing = jest.fn((_editor, id) => upload(id))
        jest.spyOn(console, 'warn').mockImplementation(() => {})
        const items = [0, 1, 2].map(i => ({ id: `id-${i}`, name: `f${i}.png`, uri: 'blob:x' }))

        await expect(uploadDroppedNoteAttachments({}, items, { upload: failing })).resolves.toBeUndefined()

        expect(failing).toHaveBeenCalledTimes(3)
        console.warn.mockRestore()
    })

    it('defaults to a small, non-zero concurrency', () => {
        expect(NOTE_ATTACHMENT_UPLOAD_CONCURRENCY).toBeGreaterThan(0)
        expect(NOTE_ATTACHMENT_UPLOAD_CONCURRENCY).toBeLessThan(10)
    })
})

describe('the drop listener itself', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        global.alert = jest.fn()
        global.URL.createObjectURL = jest.fn(file => `blob:${file.name}`)
        checkIsLimitedByTraffic.mockReturnValue(false)
    })

    afterEach(() => {
        document.body.innerHTML = ''
    })

    const dropEvent = files => ({
        clientX: 10,
        clientY: 10,
        dataTransfer: { files, types: files.length ? ['Files'] : [] },
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
    })

    it('takes over the drop and inserts the files', () => {
        const editor = buildEditor()
        const quillModule = new NoteAttachmentDropModule(editor, {
            uploadOptions: { upload: jest.fn(() => Promise.resolve()) },
        })
        const event = dropEvent([imageFile('a.png'), imageFile('b.png')])

        quillModule.onDrop(event)

        expect(event.preventDefault).toHaveBeenCalled()
        expect(embedNamesInOrder(editor)).toEqual(['a.png', 'b.png'])
    })

    it('ignores a drop that carries no files, so dragging text still works', () => {
        const editor = buildEditor('hello')
        const quillModule = new NoteAttachmentDropModule(editor, {})
        const event = dropEvent([])

        quillModule.onDrop(event)

        expect(event.preventDefault).not.toHaveBeenCalled()
        expect(embedNamesInOrder(editor)).toEqual([])
    })

    it('accepts the drag so the browser does not open the file instead', () => {
        const editor = buildEditor()
        const quillModule = new NoteAttachmentDropModule(editor, {})
        const event = { ...dropEvent([imageFile('a.png')]), dataTransfer: { types: ['Files'], dropEffect: 'none' } }

        quillModule.onDragOver(event)

        expect(event.preventDefault).toHaveBeenCalled()
        expect(event.dataTransfer.dropEffect).toBe('copy')
    })

    it('resolves the project id lazily, and survives a resolver that throws', () => {
        const editor = buildEditor()
        const quillModule = new NoteAttachmentDropModule(editor, {
            getProjectId: () => {
                throw new Error('store not ready')
            },
        })

        expect(() => quillModule.onDrop(dropEvent([imageFile('a.png')]))).not.toThrow()
    })

    it('stops listening once the editor is torn down', () => {
        const editor = buildEditor()
        const quillModule = new NoteAttachmentDropModule(editor, {})
        quillModule.destroy()

        editor.root.dispatchEvent(new Event('drop'))

        expect(embedNamesInOrder(editor)).toEqual([])
    })
})

describe('no second handler may insert the same drop again', () => {
    // Quill 2's built-in uploader listens for `drop` on the SAME node and inserts png/jpeg
    // as base64 `image` embeds, which duplicated every dropped screenshot. Listeners on
    // one node cannot stopPropagation each other, so the only fix is to switch it off.
    const toolbarSource = fs.readFileSync(path.join(__dirname, 'EditorToolbar.js'), 'utf8')

    beforeEach(() => {
        jest.clearAllMocks()
        global.alert = jest.fn()
        global.URL.createObjectURL = jest.fn(file => `blob:${file.name}`)
        checkIsLimitedByTraffic.mockReturnValue(false)
    })

    afterEach(() => {
        document.body.innerHTML = ''
        delete document.caretRangeFromPoint
    })

    // Configured exactly like the notes editor: both handlers live, one real drop event.
    const dropOnRealEditor = uploaderOption => {
        const node = document.createElement('div')
        document.body.appendChild(node)
        const quill = new Quill(node, {
            modules: {
                editorMeta: true,
                toolbar: false,
                uploader: uploaderOption,
                noteAttachmentDrop: { uploadOptions: { upload: jest.fn(() => Promise.resolve()) } },
            },
            placeholder: createPlaceholder('Write a note', QUILL_EDITOR_NOTE_TYPE, NOTE_ID),
        })
        document.caretRangeFromPoint = jest.fn(() => null)

        const event = new Event('drop', { bubbles: true, cancelable: true })
        event.clientX = 5
        event.clientY = 5
        event.dataTransfer = { files: [imageFile('shot.png')], types: ['Files'] }
        quill.root.dispatchEvent(event)

        return quill
    }

    it('inserts a dropped png exactly once with the notes editor configuration', () => {
        const quill = dropOnRealEditor(false)

        expect(embedNamesInOrder(quill)).toEqual(['shot.png'])
        expect(quill.getContents().ops.some(op => op.insert?.image)).toBe(false)
    })

    it('is a real conflict: quill 2 also claims the drop when its uploader is left enabled', () => {
        // Guards the reasoning behind `uploader: false` — if a future quill stops handling
        // drops, this test fails and the option can be reconsidered.
        const quill = dropOnRealEditor(true)

        expect(quill.uploader.options.mimetypes).toContain('image/png')
    })

    it('disables the built-in uploader in the notes editor config', () => {
        expect(toolbarSource).toMatch(/uploader:\s*false/)
    })

    it('wires the notes editor to the multi-file drop module', () => {
        expect(toolbarSource).toMatch(/noteAttachmentDrop:\s*{/)
    })

    it('no longer configures the racy quill-drag-and-drop-module', () => {
        expect(toolbarSource).not.toMatch(/from 'quill-drag-and-drop-module'/)
        expect(toolbarSource).not.toMatch(/dragAndDrop:\s*{/)
    })
})
