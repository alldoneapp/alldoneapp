'use strict'

// Only fields proven unchanged since email automation last wrote them may be
// replaced. Legacy/user-edited tasks receive additive actionable context instead.
function buildEmailTaskUpdate(task, plan, gmailData, actorId, now) {
    const update = {}
    const baseline = task.gmailData?.taskContent || {}
    const nextBaseline = { ...baseline }
    const newer = gmailData.receivedAt
        ? gmailData.receivedAt >= (task.gmailData?.lastEmailReceivedAt || 0)
        : !task.gmailData?.lastEmailReceivedAt
    if (newer) {
        for (const field of ['name', 'dueDate', 'priority']) {
            const value = plan[field]
            if (
                value === undefined ||
                !Object.hasOwn(baseline, field) ||
                task[field] !== baseline[field] ||
                task[field] !== plan.expected?.[field]
            )
                continue
            if (field === 'name' && task.extendedName && task.extendedName !== task.name) continue
            update[field] = value
            nextBaseline[field] = value
            if (field === 'name') update.extendedName = value
        }
    }
    if (plan.actionUpdate) {
        const description = task.description || ''
        update.description = `${description}${description ? '\n\n' : ''}${plan.actionUpdate}`
        if (description === baseline.description) nextBaseline.description = update.description
    }
    const rejectedSuggestion =
        task.suggestedBy &&
        task.userId === task.suggestedBy &&
        (task.assistantId === task.suggestedBy ||
            task.taskMetadata?.assistantSuggestion?.assistantId === task.suggestedBy)
    // plan.reopen === false: the email asks nothing of the user (decided 2026-11-09), so it is
    // added as a comment and the done task stays done. Older callers send no flag and reopen.
    const mayReopen = plan.reopen !== false
    if ((task.inDone || task.done) && !rejectedSuggestion && mayReopen) {
        Object.assign(update, {
            done: false,
            inDone: false,
            completed: null,
            completedDate: null,
            completedTime: null,
            currentReviewerId: task.userId || 'Open',
        })
    }
    // A reply task (UNIFIED_INBOX_PLAN.md) tracks its conversation: every newer message moves
    // lastMessageAt, and a message that asks something again puts it back in the Messages section.
    if (task.messageData && newer) {
        update.messageData = {
            ...task.messageData,
            lastMessageAt: Math.max(task.messageData.lastMessageAt || 0, gmailData.receivedAt || 0),
            ...(plan.needsReply === true ? { needsReply: true } : {}),
        }
    }
    return {
        ...update,
        lastEditionDate: now,
        lastEditorId: actorId,
        gmailData: {
            ...task.gmailData,
            taskContent: nextBaseline,
            lastEmailReceivedAt: Math.max(task.gmailData?.lastEmailReceivedAt || 0, gmailData.receivedAt || 0),
        },
    }
}

module.exports = { buildEmailTaskUpdate }
