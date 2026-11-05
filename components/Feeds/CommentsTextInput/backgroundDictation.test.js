/**
 * PT-5425: where a transcript lands when the add-task popup has already closed. The draft is split
 * at the caret on release (CustomTextInput3.captureBackgroundDictationComposer) and the transcript
 * goes between the halves — the position the interactive path inserts it at.
 */
import fs from 'fs'
import path from 'path'

import { composeDictationAroundCaret, mergeLinkedUrls } from './backgroundDictation'

describe('composeDictationAroundCaret', () => {
    test('empty draft: just the transcript', () => {
        expect(composeDictationAroundCaret({ dictatedText: 'Zahnarzt anrufen' })).toBe('Zahnarzt anrufen')
    })

    test('caret at the end: appended after a space', () => {
        expect(composeDictationAroundCaret({ beforeText: 'Bitte', dictatedText: 'Zahnarzt anrufen' })).toBe(
            'Bitte Zahnarzt anrufen'
        )
    })

    test('caret in the middle: inserted there, separated on both sides', () => {
        expect(
            composeDictationAroundCaret({ beforeText: 'Morgen', afterText: 'erledigen', dictatedText: 'Steuer' })
        ).toBe('Morgen Steuer erledigen')
    })

    test('existing whitespace is not doubled', () => {
        expect(
            composeDictationAroundCaret({ beforeText: 'Morgen ', afterText: ' erledigen', dictatedText: 'Steuer' })
        ).toBe('Morgen Steuer erledigen')
    })

    test('caret at the start', () => {
        expect(composeDictationAroundCaret({ afterText: '@Anna#u1', dictatedText: 'Frag' })).toBe('Frag @Anna#u1')
    })

    test('nothing dictated never yields the untouched draft', () => {
        expect(composeDictationAroundCaret({ beforeText: 'half typed', dictatedText: '' })).toBeNull()
    })
})

describe('mergeLinkedUrls', () => {
    test('unions both halves without duplicates, always returning every key', () => {
        const merged = mergeLinkedUrls(
            { linkedTasksUrls: ['a', 'b'], linkedNotesUrls: ['n'] },
            { linkedTasksUrls: ['b', 'c'] }
        )
        expect(merged.linkedTasksUrls).toEqual(['a', 'b', 'c'])
        expect(merged.linkedNotesUrls).toEqual(['n'])
        expect(merged.linkedArtifactsUrls).toEqual([])
    })
})

/**
 * jsdom cannot host a Quill editor (no Range/Selection, see CustomTextInput3ControlledValue.test.js),
 * so the editor-side wiring is guarded structurally: the split must serialize both halves through
 * the same `getFinalText` that produces the title on every keystroke, and the mic must only be put
 * in background mode for a host that asked for it.
 */
describe('CustomTextInput3 background dictation wiring', () => {
    const source = fs.readFileSync(path.join(__dirname, 'CustomTextInput3.js'), 'utf8')

    test('serializes both halves of the draft with getFinalText', () => {
        expect(source).toMatch(/getFinalText\(new Delta\(editor\.getContents\(0, index\)\.ops\)\.insert\('\\n'\)\)/)
        expect(source).toMatch(/getFinalText\(editor\.getContents\(index \+ length\)\)/)
    })

    test('background mode is opt-in per host', () => {
        expect(source).toMatch(
            /claimBackgroundSubmit=\{\s*claimDictationBackgroundSubmit \? claimBackgroundDictation : undefined\s*\}/
        )
    })
})
