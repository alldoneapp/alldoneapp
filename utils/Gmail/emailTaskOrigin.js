// AT-3151: which tasks came from an email, and when their email last moved.
//
// Kept in its own dependency-free module (not gmailTaskUtils.js) because many component tests mock
// gmailTaskUtils with a partial factory, and openTasks.js groups every task through this helper.

// A task came from an email when it carries `gmailData` - the exact marker the Email badge reads.
// Both badge variants count: legacy inbox-summary tasks (chip before the title,
// `isInboxSummaryGmailTask`) and labeling-sync follow-ups (`gmailData.origin ===
// 'gmail_label_follow_up'`, chip inside the title), including Microsoft mailboxes (same field,
// `provider: 'microsoft'`) and AT-3135 collection to-dos (`gmailData.bundle`, no `messageData`).
// `messageData.needsReply` is deliberately not part of this: it says whether an answer is owed,
// not where the task came from.
export function isEmailOriginTask(task) {
    return !!task?.gmailData
}

const toTime = value => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)

// Newest email activity of a task, used to order the Messages section (newest first). A reply task
// has `messageData.lastMessageAt`; email tasks without reply data fall back to their own email
// timestamps, and only then to the task's creation time. 0 means "unknown" and sorts last.
export function getEmailTaskActivityTime(task) {
    const gmailData = task?.gmailData || {}
    const emailTime = Math.max(
        toTime(task?.messageData?.lastMessageAt),
        toTime(gmailData.lastEmailReceivedAt),
        toTime(gmailData.bundle?.lastItemAt),
        toTime(gmailData.receivedAt)
    )
    return emailTime || toTime(task?.created)
}
