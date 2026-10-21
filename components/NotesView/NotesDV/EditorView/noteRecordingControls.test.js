import fs from 'fs'
import path from 'path'

import {
    canAutoStartNoteTranscription,
    isNoteMicrophoneVisible,
    isNoteTranscriptionVisible,
} from './noteRecordingControls'

describe('note recording controls visibility (AT-2384)', () => {
    describe('unified microphone button', () => {
        it('shows for a member on a browser that supports durable microphone capture', () => {
            expect(isNoteMicrophoneVisible({ accessGranted: true, microphoneSupported: true })).toBe(true)
        })

        it('hides in the not-logged-in / read-only view even where capture is supported', () => {
            expect(isNoteMicrophoneVisible({ accessGranted: false, microphoneSupported: true })).toBe(false)
        })

        it('still hides for a member when the browser cannot buffer microphone audio', () => {
            expect(isNoteMicrophoneVisible({ accessGranted: true, microphoneSupported: false })).toBe(false)
        })

        it('treats a missing access flag as no access', () => {
            expect(isNoteMicrophoneVisible({ microphoneSupported: true })).toBe(false)
        })
    })

    describe('screen/tab audio button', () => {
        it('shows for a member', () => {
            expect(isNoteTranscriptionVisible({ accessGranted: true })).toBe(true)
        })

        it('hides in the not-logged-in / read-only view', () => {
            expect(isNoteTranscriptionVisible({ accessGranted: false })).toBe(false)
            expect(isNoteTranscriptionVisible({})).toBe(false)
        })
    })

    describe('auto-started transcription', () => {
        it('runs for a member who opened a link asking for it', () => {
            expect(canAutoStartNoteTranscription({ accessGranted: true, autoStartTranscription: true })).toBe(true)
        })

        it('never opens a capture prompt for a visitor without access', () => {
            expect(canAutoStartNoteTranscription({ accessGranted: false, autoStartTranscription: true })).toBe(false)
        })

        it('stays off when nothing asked for it', () => {
            expect(canAutoStartNoteTranscription({ accessGranted: true, autoStartTranscription: false })).toBe(false)
        })
    })
})

/**
 * Ratchet over the toolbar source. `EditorToolbar.js` pulls in quill, react-dom/server and the whole
 * autoformat blot chain, so rendering it in jsdom just to assert two buttons are absent is far more
 * fragile than asserting that the two call sites go through the rules above — which is the thing
 * that can regress when someone adds another recording affordance next to them.
 */
describe('EditorToolbar wiring', () => {
    const source = fs.readFileSync(path.join(__dirname, 'EditorToolbar.js'), 'utf8')

    it('gates the mic button on the shared rule instead of browser support alone', () => {
        expect(source).toContain('isNoteMicrophoneVisible({ accessGranted, microphoneSupported: meetingSupported })')
        expect(source).not.toContain('useRambleController')
        expect(source).not.toContain('useRambleRecorder')
    })

    it('gates the transcription button and its auto-start on the shared rule', () => {
        expect(source).toContain('isNoteTranscriptionVisible({ accessGranted })')
        expect(source).toContain('canAutoStartNoteTranscription({ accessGranted, autoStartTranscription })')
    })
})
