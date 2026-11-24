/**
 * @jest-environment jsdom
 *
 * AT-3140 regression: deleting the text line under a dropped image must keep the image.
 *
 * `insertCustomImage` puts an image into the SAME Quill line as whatever is typed after it
 * (`' ' + embed + ' '`, no line break), while `CustomImage` renders it as a full-width block, so
 * it looks like a line of its own. With the embed span left inline, Chromium put the start of the
 * text line below it BEFORE the embed: Shift+Home selected `{ index: 1, length: 13 }` instead of
 * `{ index: 2, length: 12 }`, and Backspace removed the image together with the text.
 *
 * The fix is the `styles.css` rule that renders the composer's media embeds as blocks. Where the
 * browser puts a line boundary depends on layout, which jsdom does not compute, so the end-to-end
 * proof (real Chromium, real composer, Shift+Home / Shift+Left / Shift+Up) is
 * `browser-tests/at3140/run.js`. This suite pins the two halves Jest can see:
 *   1. the CSS rule applies to the composer's image and video embeds, and only there;
 *   2. with a REAL quill 2 and the REAL insertion helper, deleting the selection Shift+Home now
 *      makes keeps the image, and deleting a selection that includes the image removes it.
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

import fs from 'fs'
import path from 'path'
import Quill from 'quill'

import './quill2Setup'
import { createPlaceholder, insertAttachmentInsideEditor, QUILL_EDITOR_TEXT_INPUT_TYPE } from './textInputHelper'

// jsdom has no layout; quill's scroll-into-view only needs a rect to exist.
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
Range.prototype.getClientRects = () => Object.assign([], { item: () => null })

const STYLES = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8')
const TEXT = 'hello world'

// The real blots render React + redux; their DOM is irrelevant to the delete semantics, so a
// plain embed with the same blot names and class names stands in for them here (the browser test
// uses the real ones).
const Embed = Quill.import('blots/embed')
for (const [blotName, className] of [
    ['customImageFormat', 'ql-customImageFormat'],
    ['videoFormat', 'ql-videoFormat'],
]) {
    class MediaEmbed extends Embed {
        static create(value) {
            const node = super.create(value)
            node.setAttribute('contenteditable', false)
            node.setAttribute('data-value', JSON.stringify(value))
            return node
        }
        static value(node) {
            return JSON.parse(node.getAttribute('data-value'))
        }
    }
    MediaEmbed.blotName = blotName
    MediaEmbed.className = className
    MediaEmbed.tagName = 'span'
    Quill.register(MediaEmbed, true)
}

const buildComposer = () => {
    const style = document.createElement('style')
    style.textContent = STYLES
    document.head.appendChild(style)
    const node = document.createElement('div')
    document.body.appendChild(node)
    const quill = new Quill(node, {
        modules: { editorMeta: true, toolbar: false },
        placeholder: createPlaceholder('Type to add new comment', QUILL_EDITOR_TEXT_INPUT_TYPE, 'chat-editor'),
        formats: ['customImageFormat', 'videoFormat'],
    })
    // What CustomTextInput3 adds to every composer container.
    quill.container.classList.add('ql-textInputContainer')
    return quill
}

// The chat composer flow: drop an image (inserted where the caret is), keep typing below it.
const imageThenText = quill => {
    insertAttachmentInsideEditor(0, quill, 'screenshot.png', 'blob:screenshot')
    const caret = quill.getSelection().index
    quill.insertText(caret, TEXT, 'user')
    quill.setSelection(caret + TEXT.length, 0, 'user')
    return quill
}

const embedIndex = (quill, blotName) => {
    let index = 0
    for (const op of quill.getContents().ops) {
        if (op.insert && op.insert[blotName]) return index
        index += typeof op.insert === 'string' ? op.insert.length : 1
    }
    return -1
}
const countEmbeds = (quill, blotName) => quill.getContents().ops.filter(op => op.insert && op.insert[blotName]).length

const pressKey = (quill, key) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    quill.root.dispatchEvent(event)
    return event
}

afterEach(() => {
    document.body.innerHTML = ''
    document.head.innerHTML = ''
})

describe('AT-3140 composer CSS: media embeds render as blocks', () => {
    it.each(['ql-customImageFormat', 'ql-videoFormat'])('renders %s as a block inside a composer', className => {
        const quill = buildComposer()
        const span = document.createElement('span')
        span.className = className
        quill.root.appendChild(span)

        const computed = window.getComputedStyle(span)
        expect(computed.display).toBe('block')
        // Collapses the line boxes of quill's cursor guards, which would otherwise add an
        // empty line above and below the media.
        expect(computed.lineHeight).toBe('0')
    })

    it('leaves an editor that is not a composer (e.g. the notes editor) untouched', () => {
        const style = document.createElement('style')
        style.textContent = STYLES
        document.head.appendChild(style)
        const container = document.createElement('div')
        container.className = 'ql-container'
        container.innerHTML = '<div class="ql-editor"><p><span class="ql-customImageFormat"></span></p></div>'
        document.body.appendChild(container)

        expect(window.getComputedStyle(container.querySelector('.ql-customImageFormat')).display).not.toBe('block')
    })

    it('leaves inline chips such as file attachments inline', () => {
        const quill = buildComposer()
        const span = document.createElement('span')
        span.className = 'ql-attachment'
        quill.root.appendChild(span)

        expect(window.getComputedStyle(span).display).not.toBe('block')
    })
})

describe('AT-3140 deleting around an image in the composer (real quill 2)', () => {
    it('puts the image inline in the same quill line as the text typed after it', () => {
        // The structure the fix has to live with: not a separate line in the document.
        const quill = imageThenText(buildComposer())
        expect(quill.getLines()).toHaveLength(1)
        expect(embedIndex(quill, 'customImageFormat')).toBe(1)
        expect(quill.getText()).toBe(`  ${TEXT}\n`)
    })

    it('Backspace on the text line selection (what Shift+Home selects) keeps the image', () => {
        const quill = imageThenText(buildComposer())
        const lineStart = embedIndex(quill, 'customImageFormat') + 1
        quill.setSelection(lineStart, quill.getLength() - 1 - lineStart, 'user')

        const event = pressKey(quill, 'Backspace')

        expect(event.defaultPrevented).toBe(true)
        expect(countEmbeds(quill, 'customImageFormat')).toBe(1)
        expect(quill.getText()).not.toContain('hello')
        expect(quill.getSelection().index).toBe(lineStart)
    })

    it('Delete on the text line selection keeps the image', () => {
        const quill = imageThenText(buildComposer())
        const lineStart = embedIndex(quill, 'customImageFormat') + 1
        quill.setSelection(lineStart, quill.getLength() - 1 - lineStart, 'user')

        pressKey(quill, 'Delete')

        expect(countEmbeds(quill, 'customImageFormat')).toBe(1)
        expect(quill.getText()).not.toContain('hello')
    })

    it('still deletes the image when the selection deliberately includes it', () => {
        const quill = imageThenText(buildComposer())
        const imageIndex = embedIndex(quill, 'customImageFormat')
        quill.setSelection(imageIndex, quill.getLength() - 1 - imageIndex, 'user')

        pressKey(quill, 'Backspace')

        expect(countEmbeds(quill, 'customImageFormat')).toBe(0)
        expect(quill.getText()).not.toContain('hello')
    })

    it('still deletes a selected image on its own', () => {
        const quill = imageThenText(buildComposer())
        const imageIndex = embedIndex(quill, 'customImageFormat')
        quill.setSelection(imageIndex, 1, 'user')

        pressKey(quill, 'Backspace')

        expect(countEmbeds(quill, 'customImageFormat')).toBe(0)
        expect(quill.getText()).toBe(`  ${TEXT}\n`)
    })

    it('still deletes the image with Backspace from the start of the text line', () => {
        const quill = imageThenText(buildComposer())
        quill.setSelection(embedIndex(quill, 'customImageFormat') + 1, 0, 'user')

        pressKey(quill, 'Backspace')

        expect(countEmbeds(quill, 'customImageFormat')).toBe(0)
        expect(quill.getText()).toBe(`  ${TEXT}\n`)
    })
})
