export const TOOL_OPTIONS = [
    { key: 'create_task', labelKey: 'Create new task' },
    { key: 'update_task', labelKey: 'Update task' },
    { key: 'get_tasks', labelKey: 'Get tasks' },
    { key: 'get_focus_task', labelKey: 'Get focus task' },
]

export const TOOL_LABEL_BY_KEY = TOOL_OPTIONS.reduce((acc, option) => {
    acc[option.key] = option.labelKey
    return acc
}, {})
