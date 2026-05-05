export const TOOL_OPTIONS = [
    { key: 'create_task', labelKey: 'Create new task' },
    { key: 'create_note', labelKey: 'Create new note' },
    { key: 'update_task', labelKey: 'Update task' },
    { key: 'update_note', labelKey: 'Update note' },
    { key: 'update_contact', labelKey: 'Update contact' },
    { key: 'update_user_memory', labelKey: 'Update user memory' },
    { key: 'update_heartbeat_settings', labelKey: 'Update heartbeat settings' },
    { key: 'update_project_description', labelKey: 'Update project description' },
    { key: 'update_user_description', labelKey: 'Update user description' },
    { key: 'update_assistant_settings', labelKey: 'Update assistant settings' },
    { key: 'compact_thread_context', labelKey: 'Compact thread context' },
    { key: 'get_tasks', labelKey: 'Get tasks' },
    { key: 'get_updates', labelKey: 'Get updates' },
    { key: 'get_goals', labelKey: 'Get goals' },
    { key: 'get_chats', labelKey: 'Get chats' },
    { key: 'get_contacts', labelKey: 'Get contacts' },
    { key: 'get_focus_task', labelKey: 'Get focus task' },
    { key: 'get_user_projects', labelKey: 'Get user projects' },
    { key: 'search', labelKey: 'Search content' },
    { key: 'search_gmail', labelKey: 'Search Gmail emails' },
    { key: 'list_recent_chat_media', labelKey: 'List recent chat media' },
    { key: 'get_chat_attachment', labelKey: 'Get chat attachment' },
    { key: 'get_gmail_attachment', labelKey: 'Get Gmail attachment' },
    { key: 'create_gmail_reply_draft', labelKey: 'Create Gmail reply draft' },
    { key: 'create_gmail_draft', labelKey: 'Create Gmail draft' },
    { key: 'update_gmail_draft', labelKey: 'Update Gmail draft' },
    { key: 'update_gmail_email', labelKey: 'Update Gmail email' },
    { key: 'search_calendar_events', labelKey: 'Search Calendar events' },
    { key: 'create_calendar_event', labelKey: 'Create Calendar event' },
    { key: 'update_calendar_event', labelKey: 'Update Calendar event' },
    { key: 'delete_calendar_event', labelKey: 'Delete Calendar event' },
    { key: 'get_notes', labelKey: 'Get notes' },
    { key: 'web_search', labelKey: 'Search the internet' },
    { key: 'external_tools', labelKey: 'Use external app tools' },
    { key: 'talk_to_assistant', labelKey: 'Talk to assistants' },
]

export const TOOL_LABEL_BY_KEY = TOOL_OPTIONS.reduce((acc, option) => {
    acc[option.key] = option.labelKey
    return acc
}, {})

// Map renamed tool keys so Firestore data with old names resolves correctly
const TOOL_KEY_RENAMES = { get_note: 'get_notes' }

const VALID_KEYS = new Set(TOOL_OPTIONS.map(o => o.key))

export function normalizeAllowedTools(allowedTools) {
    if (!Array.isArray(allowedTools)) return []
    const seen = new Set()
    const result = []
    for (const key of allowedTools) {
        const mapped = TOOL_KEY_RENAMES[key] || key
        if (!seen.has(mapped)) {
            seen.add(mapped)
            result.push(mapped)
        }
    }
    return result
}
