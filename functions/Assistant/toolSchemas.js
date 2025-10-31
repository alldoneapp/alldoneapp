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
                'Creates a new task in the current project. Use this when the user wants to add, create, or remember a task/todo item.',
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
                'Updates an existing task. Use this when the user wants to mark a task as done/complete, change focus, rename, or update a task. Can search by taskId, taskName, or projectName. Can update completion status, focus status, name, and description.',
            parameters: {
                type: 'object',
                properties: {
                    taskId: {
                        type: 'string',
                        description: 'The ID of the task to update',
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
                        description: 'Search for task within a specific project by project ID',
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
                            'New content to prepend to the note with date stamp (optional, markdown supported)',
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
                'Search across tasks, notes, goals, contacts, chats, and assistants. Use this to find information, answer questions about existing content, or locate specific items.',
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
                        description: 'Optional: filter by date range in format "YYYY-MM-DD to YYYY-MM-DD"',
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
