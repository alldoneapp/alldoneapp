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
                'Creates a new task with optional reminder/alert. Use this when the user wants to add, create, or remember a task/todo item, especially for "remind me to X" or "create a task to Y at Z time" requests. The only required parameter is the task name - all other parameters (projectId, projectName, dueDate, etc.) are optional. If no project is specified, the task will be created in the project of the current assistant. The response includes the projectId where the task was created.',
            parameters: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'The name/title of the task (required)',
                    },
                    description: {
                        type: 'string',
                        description: 'Optional: description for the task',
                    },
                    dueDate: {
                        oneOf: [
                            {
                                type: 'number',
                                description: 'Optional: Set the reminder date/time as Unix timestamp in milliseconds.',
                            },
                            {
                                type: 'string',
                                description:
                                    'Optional: Set the reminder date/time as ISO 8601 string (e.g., "2025-01-15T18:00:00" for 6pm on Jan 15). The time will be interpreted in the user\'s local timezone and stored as UTC.',
                            },
                        ],
                        description:
                            'Optional: Set the reminder date/time directly (timestamp or ISO string). This is also used as the alert time when alertEnabled is true. Use this for "remind me at X" or "create task at Y time" requests.',
                    },
                    alertEnabled: {
                        type: 'boolean',
                        description:
                            'Optional: Enable alert notification for this task. When true, the user will receive an alert at the time specified in dueDate. Requires dueDate to be provided. Use this for "remind me" or "alert me" requests.',
                    },
                    projectId: {
                        type: 'string',
                        description:
                            'Optional: the project ID where the task should be created. If not specified, uses the project of the current assistant.',
                    },
                    projectName: {
                        type: 'string',
                        description:
                            "Optional: the project name where the task should be created. IMPORTANT: Use the EXACT project name as shown in the user's project list - do not translate or modify it (e.g., use 'Privat' not 'Private'). If both projectId and projectName are provided, projectId takes precedence. If not specified, uses the project of the current assistant. You do NOT need to provide a project name - if omitted, the task is created in the current assistant project.",
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
                'Retrieves and shows tasks from the current project or across all projects. Use this when the user asks to see, show, list, or check their tasks. Can filter by status (open/done), date (today, yesterday, specific date), and project scope. IMPORTANT: Use this tool (not search) when asking for done/completed tasks from a specific date like "what did I complete yesterday" or "show done tasks from last week".',
            parameters: {
                type: 'object',
                properties: {
                    status: {
                        type: 'string',
                        enum: ['open', 'done', 'all'],
                        description:
                            'Filter tasks by status. NOTE: You CANNOT use the "date" filter if status is "all".',
                    },
                    date: {
                        type: 'string',
                        description:
                            'Filter tasks by date. Use "today" for today\'s tasks, YYYY-MM-DD for a single day, or "YYYY-MM-DD to YYYY-MM-DD" for a date range. Also supports keywords like "yesterday", "this week", "last month", "last 7 days".',
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
                    limit: {
                        type: 'number',
                        description:
                            'Optional: maximum number of tasks to return. Default is 100, maximum is 1000. Use higher limits when user asks for "all" tasks.',
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
                'Updates an existing task or multiple tasks at once. Use this when the user wants to mark a task as done/complete, change focus, rename, update, set reminders/alerts, set time estimations, or move a task to another project. Can search by taskId, taskName, or projectName. Can update completion status, focus status, name, description, reminder date/time, estimation, and enable/disable alerts. Supports bulk updates for today and overdue tasks only (max 100 tasks).',
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
                        description:
                            "Search for task within a specific project by project name. IMPORTANT: Use the EXACT project name as shown in the user's project list - do not translate or modify it (e.g., use 'Privat' not 'Private').",
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
                        oneOf: [
                            {
                                type: 'number',
                                description: 'Set the reminder date/time as Unix timestamp in milliseconds.',
                            },
                            {
                                type: 'string',
                                description:
                                    'Set the reminder date/time as ISO 8601 string (e.g., "2025-01-15T18:00:00" for 6pm on Jan 15). The time will be interpreted in the user\'s local timezone and stored as UTC.',
                            },
                        ],
                        description:
                            'Set the reminder date/time directly (timestamp or ISO string). This is also used as the alert time when alertEnabled is true. Use this for "remind me at X" requests.',
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
                    moveToProjectId: {
                        type: 'string',
                        description:
                            'Optional: move matched task(s) to this target project ID after updates. Works for both single-task updates and bulk updates (updateAll=true).',
                    },
                    moveToProjectName: {
                        type: 'string',
                        description:
                            "Optional: move matched task(s) to this target project name after updates. IMPORTANT: Use the exact project name as shown in the user's project list. Works for both single-task updates and bulk updates (updateAll=true).",
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
                'Updates an existing note by searching for it by title or ID. Can prepend new content with date stamp, update the note title, and move a note to another project.',
            parameters: {
                type: 'object',
                properties: {
                    noteId: {
                        type: 'string',
                        description: 'The ID of the note to update (optional, direct lookup)',
                    },
                    noteTitle: {
                        type: 'string',
                        description: 'The title of the note to update (used for searching)',
                    },
                    projectName: {
                        type: 'string',
                        description:
                            "Optional: search for the note within a specific project by project name. IMPORTANT: Use the exact project name as shown in the user's project list.",
                    },
                    projectId: {
                        type: 'string',
                        description: 'Optional: search for the note within a specific project by project ID.',
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
                    moveToProjectId: {
                        type: 'string',
                        description:
                            'Optional: move the matched note to this target project ID after applying updates.',
                    },
                    moveToProjectName: {
                        type: 'string',
                        description:
                            "Optional: move the matched note to this target project name after applying updates. IMPORTANT: Use the exact project name as shown in the user's project list.",
                    },
                },
                required: [],
            },
        },
    },

    update_user_memory: {
        type: 'function',
        function: {
            name: 'update_user_memory',
            description:
                'Saves a noteworthy fact about the current app user into their per-project memory note. The tool resolves the correct user and project from runtime context and auto-creates the project-specific user note if missing.',
            parameters: {
                type: 'object',
                properties: {
                    fact: {
                        type: 'string',
                        description: 'The concise user fact to remember',
                    },
                    category: {
                        type: 'string',
                        description:
                            'Optional short label such as preference, goal, constraint, routine, or personal context',
                    },
                    reason: {
                        type: 'string',
                        description: 'Optional brief explanation of why this fact matters',
                    },
                },
                required: ['fact'],
            },
        },
    },

    search: {
        type: 'function',
        function: {
            name: 'search',
            description:
                'Text search across tasks, notes, goals, contacts, chats, and assistants. Use this to find items by keywords in their name/content. Requires a meaningful search query (not just a date). For listing tasks by date or status without text search, use get_tasks instead.',
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

    search_gmail: {
        type: 'function',
        function: {
            name: 'search_gmail',
            description:
                "Search the user's connected Gmail accounts for relevant emails and return matching messages with participants, dates, snippets, body text, attachment metadata, Gmail labels, and special flags such as unread, inbox, important, sent, draft, starred, spam, and trash. Results include attachment metadata only (attachmentId, fileName, mimeType, sizeBytes, inline), not file bytes. Use this for questions about past email conversations, what was discussed with a person, to find specific emails, or to locate a Gmail attachment before calling get_gmail_attachment.",
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description:
                            'The Gmail search query or search phrase. Use specific names, topics, or sender/email terms that help find the relevant emails.',
                    },
                    limit: {
                        type: 'number',
                        description:
                            'Optional: maximum number of matching emails to return. Default is 10, maximum is 20.',
                    },
                    includeBodies: {
                        type: 'boolean',
                        description: 'Optional: whether to include email body text in the results. Defaults to true.',
                    },
                },
                required: ['query'],
            },
        },
    },

    get_chat_attachment: {
        type: 'function',
        function: {
            name: 'get_chat_attachment',
            description:
                'Fetch the single file attached to the user message that triggered the current assistant run. Use this before calling an external app tool when the user uploaded a file in chat and wants that file sent to the tool. Returns fileName, fileBase64, fileMimeType, fileSizeBytes, and source.',
            parameters: {
                type: 'object',
                properties: {
                    expectedFileName: {
                        type: 'string',
                        description:
                            'Optional expected file name used for validation. If provided and it does not match the triggering chat attachment, the tool returns an error.',
                    },
                },
                required: [],
            },
        },
    },

    get_gmail_attachment: {
        type: 'function',
        function: {
            name: 'get_gmail_attachment',
            description:
                'Fetch a Gmail attachment as base64 after locating it with search_gmail. Use this before calling an external app tool when the user wants to use a PDF or other file found in Gmail. Returns fileName, fileBase64, fileMimeType, fileSizeBytes, and source.',
            parameters: {
                type: 'object',
                properties: {
                    messageId: {
                        type: 'string',
                        description: 'The Gmail message ID containing the attachment.',
                    },
                    attachmentId: {
                        type: 'string',
                        description: 'The Gmail attachment ID from search_gmail results.',
                    },
                    projectId: {
                        type: 'string',
                        description:
                            'Optional project ID if the Gmail account context must be constrained to a specific connected project.',
                    },
                },
                required: ['messageId', 'attachmentId'],
            },
        },
    },

    create_gmail_reply_draft: {
        type: 'function',
        function: {
            name: 'create_gmail_reply_draft',
            description:
                'Create a Gmail draft reply in-thread for an existing email conversation. Use this when the user asks you to draft or prepare a reply email. Resolve the target using a Gmail search query, explicit messageId, or explicit threadId. If multiple matching emails exist for a query, the latest matching thread will be used.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description:
                            'Optional Gmail search query to identify the email thread to reply to. Use specific sender names, topics, or email addresses.',
                    },
                    messageId: {
                        type: 'string',
                        description: 'Optional explicit Gmail message ID to reply to.',
                    },
                    threadId: {
                        type: 'string',
                        description: 'Optional explicit Gmail thread ID to reply within.',
                    },
                    body: {
                        type: 'string',
                        description: 'The plain-text body content for the reply draft.',
                    },
                    instructions: {
                        type: 'string',
                        description:
                            'Optional fallback plain-text content if body is omitted. This is stored as the draft body as-is.',
                    },
                },
                required: [],
            },
        },
    },

    create_gmail_draft: {
        type: 'function',
        function: {
            name: 'create_gmail_draft',
            description:
                'Create a brand-new Gmail draft in the connected Gmail account for the current project. Use this when the user wants to draft or compose a new email but not send it yet.',
            parameters: {
                type: 'object',
                properties: {
                    to: {
                        oneOf: [
                            { type: 'string' },
                            {
                                type: 'array',
                                items: { type: 'string' },
                            },
                        ],
                        description: 'One or more primary recipients.',
                    },
                    cc: {
                        oneOf: [
                            { type: 'string' },
                            {
                                type: 'array',
                                items: { type: 'string' },
                            },
                        ],
                        description: 'Optional cc recipients.',
                    },
                    bcc: {
                        oneOf: [
                            { type: 'string' },
                            {
                                type: 'array',
                                items: { type: 'string' },
                            },
                        ],
                        description: 'Optional bcc recipients.',
                    },
                    subject: {
                        type: 'string',
                        description: 'The email subject line.',
                    },
                    body: {
                        type: 'string',
                        description: 'The plain-text body content for the draft.',
                    },
                },
                required: ['to', 'subject', 'body'],
            },
        },
    },

    update_gmail_draft: {
        type: 'function',
        function: {
            name: 'update_gmail_draft',
            description:
                'Update an existing Gmail draft by draftId. Use this when the user wants to revise, rewrite, shorten, or otherwise edit an already-created Gmail draft. Any omitted fields keep their current draft values.',
            parameters: {
                type: 'object',
                properties: {
                    draftId: {
                        type: 'string',
                        description: 'The Gmail draft ID to update.',
                    },
                    to: {
                        oneOf: [
                            { type: 'string' },
                            {
                                type: 'array',
                                items: { type: 'string' },
                            },
                        ],
                        description: 'Optional replacement for the primary recipients.',
                    },
                    cc: {
                        oneOf: [
                            { type: 'string' },
                            {
                                type: 'array',
                                items: { type: 'string' },
                            },
                        ],
                        description: 'Optional replacement for cc recipients.',
                    },
                    bcc: {
                        oneOf: [
                            { type: 'string' },
                            {
                                type: 'array',
                                items: { type: 'string' },
                            },
                        ],
                        description: 'Optional replacement for bcc recipients.',
                    },
                    subject: {
                        type: 'string',
                        description: 'Optional replacement subject line.',
                    },
                    body: {
                        type: 'string',
                        description: 'Optional replacement plain-text body content.',
                    },
                },
                required: ['draftId'],
            },
        },
    },

    search_calendar_events: {
        type: 'function',
        function: {
            name: 'search_calendar_events',
            description:
                "Search the user's connected Google Calendar accounts for matching events. Use this for schedule questions, calendar history, or to find meetings by person, topic, location, or date range.",
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description:
                            'Optional search phrase for event summary, attendee, description, or location. Provide this or a time range.',
                    },
                    timeMin: {
                        type: 'string',
                        description: 'Optional ISO 8601 lower bound for event start time filtering.',
                    },
                    timeMax: {
                        type: 'string',
                        description: 'Optional ISO 8601 upper bound for event start time filtering.',
                    },
                    calendarId: {
                        type: 'string',
                        description:
                            'Optional calendar ID to search. Defaults to "primary". Use this when the user specifies a non-primary calendar.',
                    },
                    limit: {
                        type: 'number',
                        description:
                            'Optional: maximum number of matching events to return. Default is 10, maximum is 20.',
                    },
                    includeDescription: {
                        type: 'boolean',
                        description:
                            'Optional: whether to include event descriptions in the results. Defaults to true.',
                    },
                },
                required: [],
            },
        },
    },

    create_calendar_event: {
        type: 'function',
        function: {
            name: 'create_calendar_event',
            description:
                'Create a Google Calendar event in a connected account. Use ISO 8601 times only. For timed events provide start/end as ISO strings or {dateTime,timeZone}; for all-day events provide {date}.',
            parameters: {
                type: 'object',
                properties: {
                    summary: {
                        type: 'string',
                        description: 'The event title/summary.',
                    },
                    description: {
                        type: 'string',
                        description: 'Optional event description.',
                    },
                    start: {
                        description: 'Event start as ISO 8601 string or Calendar API date/dateTime object.',
                        oneOf: [
                            { type: 'string' },
                            {
                                type: 'object',
                                properties: {
                                    date: { type: 'string' },
                                    dateTime: { type: 'string' },
                                    timeZone: { type: 'string' },
                                },
                            },
                        ],
                    },
                    end: {
                        description: 'Event end as ISO 8601 string or Calendar API date/dateTime object.',
                        oneOf: [
                            { type: 'string' },
                            {
                                type: 'object',
                                properties: {
                                    date: { type: 'string' },
                                    dateTime: { type: 'string' },
                                    timeZone: { type: 'string' },
                                },
                            },
                        ],
                    },
                    timeZone: {
                        type: 'string',
                        description: 'Optional IANA timezone to pair with dateTime values that omit offset details.',
                    },
                    location: {
                        type: 'string',
                        description: 'Optional event location.',
                    },
                    attendees: {
                        type: 'array',
                        description:
                            'Optional attendees. Each entry can be an email string or an object with email, displayName, optional, resource, and responseStatus.',
                        items: {
                            oneOf: [
                                { type: 'string' },
                                {
                                    type: 'object',
                                    properties: {
                                        email: { type: 'string' },
                                        displayName: { type: 'string' },
                                        optional: { type: 'boolean' },
                                        resource: { type: 'boolean' },
                                        responseStatus: { type: 'string' },
                                    },
                                    required: ['email'],
                                },
                            ],
                        },
                    },
                    calendarId: {
                        type: 'string',
                        description:
                            'Optional calendar ID to write to. Defaults to "primary". Required when multiple connected accounts make the write target ambiguous.',
                    },
                },
                required: ['summary', 'start', 'end'],
            },
        },
    },

    update_calendar_event: {
        type: 'function',
        function: {
            name: 'update_calendar_event',
            description:
                'Update an existing Google Calendar event by eventId. Provide calendarId when needed to disambiguate multiple connected accounts. If updating times, provide both start and end.',
            parameters: {
                type: 'object',
                properties: {
                    eventId: {
                        type: 'string',
                        description: 'The Google Calendar event ID to update.',
                    },
                    summary: {
                        type: 'string',
                        description: 'Optional new event title/summary.',
                    },
                    description: {
                        type: 'string',
                        description: 'Optional new event description.',
                    },
                    start: {
                        description: 'Optional new start as ISO 8601 string or Calendar API date/dateTime object.',
                        oneOf: [
                            { type: 'string' },
                            {
                                type: 'object',
                                properties: {
                                    date: { type: 'string' },
                                    dateTime: { type: 'string' },
                                    timeZone: { type: 'string' },
                                },
                            },
                        ],
                    },
                    end: {
                        description: 'Optional new end as ISO 8601 string or Calendar API date/dateTime object.',
                        oneOf: [
                            { type: 'string' },
                            {
                                type: 'object',
                                properties: {
                                    date: { type: 'string' },
                                    dateTime: { type: 'string' },
                                    timeZone: { type: 'string' },
                                },
                            },
                        ],
                    },
                    timeZone: {
                        type: 'string',
                        description: 'Optional IANA timezone to pair with dateTime values that omit offset details.',
                    },
                    location: {
                        type: 'string',
                        description: 'Optional new event location.',
                    },
                    attendees: {
                        type: 'array',
                        description: 'Optional full attendee list replacement.',
                        items: {
                            oneOf: [
                                { type: 'string' },
                                {
                                    type: 'object',
                                    properties: {
                                        email: { type: 'string' },
                                        displayName: { type: 'string' },
                                        optional: { type: 'boolean' },
                                        resource: { type: 'boolean' },
                                        responseStatus: { type: 'string' },
                                    },
                                    required: ['email'],
                                },
                            ],
                        },
                    },
                    calendarId: {
                        type: 'string',
                        description:
                            'Optional calendar ID containing the event. Provide this when the event is not on the primary calendar or multiple accounts are connected.',
                    },
                },
                required: ['eventId'],
            },
        },
    },

    delete_calendar_event: {
        type: 'function',
        function: {
            name: 'delete_calendar_event',
            description:
                'Delete an existing Google Calendar event by exact eventId only. Provide calendarId when needed to disambiguate multiple connected accounts.',
            parameters: {
                type: 'object',
                properties: {
                    eventId: {
                        type: 'string',
                        description: 'The Google Calendar event ID to delete.',
                    },
                    calendarId: {
                        type: 'string',
                        description:
                            'Optional calendar ID containing the event. Provide this when the event is not on the primary calendar or multiple accounts are connected.',
                    },
                },
                required: ['eventId'],
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
