/**
 * @jest-environment jsdom
 *
 * AT-2227 regression. Dropping an image into the comment popup uploaded fine but the
 * editor kept rendering a full-width grey placeholder with a spinner that never went
 * away.
 *
 * Root cause: every editor is created with an app-encoded placeholder
 * (`text#editorType#editorId#…`, see createPlaceholder). The quill-2 `editorMeta` module
 * decodes it during init and then OVERWRITES `quill.options.placeholder` with the visible
 * text only, so any later read of `options.placeholder` no longer carries the metadata.
 * `getEditorId` still read it that way, so every embed inserted after init (image, video,
 * attachment, karma) was stamped with `editorId: undefined`. `CustomImageContainer` looks
 * the editor's project up by that id and renders `<LoadingImageVideo />` while it is
 * missing — hence the permanent spinner.
 *
 * These tests drive the REAL quill 2 instance with the REAL editorMeta module, which is
 * the only faithful way to reproduce the stripping.
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

import Quill from 'quill'

import './quill2Setup'
import {
    createPlaceholder,
    getEditorId,
    insertAttachmentInsideEditor,
    QUILL_EDITOR_TEXT_INPUT_TYPE,
} from './textInputHelper'

const EDITOR_ID = 'editor-42'

const buildEditor = (placeholderText = 'Write a comment') => {
    const node = document.createElement('div')
    document.body.appendChild(node)
    const quill = new Quill(node, {
        modules: { editorMeta: true, toolbar: false },
        placeholder: createPlaceholder(placeholderText, QUILL_EDITOR_TEXT_INPUT_TYPE, EDITOR_ID),
    })
    // The embeds themselves are React-rendering blots that are not registered here; the
    // delta is what carries the editorId, so intercept it instead of committing it.
    jest.spyOn(quill, 'updateContents').mockImplementation(() => {})
    jest.spyOn(quill, 'setSelection').mockImplementation(() => {})
    return quill
}

const insertedEmbed = (quill, blotName) => {
    const delta = quill.updateContents.mock.calls[0][0]
    return delta.ops.find(op => op.insert && op.insert[blotName])?.insert[blotName]
}

describe('editor metadata after the editorMeta module strips the placeholder', () => {
    afterEach(() => {
        document.body.innerHTML = ''
        jest.restoreAllMocks()
    })

    it('strips the encoded metadata off the visible placeholder (the condition that broke this)', () => {
        const quill = buildEditor()
        expect(quill.options.placeholder).toBe('Write a comment')
        expect(quill.editorMeta.editorId).toBe(EDITOR_ID)
    })

    it('resolves the editorId from the decoded metadata, not from options.placeholder', () => {
        expect(getEditorId(buildEditor())).toBe(EDITOR_ID)
    })

    it('still resolves the editorId on a headless editor that never ran the editorMeta module', () => {
        const quill = { options: { placeholder: createPlaceholder('Notes', QUILL_EDITOR_TEXT_INPUT_TYPE, 'note-7') } }
        expect(getEditorId(quill)).toBe('note-7')
    })

    it('does not throw on an editor with no placeholder at all', () => {
        expect(getEditorId({ options: {} })).toBeUndefined()
        expect(getEditorId(undefined)).toBeUndefined()
    })

    it('stamps a dropped image embed with the real editorId', () => {
        const quill = buildEditor()
        insertAttachmentInsideEditor(0, quill, 'screenshot.png', 'blob:screenshot')
        expect(insertedEmbed(quill, 'customImageFormat')).toEqual(
            expect.objectContaining({ editorId: EDITOR_ID, text: 'screenshot.png', uri: 'blob:screenshot' })
        )
    })

    it('stamps a dropped video embed with the real editorId', () => {
        const quill = buildEditor()
        insertAttachmentInsideEditor(0, quill, 'clip.mp4', 'blob:clip')
        expect(insertedEmbed(quill, 'videoFormat')).toEqual(expect.objectContaining({ editorId: EDITOR_ID }))
    })

    it('stamps a dropped file attachment with the real editorId', () => {
        const quill = buildEditor()
        insertAttachmentInsideEditor(0, quill, 'notes.pdf', 'blob:notes')
        expect(insertedEmbed(quill, 'attachment')).toEqual(expect.objectContaining({ editorId: EDITOR_ID }))
    })
})
