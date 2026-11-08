'use strict'

/**
 * Security audit 2026-11: the Gmail post-label run reads email written by anybody who can send
 * the user a message, and it runs unattended on a schedule, acting as the mailbox owner. Handing it
 * the assistant's full tool list let a crafted email steer the run into fetching URLs, searching the
 * mailbox, writing memory or assistant settings, starting VM jobs, browsing, delegating or calling
 * MCP/external tools — all as the owner, with nobody watching.
 *
 * Invariant: this run only ever gets tools that act inside the owner's own workspace and cannot
 * carry data out of it. The list is intersected with the assistant's own `allowedTools`, so an
 * assistant that has a tool switched off still does not get it here, and the same list is both the
 * schema list the model sees and the execution gate.
 *
 * What the follow-ups need: the generated default prompt creates a task (actionable), comments in
 * the "Daily emails …" topic (informational) and updates an existing contact note. Custom prompts
 * may also create notes, look up contacts or prepare a reply draft, which the user still has to
 * send themselves.
 */
const GMAIL_POST_LABEL_SAFE_TOOLS = Object.freeze([
    'create_task',
    'add_chat_comment',
    'create_note',
    'update_note',
    'get_contacts',
    'create_gmail_reply_draft',
])

function getGmailPostLabelAllowedTools(assistantAllowedTools) {
    if (!Array.isArray(assistantAllowedTools)) return []
    const enabled = new Set(assistantAllowedTools)
    return GMAIL_POST_LABEL_SAFE_TOOLS.filter(toolName => enabled.has(toolName))
}

module.exports = { GMAIL_POST_LABEL_SAFE_TOOLS, getGmailPostLabelAllowedTools }
