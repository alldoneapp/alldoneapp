/**
 * @jest-environment jsdom
 *
 * Pure-delta contract for rambler dictation insertion: replace the selection, keep spacing sane,
 * collapse single-line inputs, and report the caret position the editor should end up at.
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

import Delta from 'quill-delta'

import { buildDictationDelta, normalizeDictatedText, placeDictationCaret } from './textInputHelper'

describe('normalizeDictatedText', () => {
    test('trims surrounding whitespace', () => {
        expect(normalizeDictatedText('  hello world \n', false)).toBe('hello world')
    })

    test('collapses all whitespace to single spaces for single-line inputs', () => {
        expect(normalizeDictatedText('Buy milk\nand eggs\n\ttomorrow', true)).toBe('Buy milk and eggs tomorrow')
    })

    test('keeps line breaks for multi-line inputs', () => {
        expect(normalizeDictatedText('First line\nSecond line', false)).toBe('First line\nSecond line')
    })

    test('non-string input becomes an empty string', () => {
        expect(normalizeDictatedText(undefined, true)).toBe('')
        expect(normalizeDictatedText(null, false)).toBe('')
    })
})

describe('buildDictationDelta', () => {
    const content = text => new Delta().insert(text)

    test('inserts at the caret and reports the caret after the inserted text', () => {
        const { delta, caretIndex } = buildDictationDelta({
            Delta,
            contentDelta: content('hello'),
            index: 4,
            length: 0,
            needsLeadingSpace: false,
        })
        expect(delta.ops).toEqual([{ retain: 4 }, { insert: 'hello' }])
        expect(caretIndex).toBe(9)
    })

    test('replaces the selection when one exists', () => {
        const { delta, caretIndex } = buildDictationDelta({
            Delta,
            contentDelta: content('replacement'),
            index: 2,
            length: 5,
            needsLeadingSpace: false,
        })
        // quill-delta normalizes to insert-before-delete at the same position; both orders apply
        // identically, so assert via composition on a real document instead of on op order.
        const document = new Delta().insert('0123456789\n')
        expect(delta.compose.bind(delta)).toBeDefined()
        expect(document.compose(delta).ops).toEqual([{ insert: '01replacement789\n' }])
        expect(caretIndex).toBe(2 + 'replacement'.length)
    })

    test('adds a separating space when the preceding character is not whitespace', () => {
        const { delta, caretIndex } = buildDictationDelta({
            Delta,
            contentDelta: content('next'),
            index: 3,
            length: 0,
            needsLeadingSpace: true,
        })
        const document = new Delta().insert('abc\n')
        expect(document.compose(delta).ops).toEqual([{ insert: 'abc next\n' }])
        expect(caretIndex).toBe(3 + 1 + 'next'.length)
    })

    test('counts embed inserts as length 1 for the caret position', () => {
        const contentDelta = new Delta().insert('see ').insert({ mention: { id: 'u1' } })
        const { caretIndex } = buildDictationDelta({
            Delta,
            contentDelta,
            index: 0,
            length: 0,
            needsLeadingSpace: false,
        })
        expect(caretIndex).toBe(5)
    })
})

describe('placeDictationCaret', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    const buildEditor = () => ({ setSelection: jest.fn(), focus: jest.fn() })

    test("sets the caret immediately AND re-asserts it after Quill's update cycle", () => {
        const editor = buildEditor()
        placeDictationCaret(editor, 12, () => true)

        // Immediate set covers the common case…
        expect(editor.setSelection).toHaveBeenCalledWith(12, 0, 'user')
        expect(editor.setSelection).toHaveBeenCalledTimes(1)

        // …the deferred set wins over Quill's own post-mutation selection reconciliation,
        // which would otherwise leave the caret before the inserted text.
        jest.runAllTimers()
        expect(editor.focus).toHaveBeenCalled()
        expect(editor.setSelection).toHaveBeenCalledTimes(2)
        expect(editor.setSelection).toHaveBeenLastCalledWith(12, 0, 'user')
    })

    test('skips the deferred set when the editor is no longer live', () => {
        const editor = buildEditor()
        placeDictationCaret(editor, 5, () => false)

        jest.runAllTimers()
        expect(editor.setSelection).toHaveBeenCalledTimes(1)
        expect(editor.focus).not.toHaveBeenCalled()
    })
})
