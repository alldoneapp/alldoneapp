/**
 * @jest-environment jsdom
 *
 * AT-2422. Holding the mic in the MyDay Assistant Line dictated, sent — and left the input
 * FOCUSED, popping the on-screen keyboard back up over a field the user had just emptied by voice.
 *
 * Root cause is an ordering race between two things that both want the caret, neither of which
 * knows about the other:
 *
 *   1. `insertDictatedText` calls `placeDictationCaret`, which sets the caret now and schedules a
 *      `setTimeout(…, 0)` to re-assert it after Quill's own post-mutation selection reconciliation.
 *      That deferred call is a FOCUS operation too: `editor.focus()`, and then a `setSelection`
 *      whose `Selection.setNativeRange` does `if (!this.hasFocus()) this.root.focus()`.
 *   2. `submitDictatedText` arms `useDictationSubmit`, whose POST-COMMIT effect calls the host's
 *      send — `AssistantOptions.handleSendMessage`, which opens with `blur()` + `Keyboard.dismiss()`.
 *
 * React flushes that passive effect through the Scheduler (MessageChannel-backed), which runs
 * ahead of a clamped `setTimeout(0)`. So the real order was blur → dismiss → **focus**, and the
 * blur the host explicitly performs was silently undone on this one path. Button-press and Enter
 * sends were never affected: no dictation timer is pending for them.
 *
 * These tests drive the REAL `useDictationSubmit` hook and the REAL `placeDictationCaret` in the
 * order `RambleButton.handleRecordingComplete` calls them (`onTextReady` then `onSubmit`, same
 * tick), with an editor that models Quill's focus semantics. `act()` flushing the effect before
 * `jest.runAllTimers()` is exactly the production ordering above.
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
import React from 'react'
import renderer, { act } from 'react-test-renderer'

import useDictationSubmit from './dictationSubmit'
import { placeDictationCaret } from './textInputHelper'

const CARET_INDEX = 7

/**
 * Quill's focus semantics, which are the reason this bug exists at all: `setSelection` focuses a
 * blurred editor as a side effect, so "just move the caret" is never just that.
 */
const buildEditor = () => {
    const editor = {
        focused: true,
        focus: () => {
            editor.focused = true
        },
        blur: () => {
            editor.focused = false
        },
        setSelection: () => {
            editor.focused = true
        },
        hasFocus: () => editor.focused,
    }
    return editor
}

/**
 * The dictation pair from CustomTextInput3, reduced to the two calls that matter and keeping their
 * real wiring: the insertion stores the caret canceller, the submit drops it before arming.
 * `cancelCaretOnSubmit: false` reproduces the pre-fix code so the assertions below can be shown to
 * fail against it rather than passing vacuously.
 */
const renderDictationHarness = ({ cancelCaretOnSubmit = true } = {}) => {
    const editor = buildEditor()
    const sent = []
    let wiring = null

    const Input = ({ onDictationSubmit }) => {
        const armDictationSubmit = useDictationSubmit({ onDictationSubmit })
        const cancelCaretRef = React.useRef(null)

        wiring = {
            insertDictatedText: () => {
                cancelCaretRef.current = placeDictationCaret(editor, CARET_INDEX, () => true)
            },
            submitDictatedText: () => {
                if (cancelCaretOnSubmit) {
                    cancelCaretRef.current?.()
                    cancelCaretRef.current = null
                }
                armDictationSubmit(() => 'draft plus transcript')
            },
        }
        return null
    }

    // AssistantOptions.handleSendMessage: blur the input and dismiss the keyboard, then send.
    const Host = () => <Input onDictationSubmit={text => (editor.blur(), sent.push(text))} />

    act(() => {
        renderer.create(<Host />)
    })

    return {
        editor,
        sent,
        // RambleButton.handleRecordingComplete calls onTextReady then onSubmit in the same tick.
        holdMicAndRelease: () =>
            act(() => {
                wiring.insertDictatedText()
                wiring.submitDictatedText()
            }),
        dictateWithoutSending: () =>
            act(() => {
                wiring.insertDictatedText()
            }),
        flushDeferredCaret: () =>
            act(() => {
                jest.runAllTimers()
            }),
    }
}

describe('focus after a push-to-talk dictation submits (AT-2422)', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    test('the input is left blurred once the deferred caret timer has run', () => {
        const { editor, sent, holdMicAndRelease, flushDeferredCaret } = renderDictationHarness()

        holdMicAndRelease()

        // The host's send ran and blurred, as it does for every other send path.
        expect(sent).toEqual(['draft plus transcript'])
        expect(editor.hasFocus()).toBe(false)

        // The end state is what the user sees, so it is asserted after the timer that used to
        // resurrect focus would have fired.
        flushDeferredCaret()
        expect(editor.hasFocus()).toBe(false)
    })

    test('without the cancellation the deferred caret puts focus straight back', () => {
        // The pre-fix code, kept as an executable statement of the defect: every step still
        // "works" (the text is sent, the host blurs) and the field is focused again anyway.
        const { editor, sent, holdMicAndRelease, flushDeferredCaret } = renderDictationHarness({
            cancelCaretOnSubmit: false,
        })

        holdMicAndRelease()
        expect(sent).toEqual(['draft plus transcript'])
        expect(editor.hasFocus()).toBe(false)

        flushDeferredCaret()
        expect(editor.hasFocus()).toBe(true)
    })

    test('a dictation that does NOT submit still ends with the caret in the field', () => {
        // Tapping the mic instead of holding it never calls submitDictatedText (RambleButton only
        // fires onSubmit when the gesture armed one), so the caret placement must survive — the
        // mic click itself blurs the editor, and this is what puts the user back in it.
        const { editor, sent, dictateWithoutSending, flushDeferredCaret } = renderDictationHarness()

        dictateWithoutSending()
        editor.blur()

        flushDeferredCaret()
        expect(editor.hasFocus()).toBe(true)
        expect(sent).toEqual([])
    })
})

describe('the harness above matches the real CustomTextInput3 wiring', () => {
    // Cheap tie-back so the behavioural tests cannot keep passing against a component that has
    // stopped cancelling. Same source-assertion pattern as dictationSubmit.test.js.
    const source = fs.readFileSync(path.join(__dirname, 'CustomTextInput3.js'), 'utf8')

    test('the insertion keeps the caret canceller', () => {
        expect(source).toMatch(/cancelDictationCaretRef\.current = placeDictationCaret\(/)
    })

    test('the submit drops it before arming', () => {
        const submitBody = source.slice(
            source.indexOf('const submitDictatedText = () => {'),
            source.indexOf('//MENTIONS')
        )
        expect(submitBody).toMatch(/cancelDictationCaretRef\.current\?\.\(\)/)
        expect(submitBody.indexOf('cancelDictationCaretRef')).toBeLessThan(submitBody.indexOf('armDictationSubmit('))
    })
})
