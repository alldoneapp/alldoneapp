/**
 * @jest-environment jsdom
 *
 * AT-2440. "When I paste something into an input field and then press Undo, the pasted text is
 * not undone but rather what I did before."
 *
 * Root cause: `beforeUndoRedo` read a history stack entry the QUILL 1 way
 * (`stack.undo[last].undo.type`). Quill 2 stores `{ delta, range }`, so that is `undefined.type`
 * — a TypeError on every undo and redo, in every editor in the app, since the Stage 4 migration.
 *
 * The throw is what makes the symptom so confusing. Quill calls `history.undo()` from inside its
 * keydown binding and from its `beforeinput` handler, and both reach `event.preventDefault()`
 * only AFTER that call returns. An exception skips the preventDefault, so the keystroke (or the
 * browser/OS "Undo" command, which arrives as `beforeinput` with `inputType: 'historyUndo'`)
 * falls through to the browser's own contenteditable undo. That native stack only holds edits the
 * browser itself made — typing — because every paste here is `preventDefault()`ed and applied
 * programmatically. Hence: undo skipped the paste and reverted the earlier typing.
 *
 * These tests drive the REAL quill 2 with the REAL quill2Setup modules. A mocked history module
 * could not reproduce any of it: the defect lives entirely in how the app's hook and quill's own
 * stack shape compose.
 */
jest.mock('../../../utils/BackendBridge', () => ({ updateHastagsColors: jest.fn() }))
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
import Backend from '../../../utils/BackendBridge'
import { beforeUndoRedo, createPlaceholder, QUILL_EDITOR_TEXT_INPUT_TYPE } from './textInputHelper'
import {
    buildHashtagColorHistoryEntry,
    isolatePasteInHistory,
    isQuillHistoryEntry,
    transformHistoryStack,
} from './quillHistoryEntries'

const Delta = Quill.import('delta')

// Quill measures the caret on every setSelection; jsdom has no layout.
const stubLayout = () => {
    const rect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 })
    Range.prototype.getBoundingClientRect = rect
    Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} })
    Element.prototype.getBoundingClientRect = rect
    Element.prototype.scrollIntoView = () => {}
}

const buildEditor = () => {
    stubLayout()
    const node = document.createElement('div')
    document.body.appendChild(node)
    const quill = new Quill(node, {
        modules: {
            editorMeta: true,
            toolbar: false,
            history: { maxStack: 100, userOnly: true, beforeUndoRedo },
        },
        placeholder: createPlaceholder(
            'Write something',
            QUILL_EDITOR_TEXT_INPUT_TYPE,
            'editor-2440',
            undefined,
            false,
            undefined,
            false
        ),
    })
    quill.setContents([{ insert: '\n' }])
    quill.history.clear()
    return quill
}

// What the browser's Clipboard module does on a real paste, minus the DataTransfer jsdom lacks.
const paste = (quill, index, length, text) => {
    quill.setSelection(index, length)
    quill.clipboard.onPaste({ index, length }, { text, html: '' })
}

