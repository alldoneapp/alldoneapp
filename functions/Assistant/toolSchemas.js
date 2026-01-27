/**
 * OpenAI Function/Tool Schemas for Native Tool Calling
 * These schemas define the structure and parameters for each tool
 */

const toolSchemas = {
    create_task: {
        type: 'function',
        function: {
            name: 'create_task',
            description:
                'Creates a new task in the current project with optional reminder/alert. Use this when the user wants to add, create, or remember a task/todo item, especially for "remind me to X" or "create a task to Y at Z time" requests.',
            parameters: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'The name/title of the task',
                    },
                    description: {
                        type: 'string',
                        description: 'Optional description for the task',
                    },
                    dueDate: {
                        type: 'string',
                        description:
                            'Set the reminder date/time as ISO 8601 string (e.g., "2025-01-15T18:00:00" for 6pm on Jan 15). The time will be interpreted in the user\'s local timezone and stored as UTC. This is also used as the alert time when alertEnabled is true. Use this for "remind me at X" or "create task at Y time" requests.',
                    },
                    alertEnabled: {
                        type: 'boolean',
                        description:
                            'Enable alert notification for this task. When true, the user will receive an alert at the time specified in dueDate. Requires dueDate to be provided. Use this for "remind me" or "alert me" requests.',
                    },
                    projectId: {
                        type: 'string',
                        description:
                            "Optional: the project ID where the task should be created. If not specified, uses the current chat context project or the user's default project.",
                    },
                    projectName: {
                        type: 'string',
                        description:
                            "Optional: the project name where the task should be created. The system will search for projects matching this name (case-insensitive partial match). If both projectId and projectName are provided, projectId takes precedence. If not specified, uses the current chat context project or the user's default project.",
                    },
                },
                required: ['name'],
            },
        },
    },

    create_note: {
        type: 'function',
        function: {
            name: 'create_note',
            description: 'Creates a new note in the current project. Supports markdown formatting.',
            parameters: {
                type: 'object',
                properties: {
                    title: {
                        type: 'string',
                        description: 'The title of the note',
                    },
                    content: {
                        type: 'string',
                        description: 'The content of the note in markdown format',
                    },
                },
                required: ['title', 'content'],
            },
        },
    },

    get_tasks: {
        type: 'function',
        function: {
            name: 'get_tasks',
            description:
                'Retrieves and shows tasks from the current project or across all projects. Use this when the user asks to see, show, list, or check their tasks. Can filter by status (open/done), date (today, specific date), and project scope.',
            parameters: {
                type: 'object',
                properties: {
                    status: {
                        type: 'string',
                        enum: ['open', 'done', 'all'],
                        description: 'Filter tasks by status',
                    },
                    date: {
                        type: 'string',
                        description: 'Filter tasks by date. Use "today" for today\'s tasks or YYYY-MM-DD format',
                    },
                    allProjects: {
                        type: 'boolean',
                        description:
                            'If true, retrieves tasks from all accessible projects instead of just the current one',
                    },
                    includeArchived: {
                        type: 'boolean',
                        description:
                            'If true, includes tasks from archived projects (only applies when allProjects is true)',
                    },
                    includeCommunity: {
                        type: 'boolean',
                        description:
                            'If true, includes tasks from community/template projects (only applies when allProjects is true)',
                    },
                },
                required: [],
            },
        },
    },

    get_user_projects: {
        type: 'function',
        function: {
            name: 'get_user_projects',
            description: "Retrieves the user's accessible projects with filtering options",
            parameters: {
                type: 'object',
                properties: {
                    includeArchived: {
                        type: 'boolean',
                        description: 'If true, includes archived projects',
                    },
                    includeCommunity: {
                        type: 'boolean',
                        description: 'If true, includes community/template/guide projects',
                    },
                },
                required: [],
            },
        },
    },

    get_focus_task: {
        type: 'function',
        function: {
            name: 'get_focus_task',
            description:
                'Retrieves the current focus task for the user. By default, searches across all projects to find the highest priority focus task. Can optionally filter to a specific project or force finding a different task.',
            parameters: {
                type: 'object',
                properties: {
                    projectId: {
                        type: 'string',
                        description:
                            'Optional: limit search to a specific project ID. If omitted, searches across all projects.',
                    },
                    allProjects: {
                        type: 'boolean',
                        description:
                            'Explicitly search across all projects (default behavior when projectId is not specified)',
                    },
                    forceNew: {
                        type: 'boolean',
                        description:
                            'Force finding a new/different focus task, skipping the currently set focus task. Useful for "what should I work on next?" If no alternative task exists, returns current focus task with a message.',
                    },
                },
                required: [],
            },
        },
    },

    update_task: {
        type: 'function',
        function: {
            name: 'update_task',
            description:
                'Updates an existing task or multiple tasks at once. Use this when the user wants to mark a task as done/complete, change focus, rename, update, set reminders/alerts, or set time estimations for a task. Can search by taskId, taskName, or projectName. Can update completion status, focus status, name, description, reminder date/time, estimation, and enable/disable alerts. Supports bulk updates for today and overdue tasks only (max 100 tasks).',
            parameters: {
                type: 'object',
                properties: {
                    taskId: {
                        type: 'string',
                        description: 'The ID of the task to update (for single task updates)',
                    },
                    taskName: {
                        type: 'string',
                        description: 'Search for task by name',
                    },
                    projectName: {
                        type: 'string',
                        description: 'Search for task within a specific project by project name',
                    },
                    projectId: {
                        type: 'string',
                        description:
                            'Search for task within a specific project by project ID. For bulk updates (updateAll=true), this limits updates to only tasks in this project.',
                    },
                    completed: {
                        type: 'boolean',
                        description: 'Set to true to mark task as completed, false to mark as open',
                    },
                    focus: {
                        type: 'boolean',
                        description: 'Set to true to make this the focus task, false to remove focus',
                    },
                    name: {
                        type: 'string',
                        description: 'New name for the task',
                    },
                    description: {
                        type: 'string',
                        description: 'New description for the task',
                    },
                    dueDate: {
                        type: 'string',
                        description:
                            'Set the reminder date/time as ISO 8601 string (e.g., "2025-01-15T18:00:00" for 6pm on Jan 15). The time will be interpreted in the user\'s local timezone and stored as UTC. This is also used as the alert time when alertEnabled is true. Use this for "remind me at X" requests.',
                    },
                    alertEnabled: {
                        type: 'boolean',
                        description:
                            'Enable (true) or disable (false) the alert notification for this task. When enabled, the user will receive an alert at the time specified in dueDate. Requires dueDate to be set on the task. Use this for "remind me" or "alert me" requests.',
                    },
                    estimation: {
                        type: 'number',
                        description:
                            'Task estimation in minutes (e.g., 30, 60, 120, 240). Common values: 15 (15min), 30 (30min), 60 (1 hour), 120 (2 hours), 240 (4 hours), 480 (8 hours), 960 (16 hours). Use this when the user wants to estimate how long a task will take.',
                    },
                    updateAll: {
                        type: 'boolean',
                        description:
                            'Set to true to update all matching tasks (only today + overdue tasks, max 100). If projectId is provided, updates only tasks in that project. If no projectId, updates across all projects. Use for bulk operations like "mark all today tasks as done", "set estimation to 1h for all overdue tasks", or "complete all tasks in Project X".',
                    },
                },
                required: [],
            },
        },
    },

    update_note: {
        type: 'function',
        function: {
            name: 'update_note',
            description:
                'Updates an existing note by searching for it by title. Can prepend new content with date stamp and/or update the note title. Supports markdown formatting.',
            parameters: {
                type: 'object',
                properties: {
                    noteTitle: {
                        type: 'string',
                        description: 'The title of the note to update (used for searching)',
                    },
                    content: {
                        type: 'string',
                        description:
                            'New content to prepend to the note (date stamp will be added automatically, markdown supported)',
                    },
                    title: {
                        type: 'string',
                        description: 'New title for the note (optional, for renaming)',
                    },
                },
                required: ['noteTitle'],
            },
        },
    },

    search: {
        type: 'function',
        function: {
            name: 'search',
            description:
                'Search across tasks, notes, goals, contacts, chats, and assistants. Use this to find information, answer questions about existing content, or locate specific items. For task searches, can filter by completion status.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'The search query text',
                    },
                    type: {
                        type: 'string',
                        enum: ['all', 'tasks', 'notes', 'goals', 'contacts', 'chats', 'assistants'],
                        description: 'Type of content to search. Use "all" to search across all types.',
                    },
                    projectId: {
                        type: 'string',
                        description: 'Optional: limit search to a specific project ID',
                    },
                    dateRange: {
                        type: 'string',
                        description:
                            'Optional: filter by date range in format "YYYY-MM-DD to YYYY-MM-DD". For done tasks, filters by completion date.',
                    },
                    status: {
                        type: 'string',
                        enum: ['open', 'done', 'all'],
                        description:
                            'Optional: filter tasks by status. Use "done" to find completed tasks, "open" for incomplete tasks. Only applies when type is "tasks".',
                    },
                    limit: {
                        type: 'number',
                        description:
                            'Optional: maximum number of results to return. Default is 50, maximum is 1000. Use higher limits when user asks for "all" items.',
                    },
                },
                required: ['query'],
            },
        },
    },

    web_search: {
        type: 'function',
        function: {
            name: 'web_search',
            description:
                'Search the internet for current information. Use this when the user asks about recent events, needs up-to-date information, or asks questions that require knowledge beyond your training data.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'The search query to find information on the internet',
                    },
                    search_depth: {
                        type: 'string',
                        enum: ['basic', 'advanced'],
                        description:
                            'Search depth - "basic" for quick results, "advanced" for more thorough search. Defaults to "basic".',
                    },
                },
                required: ['query'],
            },
        },
    },

    get_note: {
        type: 'function',
        function: {
            name: 'get_note',
            description:
                'Retrieve the full content of a specific note by its ID. Use this when you need to read or analyze the complete contents of a note.',
            parameters: {
                type: 'object',
                properties: {
                    noteId: {
                        type: 'string',
                        description: 'The ID of the note to retrieve',
                    },
                    projectId: {
                        type: 'string',
                        description: 'The project ID where the note is located',
                    },
                },
                required: ['noteId', 'projectId'],
            },
        },
    },
}

/**
 * Get tool schemas for allowed tools
 * @param {Array<string>} allowedTools - Array of tool names
 * @returns {Array} Array of tool schemas in OpenAI format
 */
function getToolSchemas(allowedTools) {
    if (!Array.isArray(allowedTools) || allowedTools.length === 0) {
        return []
    }

    return allowedTools.map(toolName => toolSchemas[toolName]).filter(schema => schema !== undefined)
}

module.exports = {
    toolSchemas,
    getToolSchemas,
}
