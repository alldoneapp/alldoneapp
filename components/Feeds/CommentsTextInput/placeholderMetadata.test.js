/**
 * @jest-environment jsdom
 *
 * AT-2438 regression. The comment composer rendered its placeholder as
 * "Type to add new comment#0#d53db6ac-e144-4fee-8fab-…" — the app's own encoded editor
 * metadata, in front of the user.
 *
 * Root cause: the placeholder is the app's metadata channel
 * (`text#editorType#editorId#…`, see createPlaceholder), and the `editorMeta` module
 * decodes it ONCE, in the Quill constructor. But the module is not the only writer of the
 * attribute the placeholder is actually rendered from — react-quill-new's
 * componentDidUpdate assigns `this.props.placeholder` straight to
 * `editor.root.dataset.placeholder` on every change of the prop, behind the module's
 * back. Any placeholder change therefore exposed the raw encoding, and the chat composer
 * has one on every login whose device locale differs from the account language:
 * `translate()` resolves against `i18n.locale`, which starts as the DEVICE language and
 * is switched to `loggedUser.language` by `useTranslator` once the user doc arrives.
 *
 * These tests drive the REAL quill 2 through the REAL react-quill-new with the REAL
 * editorMeta module — a mocked editor cannot reproduce this, because the defect is
 * precisely the interaction between the two writers of one DOM attribute.
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

import React from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import ReactQuill from 'react-quill-new'

import './quill2Setup'
import {
    createPlaceholder,
    isEncodedPlaceholder,
    QUILL_EDITOR_NOTE_TYPE,
    QUILL_EDITOR_TEXT_INPUT_TYPE,
} from './textInputHelper'

const EDITOR_ID = 'd53db6ac-e144-4fee-8fab-4b0c1f2a9e77'
const LOGGED_USER_ID = 'lejVqrT6FBcMRRCxnBbBhQwPgSg1'

// Exactly what CustomTextInput3 hands <ReactQuill>.
const textInputPlaceholder = visibleText =>
    createPlaceholder(visibleText, QUILL_EDITOR_TEXT_INPUT_TYPE, EDITOR_ID, undefined, undefined, LOGGED_USER_ID)

const MODULES = { editorMeta: true, toolbar: false }

const visiblePlaceholder = container => container.querySelector('.ql-editor').getAttribute('data-placeholder')

// The module heals the attribute from a MutationObserver callback, i.e. a microtask —
// which the browser runs before it can paint, so the raw value is never rendered. The
// test has to reach the same checkpoint.
const afterMutationObservers = () => act(async () => {})

describe('the encoded placeholder never reaches the user (AT-2438)', () => {
    let container
    let root

    beforeAll(() => {
        // React 18 concurrent `act` support; without it every render logs a warning that
        // buries the assertions.
        global.IS_REACT_ACT_ENVIRONMENT = true
    })

    beforeEach(() => {
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        document.body.innerHTML = ''
    })

    const render = placeholder =>
        act(() => {
            root.render(<ReactQuill modules={MODULES} value="" placeholder={placeholder} />)
        })

    it('decodes the placeholder the editor is constructed with', () => {
        render(textInputPlaceholder('Type to add new comment'))

        expect(visiblePlaceholder(container)).toBe('Type to add new comment')
    })

    it('decodes it again when the placeholder prop changes — the reported defect', async () => {
        // The composer as it first renders, against the DEVICE locale.
        render(textInputPlaceholder('Trage hier einen neuen Kommentar ein'))
        expect(visiblePlaceholder(container)).toBe('Trage hier einen neuen Kommentar ein')

        // `useTranslator` switches i18n to the account language and re-renders. This is a
        // plain prop change; before the fix it left the raw encoding in the DOM.
        render(textInputPlaceholder('Type to add new comment'))
        await afterMutationObservers()

        expect(visiblePlaceholder(container)).toBe('Type to add new comment')
        expect(isEncodedPlaceholder(visiblePlaceholder(container))).toBe(false)
    })

    it('keeps the editor metadata itself intact across that change', async () => {
        render(textInputPlaceholder('Trage hier einen neuen Kommentar ein'))
        render(textInputPlaceholder('Type to add new comment'))
        await afterMutationObservers()

        // The decoding must not cost the editor its identity: the per-editor classes and
        // `quill.editorMeta` are what every embed, project lookup and toolbar action
        // resolve through (AT-2227).
        expect(container.querySelector(`.ql-editor-${EDITOR_ID}`)).not.toBeNull()
        expect(container.querySelector(`.ql-container-${EDITOR_ID}`)).not.toBeNull()
    })

    it('covers the notes editor too, which encodes the note id the same way', async () => {
        const noteId = '-P-x-dz1W9q8rdZ0giSX'
        render(createPlaceholder('Type your note...', QUILL_EDITOR_NOTE_TYPE, noteId))
        render(createPlaceholder('Schreibe deine Notiz...', QUILL_EDITOR_NOTE_TYPE, noteId))
        await afterMutationObservers()

        expect(visiblePlaceholder(container)).toBe('Schreibe deine Notiz...')
    })

    it('is idempotent — a decoded placeholder is never decoded a second time', async () => {
        // The guard rewrites the attribute it observes, so it observes its own write. It
        // is only safe because it keys on the encoding's SHAPE (six separators) rather
        // than on the separator: the decoded value it writes is no longer encoded, so the
        // second pass is a no-op and there is no loop. A prefix that itself contains a
        // '#' is the case that would expose a naive "split at the first #" guard.
        render(textInputPlaceholder('Add a #hashtag to this comment'))
        render(textInputPlaceholder('Füge diesem Kommentar ein #Hashtag hinzu'))
        await afterMutationObservers()
        const settled = visiblePlaceholder(container)

        await afterMutationObservers()
        await afterMutationObservers()

        expect(visiblePlaceholder(container)).toBe(settled)
        expect(isEncodedPlaceholder(settled)).toBe(false)
    })
})

describe('isEncodedPlaceholder', () => {
    it('recognises what createPlaceholder produces, whatever is omitted', () => {
        expect(isEncodedPlaceholder(createPlaceholder('Text', QUILL_EDITOR_TEXT_INPUT_TYPE, EDITOR_ID))).toBe(true)
        expect(isEncodedPlaceholder(createPlaceholder('Text'))).toBe(true)
        expect(
            isEncodedPlaceholder(
                createPlaceholder(
                    'Text',
                    QUILL_EDITOR_TEXT_INPUT_TYPE,
                    EDITOR_ID,
                    'numeric',
                    true,
                    LOGGED_USER_ID,
                    true
                )
            )
        ).toBe(true)
    })

    it('does not mistake ordinary text for it', () => {
        expect(isEncodedPlaceholder('Type to add new comment')).toBe(false)
        expect(isEncodedPlaceholder('Add a #hashtag')).toBe(false)
        expect(isEncodedPlaceholder('')).toBe(false)
        expect(isEncodedPlaceholder(null)).toBe(false)
        expect(isEncodedPlaceholder(undefined)).toBe(false)
    })
})
