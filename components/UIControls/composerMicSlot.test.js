import { isComposerTextEmpty, resolveComposerMicSlot } from './composerMicSlot'

describe('resolveComposerMicSlot (AT-3025)', () => {
    const idle = { inlinePhase: 'idle', sendSlotPhase: 'idle' }

    it('puts the mic in the send slot and hides the small mic while the composer is empty', () => {
        expect(resolveComposerMicSlot({ enabled: true, isEmpty: true, ...idle })).toEqual({
            micInSendSlot: true,
            inlineMicVisible: false,
        })
    })

    it('gives the slot back to send, and shows the small mic, once there is text', () => {
        expect(resolveComposerMicSlot({ enabled: true, isEmpty: false, ...idle })).toEqual({
            micInSendSlot: false,
            inlineMicVisible: true,
        })
    })

    it('changes nothing where dictation or a send slot is unavailable', () => {
        expect(resolveComposerMicSlot({ enabled: false, isEmpty: true, ...idle })).toEqual({
            micInSendSlot: false,
            inlineMicVisible: true,
        })
    })

    it('keeps a take started in the send slot there until it is idle, even after text arrives', () => {
        for (const sendSlotPhase of ['recording', 'processing']) {
            expect(
                resolveComposerMicSlot({ enabled: true, isEmpty: false, inlinePhase: 'idle', sendSlotPhase })
            ).toEqual({ micInSendSlot: true, inlineMicVisible: false })
        }
    })

    it('does not bring up a second mic when the draft is emptied while the small mic is recording', () => {
        expect(
            resolveComposerMicSlot({ enabled: true, isEmpty: true, inlinePhase: 'recording', sendSlotPhase: 'idle' })
        ).toEqual({ micInSendSlot: false, inlineMicVisible: true })
    })

    it('treats missing phases as idle', () => {
        expect(resolveComposerMicSlot({ enabled: true, isEmpty: true })).toEqual({
            micInSendSlot: true,
            inlineMicVisible: false,
        })
    })
})

describe('isComposerTextEmpty', () => {
    it.each([
        ['', true],
        ['   \n', true],
        [undefined, true],
        [null, true],
        ['Hi', false],
        ['  a ', false],
    ])('%j -> %s', (text, expected) => {
        expect(isComposerTextEmpty(text)).toBe(expected)
    })
})
