'use strict'

// Completing or reopening a task already gets its feed from the onUpdateTask trigger
// (`persistTaskStatusFeed`, "checked task as Done" / "changed task to Open"). If an
// assistant/MCP `update_task` writes its own "marked as complete" entry as well, every
// such completion appears twice — once translated, once in raw English (AT-2906).
const STATUS_CHANGE = /^marked as (complete|incomplete)$/

const isStatusChange = change => typeof change === 'string' && STATUS_CHANGE.test(change)

// Returns the entry text for TaskService's own "updated task" feed, or null when the update
// carries nothing beyond the status change the trigger already reports.
function buildTaskUpdateFeedEntryText(changes) {
    const feedChanges = (Array.isArray(changes) ? changes : []).filter(change => !isStatusChange(change))
    if (!feedChanges.length) return null
    if (feedChanges.length === 1) return `updated task ${String(feedChanges[0]).split(' ')[0]}`
    return `updated task (${feedChanges.map(change => String(change).split(' ')[0]).join(', ')})`
}

module.exports = { buildTaskUpdateFeedEntryText, isStatusChange }
