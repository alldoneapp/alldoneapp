export const TOOL_OPTIONS = [
    { key: 'create_task', labelKey: 'Create new task' },
    { key: 'create_note', labelKey: 'Create new note' },
    { key: 'update_task', labelKey: 'Update task' },
    { key: 'update_note', labelKey: 'Update note' },
    { key: 'get_tasks', labelKey: 'Get tasks' },
    { key: 'get_focus_task', labelKey: 'Get focus task' },
    { key: 'get_user_projects', labelKey: 'Get user projects' },
    { key: 'search', labelKey: 'Search content' },
    { key: 'get_note', labelKey: 'Get note content' },
    { key: 'web_search', labelKey: 'Search the internet' },
]

export const TOOL_LABEL_BY_KEY = TOOL_OPTIONS.reduce((acc, option) => {
    acc[option.key] = option.labelKey
    return acc
}, {})
