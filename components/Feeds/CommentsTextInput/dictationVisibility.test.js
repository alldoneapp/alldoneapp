/**
 * AT-2355. The dictation mic used to be revealed only by hover or focus, which on touch means
 * "after you already tapped into the field". Composer inputs (assistant line, chat) pin it on.
 */
const fs = require('fs')
const path = require('path')

import { isDictationButtonVisible, shouldTrackDictationActivity } from './dictationVisibility'

describe('dictation visibility', () => {
    describe('isDictationButtonVisible', () => {
        it('keeps the hover/focus behaviour for ordinary inputs', () => {
            expect(isDictationButtonVisible({ alwaysShowDictation: false, activityVisible: false })).toBe(false)
            expect(isDictationButtonVisible({ alwaysShowDictation: false, activityVisible: true })).toBe(true)
        })

        it('pins the mic on for composer inputs, focused or not', () => {
            expect(isDictationButtonVisible({ alwaysShowDictation: true, activityVisible: false })).toBe(true)
            expect(isDictationButtonVisible({ alwaysShowDictation: true, activityVisible: true })).toBe(true)
        })

        it('defaults to hidden when nothing is passed', () => {
            expect(isDictationButtonVisible({})).toBe(false)
        })
    })

    describe('shouldTrackDictationActivity', () => {
        it('tracks hover/focus only where the mic can actually hide', () => {
            expect(shouldTrackDictationActivity({ dictationEnabled: true, alwaysShowDictation: false })).toBe(true)
            expect(shouldTrackDictationActivity({ dictationEnabled: true, alwaysShowDictation: true })).toBe(false)
        })

        it('never tracks when dictation is disabled for the input', () => {
            expect(shouldTrackDictationActivity({ dictationEnabled: false, alwaysShowDictation: false })).toBe(false)
            expect(shouldTrackDictationActivity({ dictationEnabled: false, alwaysShowDictation: true })).toBe(false)
        })
    })

    // CustomTextInput3 cannot be rendered here (jsdom has no Range/Selection, so Quill cannot be
    // instantiated — see __tests__/Feeds/CustomTextInput3ControlledValue.test.js). Guard the wiring
    // structurally instead, so the prop cannot be silently disconnected from the button again.
    describe('CustomTextInput3 wiring', () => {
        const source = fs.readFileSync(path.join(__dirname, 'CustomTextInput3.js'), 'utf8')

        it('drives the mic through the shared visibility rule', () => {
            expect(source).toContain("from './dictationVisibility'")
            expect(source).toContain('visible={dictationButtonVisible}')
            expect(source).not.toContain('visible={dictationVisible}')
        })

        it('accepts the opt-in prop and skips the hover/focus listeners when it is set', () => {
            expect(source).toMatch(/alwaysShowDictation = false,/)
            expect(source).toContain('shouldTrackDictationActivity({ dictationEnabled, alwaysShowDictation })')
        })

        // AT-3025: the blue mic in an empty composer's send slot. Both mics stay mounted and are
        // only shown/hidden, so a take in progress survives the composer filling up.
        describe('send-slot mic (AT-3025)', () => {
            const sendSlotButton = source.slice(
                source.indexOf('const sendSlotDictationButton'),
                source.indexOf('const inlineControls = ')
            )

            it('decides both mics with the shared composer rule', () => {
                expect(source).toContain("from '../../UIControls/composerMicSlot'")
                expect(source).toContain('resolveComposerMicSlot({')
                expect(source).toMatch(/const dictationButtonVisible =\s+inlineMicVisible &&/)
                expect(sendSlotButton).toContain('visible={micInSendSlot}')
            })

            it('gives the send-slot mic the same insert and hold-to-send wiring as the usual one', () => {
                expect(sendSlotButton).toContain('onTextReady={insertDictatedText}')
                expect(sendSlotButton).toContain('onSubmit={submitDictatedText}')
                expect(sendSlotButton).toContain("variant={'send'}")
                expect(source).toContain('createPortal(sendSlotDictationButton, sendSlotTarget)')
            })

            it('tracks both phases so a recording mic is never replaced mid-take', () => {
                expect(source).toContain('onPhaseChange={setInlineDictationPhase}')
                expect(sendSlotButton).toContain('onPhaseChange={setSendSlotDictationPhase}')
            })
        })
    })
})
