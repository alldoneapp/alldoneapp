import { isLiveComment } from './liveComment'

/**
 * The predicate two features now depend on: the unread count must not treat a live status as a read
 * boundary, and the Last comment slot must not animate a comment that is streaming in front of the
 * user. Both use it to SUPPRESS behaviour, so the asymmetry matters — a false positive freezes a
 * feature (an animation that never plays again, an unread that is never counted), while a false
 * negative costs one flourish. Absence of evidence therefore has to answer `false`.
 */
describe('isLiveComment', () => {
    it('is true while the assistant is writing the answer', () => {
        expect(isLiveComment({ isLoading: true })).toBe(true)
    })

    it('is true while the model is in a reasoning block', () => {
        expect(isLiveComment({ isThinking: true })).toBe(true)
    })

    it('is true for a partial comment', () => {
        expect(isLiveComment({ isPartial: true })).toBe(true)
    })

    it('is true for a running assistant run', () => {
        expect(isLiveComment({ assistantRun: { status: 'running' } })).toBe(true)
    })

    // The run has been asked to stop but is still writing, so the comment is still changing.
    it('is true for a run that has been asked to cancel', () => {
        expect(isLiveComment({ assistantRun: { status: 'cancel_requested' } })).toBe(true)
    })

    it('is false for a settled comment', () => {
        expect(isLiveComment({ isLoading: false, assistantRun: { status: 'completed' } })).toBe(false)
    })

    it('is false for an ordinary comment carrying none of the flags', () => {
        expect(isLiveComment({ commentText: 'Hello' })).toBe(false)
    })

    // `getUnreadCommentsCount` is called with plain id strings by legacy restored state.
    it('is false for a bare id, a missing comment and a nullish one', () => {
        expect(isLiveComment('comment-1')).toBe(false)
        expect(isLiveComment(undefined)).toBe(false)
        expect(isLiveComment(null)).toBe(false)
    })

    // Only the literal `true` counts: a truthy-but-not-true value is not evidence of a live run.
    it('does not treat a truthy non-boolean as live', () => {
        expect(isLiveComment({ isLoading: 'yes' })).toBe(false)
        expect(isLiveComment({ assistantRun: { status: 'failed' } })).toBe(false)
    })
})
