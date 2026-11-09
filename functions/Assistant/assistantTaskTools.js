'use strict'

/**
 * The schemas of the scheduled assistant task tools (create_assistant_task, get_assistant_tasks,
 * update_assistant_task), in a module with no dependencies so MCP/mcpWorkspaceSetupTools.js can
 * serve them and Assistant/workspaceToolsForAssistants.js can derive the assistant versions from the
 * same definitions. The handlers are in mcpWorkspaceSetupTools.js.
 */

const ASSISTANT_TASKS_TOOL_KEY = 'assistant_tasks'
const ASSISTANT_TASK_TOOL_NAMES = ['create_assistant_task', 'get_assistant_tasks', 'update_assistant_task']
const ASSISTANT_TASK_TOOL_NAME_SET = new Set(ASSISTANT_TASK_TOOL_NAMES)

const isAssistantTaskToolName = toolName => ASSISTANT_TASK_TOOL_NAME_SET.has(toolName)

const RECURRENCE_VALUES = [
    'once',
    'daily',
    'everyWorkday',
    'weekly',
    'every2Weeks',
    'every3Weeks',
    'monthly',
    'every3Months',
    'every6Months',
    'annually',
]

const SCHEDULED_TASK_GOAL_DESCRIPTION =
    'Optional goal (from get_goals, in the same project) that every run of this task is filed under: each run creates its task with this goal as parent.'

const ASSISTANT_TASK_MCP_SCHEMAS = [
    {
        name: 'create_assistant_task',
        description:
            "Create a pre-configured assistant task that the assistant runs on a schedule for the signed-in user (e.g. a daily research run or a weekly review). Each run creates a task assigned to the assistant with the user as observer, and the assistant's answer is posted in that task's thread. Runs cost Gold like any assistant run. If the assistant already has a task with exactly this name, that task is returned instead. Returns the taskId and the first run time.",
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'The project the assistant belongs to.' },
                assistantId: { type: 'string', description: 'The assistant (from create_assistant).' },
                name: { type: 'string', description: 'Task name, e.g. "Weekly growth review".' },
                prompt: { type: 'string', description: 'What the assistant should do on every run.' },
                recurrence: {
                    type: 'string',
                    description: `How often it runs: ${RECURRENCE_VALUES.join(
                        ', '
                    )}, or custom:<days> (e.g. custom:3).`,
                },
                startDate: {
                    type: 'string',
                    description: "Optional first run date as YYYY-MM-DD in the user's timezone. Default today.",
                },
                startTime: {
                    type: 'string',
                    description: "Optional run time as HH:mm (24h) in the user's timezone. Default 08:00.",
                },
                sendWhatsApp: {
                    type: 'boolean',
                    description: 'Optional: also send each result to the user on WhatsApp. Default false.',
                },
                parentGoalId: {
                    type: 'string',
                    description: SCHEDULED_TASK_GOAL_DESCRIPTION,
                },
            },
            required: ['projectId', 'assistantId', 'name', 'prompt', 'recurrence'],
        },
    },
    {
        name: 'get_assistant_tasks',
        description:
            "List an assistant's scheduled tasks: name, the full prompt, how often and when it runs for the signed-in user, whether it is active for them, the goal its runs are filed under, and when it last ran. Use it to find a taskId and to read the current prompt before update_assistant_task.",
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'The project the assistant belongs to.' },
                assistantId: { type: 'string', description: 'The assistant.' },
            },
            required: ['projectId', 'assistantId'],
        },
    },
    {
        name: 'update_assistant_task',
        description:
            "Change a scheduled assistant task: its prompt, its name, how often or when it runs, whether results also go to WhatsApp, the goal its runs are filed under, or pause and resume it for the signed-in user. Find the task by taskId (from get_assistant_tasks) or taskName. Only the fields you pass change; a call that changes nothing writes nothing. The start date anchors the rhythm (a weekly task runs on that date's weekday), so changing only startTime keeps the existing start date.",
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'The project the assistant belongs to.' },
                assistantId: { type: 'string', description: 'The assistant.' },
                taskId: { type: 'string', description: 'The task (from get_assistant_tasks).' },
                taskName: { type: 'string', description: 'Alternative to taskId: the exact task name.' },
                name: { type: 'string', description: 'New task name.' },
                prompt: { type: 'string', description: 'New complete prompt; replaces the old one.' },
                recurrence: {
                    type: 'string',
                    description: `New rhythm: ${RECURRENCE_VALUES.join(', ')}, or custom:<days>.`,
                },
                startDate: {
                    type: 'string',
                    description: "New start date as YYYY-MM-DD in the user's timezone.",
                },
                startTime: {
                    type: 'string',
                    description: "New run time as HH:mm (24h) in the user's timezone.",
                },
                sendWhatsApp: {
                    type: 'boolean',
                    description: 'Also send each result to the user on WhatsApp.',
                },
                active: {
                    type: 'boolean',
                    description: 'false pauses the task for the signed-in user, true resumes it.',
                },
                parentGoalId: {
                    type: ['string', 'null'],
                    description: `${SCHEDULED_TASK_GOAL_DESCRIPTION} null or an empty string removes it.`,
                },
            },
            required: ['projectId', 'assistantId'],
        },
    },
]

module.exports = {
    ASSISTANT_TASKS_TOOL_KEY,
    ASSISTANT_TASK_TOOL_NAMES,
    ASSISTANT_TASK_MCP_SCHEMAS,
    RECURRENCE_VALUES,
    SCHEDULED_TASK_GOAL_DESCRIPTION,
    isAssistantTaskToolName,
}
