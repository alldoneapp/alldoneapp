/**
 * OpenAI Function/Tool Schemas for Native Tool Calling
 * These schemas define the structure and parameters for each tool
 */

const toolSchemas = {
    create_task: {
        type: 'function',
        function: {
            name: 'create_task',
            description: 'Creates a new task in the current project',
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
                'Retrieves tasks from the current project or across all projects. Can filter by status, date, and other criteria.',
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
            description: 'Retrieves the current focus task for the user',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
    },

    update_task: {
        type: 'function',
        function: {
            name: 'update_task',
            description:
                'Updates an existing task. Can search by taskId, taskName, projectName, or projectId. Can update completion status, focus status, name, and description.',
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
            description: 'Updates an existing note by searching for it by title. Supports markdown formatting.',
            parameters: {
                type: 'object',
                properties: {
                    noteTitle: {
                        type: 'string',
                        description: 'The title of the note to update',
                    },
                    content: {
                        type: 'string',
                        description: 'The new content for the note in markdown format',
                    },
                },
                required: ['noteTitle', 'content'],
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
