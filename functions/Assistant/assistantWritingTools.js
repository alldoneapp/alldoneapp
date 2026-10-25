'use strict'

// An execution allowlist, not a prompt-only restriction. External MCP tools,
// mutations, delegated assistants and VM/browser control cannot run in writing mode.
const WRITING_READ_TOOLS = new Set([
    'get_tasks',
    'get_goals',
    'get_project_okrs',
    'get_project_happiness',
    'get_chats',
    'get_contacts',
    'get_user_projects',
    'get_focus_task',
    'search',
    'get_notes',
    'get_chat_attachment',
    'load_skill',
    // Reads the user's connected mailboxes (Gmail and Outlook) so a reply can follow the thread on
    // screen. Attachment bytes, drafts and label changes stay out of writing mode.
    'search_gmail',
    // Offered by the wiki itself, not by the assistant's toggles (knowledgeBaseAssistant.js gives
    // writing runs read access). Without it here the run is offered the tool and then refused it.
    'read_knowledge_page',
])

function writingReadTools(tools) {
    return Array.isArray(tools) ? tools.filter(name => WRITING_READ_TOOLS.has(name)) : []
}

module.exports = { WRITING_READ_TOOLS, writingReadTools }
