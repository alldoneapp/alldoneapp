import {
    CHAT_BOARD_CONTENT_OFFSET,
    CHAT_COMPOSER_LIFT,
    NEW_MESSAGES_PILL_GAP,
    getChatComposerLift,
    getNewMessagesPillBottom,
} from './chatComposerLayout'

// AT-2439 follow-up - the "New message ↓" pill shipped half-hidden behind the composer, because
// the scroller's bottom edge is NOT the edge the user sees: `ChatInput` is `position: relative`
// with `bottom: 24`, which repaints it 24px higher and leaves its layout box where it was. These
// are the rules that keep the pill above the painted edge rather than above the flow one.
describe('chat composer layout', () => {
    describe('getChatComposerLift', () => {
        it("is the composer's own relative offset when there is no home indicator", () => {
            // Desktop, Android and browser tabs all report 0, so the pill must not move there.
            expect(getChatComposerLift(0)).toBe(CHAT_COMPOSER_LIFT)
        })

        it('follows the composer up on an iOS standalone PWA', () => {
            // ChatInput applies `bottom: 24 + lift`; anything clearing it has to add the same lift,
            // or the pill is fine everywhere except the one surface that moved.
            expect(getChatComposerLift(34)).toBe(CHAT_COMPOSER_LIFT + 34)
        })

        it('ignores a missing or nonsensical lift instead of producing NaN', () => {
            // `useHomeIndicatorLift` reads a measured CSS value; a NaN here would silently become
            // `bottom: NaN` and drop the pill back to the top of the scroller.
            expect(getChatComposerLift(undefined)).toBe(CHAT_COMPOSER_LIFT)
            expect(getChatComposerLift(null)).toBe(CHAT_COMPOSER_LIFT)
            expect(getChatComposerLift(NaN)).toBe(CHAT_COMPOSER_LIFT)
            expect(getChatComposerLift(-10)).toBe(CHAT_COMPOSER_LIFT)
        })
    })

    describe('getNewMessagesPillBottom', () => {
        it('clears the composer by a deliberate gap', () => {
            expect(getNewMessagesPillBottom(0)).toBe(CHAT_COMPOSER_LIFT + NEW_MESSAGES_PILL_GAP)
        })

        // The actual defect: the pill sat BELOW the composer's painted top edge, so an opaque
        // sibling drew over it. This is the invariant that had been violated, stated directly.
        it('never sits inside the strip the composer paints over', () => {
            for (const lift of [0, 20, 34, 48]) {
                expect(getNewMessagesPillBottom(lift)).toBeGreaterThan(getChatComposerLift(lift))
            }
        })

        it('leaves a gap big enough to survive the composer shadow', () => {
            // The composer casts `0px 4px 8px`, which bleeds upward too; a 2-3px gap would still
            // read as the pill touching the frame.
            expect(getNewMessagesPillBottom(0) - getChatComposerLift(0)).toBeGreaterThanOrEqual(8)
        })

        it('keeps the gap constant as the composer moves', () => {
            // The gap is what the user sees; it must not grow or shrink with the home indicator.
            const gapAt = lift => getNewMessagesPillBottom(lift) - getChatComposerLift(lift)
            expect(gapAt(34)).toBe(gapAt(0))
        })
    })

    it('exposes the message column offset the pill has to cancel to centre on the composer', () => {
        // ChatBoard pulls the scroller left by this much; the composer is not pulled with it.
        expect(CHAT_BOARD_CONTENT_OFFSET).toBeGreaterThan(0)
    })
})