describe('AT-2440 — undo after a paste', () => {
    beforeEach(() => jest.clearAllMocks())

    describe('the hook no longer throws on quill 2 stack entries', () => {
        it('returns undefined for an ordinary edit so quill keeps control of it', () => {
            const quill = buildEditor()
            quill.insertText(0, 'Hello', 'user')

            expect(quill.history.stack.undo).toHaveLength(1)
            expect(isQuillHistoryEntry(quill.history.stack.undo[0])).toBe(true)
            expect(() => beforeUndoRedo(quill.history.stack, 'undo', 'redo')).not.toThrow()
            expect(beforeUndoRedo(quill.history.stack, 'undo', 'redo')).toBeUndefined()
            // and it must not have consumed the entry
            expect(quill.history.stack.undo).toHaveLength(1)
        })

        it('survives an empty stack', () => {
            const quill = buildEditor()
            expect(() => beforeUndoRedo(quill.history.stack, 'undo', 'redo')).not.toThrow()
            expect(() => quill.history.undo()).not.toThrow()
        })
    })

    describe('the keystroke never escapes to the browser', () => {
        // The load-bearing assertion: whatever happens inside undo, quill MUST get to
        // preventDefault(), or the browser's native contenteditable undo runs instead — and that
        // stack has no record of a programmatic paste.
        const pressUndo = quill => {
            quill.focus()
            quill.setSelection(quill.getLength() - 1, 0)
            // Quill's binding carries exactly one of ctrlKey/metaKey (`shortKey`), and its
            // matcher rejects the event when the other one is set too.
            const onMac = /Mac/i.test(navigator.platform)
            const event = new KeyboardEvent('keydown', {
                key: 'z',
                ctrlKey: !onMac,
                metaKey: onMac,
                bubbles: true,
                cancelable: true,
            })
            quill.root.dispatchEvent(event)
            return event
        }

        it('preventDefaults ctrl/cmd+z', () => {
            const quill = buildEditor()
            quill.insertText(0, 'Hello', 'user')

            expect(pressUndo(quill).defaultPrevented).toBe(true)
            expect(quill.getText()).toBe('\n')
        })

        it('still preventDefaults when the hook itself throws', () => {
            const quill = buildEditor()
            const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
            quill.history.options.beforeUndoRedo = () => {
                throw new TypeError("Cannot read properties of undefined (reading 'type')")
            }
            quill.insertText(0, 'Hello', 'user')

            expect(pressUndo(quill).defaultPrevented).toBe(true)
            expect(quill.getText()).toBe('\n')
            expect(consoleError).toHaveBeenCalled()
            consoleError.mockRestore()
        })

        it('preventDefaults the browser/OS Undo command (beforeinput historyUndo)', () => {
            // This is the path the user's "Undo button" takes: a browser menu item, an on-screen
            // mobile undo affordance and the macOS Edit menu all arrive as `beforeinput`.
            const quill = buildEditor()
            quill.insertText(0, 'Hello', 'user')

            const event = new InputEvent('beforeinput', {
                inputType: 'historyUndo',
                bubbles: true,
                cancelable: true,
            })
            quill.root.dispatchEvent(event)

            expect(event.defaultPrevented).toBe(true)
            expect(quill.getText()).toBe('\n')
        })
    })

    describe('a paste is undone as the most recent edit', () => {
        it('undoes the paste, not what was typed before it', () => {
            const quill = buildEditor()
            quill.insertText(0, 'Hello', 'user')
            paste(quill, 5, 0, 'PASTED')
            expect(quill.getText()).toBe('HelloPASTED\n')

            quill.history.undo()

            expect(quill.getText()).toBe('Hello\n')
        })

        it('keeps the paste a discrete step even when it lands within the coalescing delay', () => {
            // Quill merges everything inside `history.delay` (1s) into one entry. Typing and then
            // immediately pasting used to produce a single entry, so one undo wiped both.
            const quill = buildEditor()
            quill.insertText(0, 'Hello', 'user')
            paste(quill, 5, 0, 'PASTED')

            expect(quill.history.stack.undo).toHaveLength(2)
            quill.history.undo()
            expect(quill.getText()).toBe('Hello\n')
        })

        it('does not let the next keystrokes merge into the paste entry', () => {
            const quill = buildEditor()
            paste(quill, 0, 0, 'PASTED')
            quill.insertText(6, '!', 'user')

            quill.history.undo()
            expect(quill.getText()).toBe('PASTED\n')

            quill.history.undo()
            expect(quill.getText()).toBe('\n')
        })

        it('restores text the paste replaced', () => {
            const quill = buildEditor()
            quill.insertText(0, 'Hello world', 'user')
            paste(quill, 6, 5, 'there')
            expect(quill.getText()).toBe('Hello there\n')

            quill.history.undo()

            expect(quill.getText()).toBe('Hello world\n')
        })

        it('redo puts the paste back', () => {
            const quill = buildEditor()
            quill.insertText(0, 'Hello', 'user')
            paste(quill, 5, 0, 'PASTED')

            quill.history.undo()
            expect(quill.getText()).toBe('Hello\n')

            quill.history.redo()
            expect(quill.getText()).toBe('HelloPASTED\n')
        })

        it('undoes consecutive pastes one at a time', () => {
            const quill = buildEditor()
            paste(quill, 0, 0, 'one')
            paste(quill, 3, 0, 'two')
            expect(quill.getText()).toBe('onetwo\n')

            quill.history.undo()
            expect(quill.getText()).toBe('one\n')

            quill.history.undo()
            expect(quill.getText()).toBe('\n')
        })
    })

    describe('typing behaviour is unchanged', () => {
        it('still coalesces a burst of typing into one undo step', () => {
            const quill = buildEditor()
            quill.insertText(0, 'a', 'user')
            quill.insertText(1, 'b', 'user')
            quill.insertText(2, 'c', 'user')

            expect(quill.history.stack.undo).toHaveLength(1)
            quill.history.undo()
            expect(quill.getText()).toBe('\n')
        })

        it('keeps separate steps once the delay window has passed', () => {
            const quill = buildEditor()
            quill.insertText(0, 'abc', 'user')
            quill.history.cutoff()
            quill.insertText(3, 'def', 'user')

            quill.history.undo()
            expect(quill.getText()).toBe('abc\n')
        })

        it('leaves programmatic edits out of the stack (userOnly)', () => {
            const quill = buildEditor()
            quill.insertText(0, 'typed', 'user')
            quill.insertText(5, ' api', 'api')

            expect(quill.history.stack.undo).toHaveLength(1)
        })
    })

    describe('app-owned marker entries (hashtag colours) can never wedge the stack', () => {
        const pushColorEntry = quill =>
            quill.history.stack.undo.push(
                buildHashtagColorHistoryEntry({
                    objectId: 'project-1',
                    text: '#tag',
                    colorKey: 'blue',
                    previousColorKey: 'red',
                })
            )

        it('is claimed by the hook instead of being handed to quill', () => {
            const quill = buildEditor()
            quill.insertText(0, 'Hello', 'user')
            pushColorEntry(quill)

            quill.history.undo()

            expect(Backend.updateHastagsColors).toHaveBeenCalledWith('project-1', '#tag', 'red', true)
            // the document is untouched, and the entry moved to the redo stack
            expect(quill.getText()).toBe('Hello\n')
            expect(quill.history.stack.undo).toHaveLength(1)
            expect(quill.history.stack.redo).toHaveLength(1)

            quill.history.redo()
            expect(Backend.updateHastagsColors).toHaveBeenLastCalledWith('project-1', '#tag', 'blue', true)
        })

        it('does not crash the merge quill performs while recording the next keystroke', () => {
            const quill = buildEditor()
            quill.insertText(0, 'Hello', 'user')
            pushColorEntry(quill)

            // Inside the 1s delay quill pops the previous entry and composes deltas with it.
            expect(() => quill.insertText(5, '!', 'user')).not.toThrow()
            expect(quill.getText()).toBe('Hello!\n')

            quill.history.undo()
            expect(quill.getText()).toBe('Hello\n')
        })

        it('does not crash the stack transform a non-user change performs', () => {
            const quill = buildEditor()
            quill.insertText(0, 'Hello', 'user')
            pushColorEntry(quill)

            // `userOnly: true` routes every programmatic/remote change through transform().
            expect(() => quill.insertText(0, 'remote ', 'api')).not.toThrow()
            expect(quill.getText()).toBe('remote Hello\n')
        })

        it('is dropped rather than thrown on when no hook claims it', () => {
            const quill = buildEditor()
            quill.insertText(0, 'Hello', 'user')
            pushColorEntry(quill)
            quill.history.options.beforeUndoRedo = undefined

            expect(() => quill.history.undo()).not.toThrow()
            expect(quill.getText()).toBe('\n')
        })
    })

    describe('transformHistoryStack', () => {
        it('threads a remote delta past app entries without touching them', () => {
            const appEntry = buildHashtagColorHistoryEntry({
                objectId: 'p',
                text: '#tag',
                colorKey: 'blue',
                previousColorKey: 'red',
            })
            const stack = [{ delta: new Delta().retain(0).insert('x'), range: null }, appEntry]

            expect(() => transformHistoryStack(stack, new Delta().insert('remote '))).not.toThrow()

            expect(stack[stack.length - 1]).toBe(appEntry)
        })
    })

    describe('isolatePasteInHistory', () => {
        it('cuts the coalescing window on both sides of the paste', () => {
            const cutoff = jest.fn()
            const editor = { history: { cutoff } }
            const applied = []

            isolatePasteInHistory(editor, () => applied.push(cutoff.mock.calls.length))

            expect(applied).toEqual([1])
            expect(cutoff).toHaveBeenCalledTimes(2)
        })

        it('still closes the window when the paste throws', () => {
            const cutoff = jest.fn()
            expect(() =>
                isolatePasteInHistory({ history: { cutoff } }, () => {
                    throw new Error('boom')
                })
            ).toThrow('boom')
            expect(cutoff).toHaveBeenCalledTimes(2)
        })

        it('is a no-op for an editor with no history module', () => {
            const apply = jest.fn(() => 'done')
            expect(isolatePasteInHistory({}, apply)).toBe('done')
            expect(isolatePasteInHistory(null, apply)).toBe('done')
        })
    })
})
