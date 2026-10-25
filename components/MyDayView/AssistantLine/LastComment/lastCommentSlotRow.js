/**
 * AT-2523 — the row a Last comment slot last had ON SCREEN, remembered per scope.
 *
 * The ticker roll (AT-2511) needs two things: the comment arriving, and the one it replaces. The
 * first is a prop; the second is a memory, and it cannot live in the component that needs it —
 * because the card that shows the new comment is frequently a DIFFERENT MOUNT from the card that
 * showed the old one:
 *
 *   - a comment landing in another chat remounts the subtree (`LastComment` keys its child on
 *     `project:chatType:chatId`),
 *   - the AT-2504 pending card and the real preview are two different components entirely, so the
 *     hand-over in each direction — "you pressed Enter" and "the answer arrived" — crosses a mount
 *     boundary twice per send.
 *
 * `useLastCommentArrivalMotion` keeps its own two-slot history for the case where the card stays
 * mounted (a second comment in the same chat), and that history is born empty on every remount. So
 * AT-2511 shipped with a documented compromise: on a remount the card rolled the new comment in
 * with nothing rolling out, "without inventing a departure that did not happen". This module is
 * what makes that departure knowable rather than invented — the row really was on screen in this
 * slot a moment ago, we simply had nowhere to write it down.
 *
 * Module state rather than redux, for the reason spelled out in `lastCommentArrival.js`,
 * `assistantLinePendingSend.js` and `threadAssistantModelState.js` (AT-2502): this concerns one
 * widget for half a second, and per AT-2336 a slice keyed by project id re-renders every subscriber
 * of that map on every write.
 *
 * ## Scope, and why it is not bounded by time
 *
 * Keyed by the same `scopeKey` `LastCommentArea` builds for arrival detection (user + project key +
 * assistant), so two slots cannot read each other's history and an account switch cannot inherit
 * the previous user's.
 *
 * The record is deliberately NOT expired. It is only ever consulted when an arrival is announced,
 * and an arrival means this slot is now showing something it has never shown — so whatever it
 * showed instead is, by definition, the thing being replaced, whether that was two seconds or two
 * minutes ago. The record does not survive a reload, which is what keeps a comment that arrived
 * while the tab was closed from rolling on the next boot.
 *
 * ## `kind`, and the one boundary this is consumed across
 *
 * AT-2511 made a deliberate product decision that AT-2523 does not revisit: when a comment lands in
 * a DIFFERENT chat than the one on screen, the subtree remounts and the new comment rolls in ALONE,
 * "without inventing a departure that did not happen" (pinned by the `rolls in alone across a
 * remount` case in `lastCommentArrivalEndToEnd.test.js`). One could argue the departure is real
 * there — the user did watch that row sit in this slot — but that is a product call belonging to
 * whoever owns the roll, not a side effect of this ticket.
 *
 * What AT-2523 needs is strictly narrower: the pending-send card and the real preview are two
 * different components, so ONE send crosses this mount boundary twice — "you pressed Enter" and
 * "the answer arrived" — and neither half can see the other's row. So each record carries the kind
 * of card that wrote it, and a card only consumes a seed written by the OTHER kind. Preview →
 * preview (the cross-chat remount) is left exactly as AT-2511 shipped it.
 *
 * A row is `{ projectId, commentText, objectName }` — exactly `LastCommentRow`'s props, because
 * rendering it is the only thing it is ever used for — plus that `kind`.
 */

export const LAST_COMMENT_ROW_PREVIEW = 'preview'
export const LAST_COMMENT_ROW_PENDING = 'pending'

const slotRows = new Map()

const isUsableRow = row => !!row && typeof row.commentText === 'string' && row.commentText.length > 0

/**
 * Record what this slot is showing. Ignores an empty row so a card that is mid-load (the preview
 * renders a skeleton before its text resolves) cannot erase the real row underneath it — the
 * memory is "the last thing the user could actually read here", not "the last render".
 */
export const recordLastCommentSlotRow = (scopeKey, kind, row) => {
    if (!scopeKey || !kind || !isUsableRow(row)) return
    slotRows.set(scopeKey, {
        kind,
        projectId: row.projectId ?? null,
        commentText: row.commentText,
        objectName: row.objectName ?? '',
    })
}

/**
 * The row this slot last showed, for a card of `kind` asking what it is replacing.
 *
 * Answers `null` when the record was written by a card of the SAME kind — see the note above: that
 * is the cross-chat preview remount, which AT-2511 deliberately rolls in alone.
 */
export const getLastCommentSlotRow = (scopeKey, kind = null) => {
    const row = scopeKey ? slotRows.get(scopeKey) || null : null
    if (!row) return null
    if (kind && row.kind === kind) return null
    return row
}

/** Exported for tests: module-level state outlives a test file otherwise. */
export const resetLastCommentSlotRows = () => {
    slotRows.clear()
}
