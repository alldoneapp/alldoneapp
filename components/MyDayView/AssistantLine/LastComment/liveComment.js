/**
 * AT-2511 follow-up — "is this comment still being written?"
 *
 * The one place the client answers that question. It was already being asked in
 * `unreadCommentsHelper` (a live status must not count as a read boundary) and is now also asked by
 * the Last comment slot, which must not animate a comment that is streaming in front of the user.
 * Two copies of this predicate would drift, and the failure would be silent in both directions: a
 * missed flag animates every token, a spurious one suppresses a genuine arrival forever.
 *
 * ## The fields, and why it is all four
 *
 * `storeChunks` (`functions/Assistant/assistantHelper.js`) creates the comment with
 * `isLoading: true` / `isThinking: false` and `assistantRun.status: 'running'`, then rewrites
 * `commentText` as the answer accumulates, and finally writes `isLoading: false` with a terminal
 * run status. `isThinking` is raised while the model is in a reasoning block, and `isPartial` is the
 * flag the menubar surface stamps. None of the four is redundant: a run can be `running` with
 * `isLoading` already false between tool rounds, and a resumed VM comment carries `isLoading`
 * without an `assistantRun` at all.
 *
 * `cancel_requested` counts as live on purpose — the run has been asked to stop but is still
 * writing, and the comment keeps changing until it settles.
 *
 * Cloud Functions cannot import app code, so `functions/MenubarApp/menubarLastComment.js` and
 * `functions/MenubarApp/menubarApp.js` keep their own copies of this predicate. Keep the four
 * fields in step with them.
 */

/**
 * `true` only for a comment object that is demonstrably still being written. A string id, a missing
 * comment or a settled one all answer `false` — absence of evidence is "not live", never "unknown",
 * because every caller uses this to decide whether to SUPPRESS behaviour and a false positive is
 * the more damaging direction (a permanently frozen animation, a never-counted unread).
 */
export const isLiveComment = comment => {
    if (!comment || typeof comment === 'string') return false

    const assistantRunStatus = comment.assistantRun?.status
    return (
        comment.isLoading === true ||
        comment.isThinking === true ||
        comment.isPartial === true ||
        assistantRunStatus === 'running' ||
        assistantRunStatus === 'cancel_requested'
    )
}
