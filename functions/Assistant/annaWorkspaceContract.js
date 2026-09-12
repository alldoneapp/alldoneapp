// Shared, dependency-free contract for the Anna presentation surface.
const TOOL_NAME = 'show_workspace'
const showWorkspaceSchema = {
    type: 'function',
    function: {
        name: TOOL_NAME,
        description:
            "Show a real alldone task, note, goal, project list, or your portrait in the user's Anna workspace. Does not mutate the displayed work. Use verified IDs; projectId is required for individual objects and optional for cross-project lists. A successful result only queues presentation; the user may keep their current view open.",
        parameters: {
            type: 'object',
            properties: {
                view: { type: 'string', enum: ['anna', 'tasks', 'notes', 'goals', 'task', 'note', 'goal'] },
                projectId: { type: 'string', description: 'Exact project ID. Omit for all-project lists.' },
                objectId: { type: 'string', description: 'Exact ID for a single task, note or goal.' },
            },
            required: ['view'],
            additionalProperties: false,
        },
    },
}

function isAnnaWorkspacePath(path) {
    return (
        typeof path === 'string' &&
        path.length <= 700 &&
        (/^\/projects\/(tasks\/open|notes\/all|goals\/open)$/.test(path) ||
            /^\/projects\/[a-zA-Z0-9_-]+\/user\/[a-zA-Z0-9_-]+\/(tasks\/open|notes\/all|goals\/open)$/.test(path) ||
            /^\/projects\/[a-zA-Z0-9_-]+\/(tasks\/[a-zA-Z0-9_-]+\/properties|notes\/[a-zA-Z0-9_-]+\/editor|goals\/[a-zA-Z0-9_-]+\/properties)$/.test(
                path
            ))
    )
}
const highlightWorkspaceSchema = {
    type: 'function',
    function: {
        name: 'highlight_workspace',
        description:
            'Point to visible workspace text without editing it. First inspect the current screen to get screenId and targetId, then mark one target or an exact unique quote within it. Never invent target IDs. Inspect again after navigation or a stale target. Returns queued, not proof the user saw it. Clear removes the marker.',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['inspect', 'mark', 'clear'] },
                screenId: { type: 'string' },
                targetId: { type: 'string' },
                quote: {
                    type: 'string',
                    maxLength: 240,
                    description: 'Optional exact, unique substring of the inspected target.',
                },
                label: { type: 'string', maxLength: 80, description: 'Short explanation, in the user language.' },
                style: { type: 'string', enum: ['marker', 'outline'] },
                durationSeconds: { type: 'number', minimum: 3, maximum: 20 },
            },
            required: ['action'],
            additionalProperties: false,
        },
    },
}
module.exports = { TOOL_NAME, showWorkspaceSchema, highlightWorkspaceSchema, isAnnaWorkspacePath }
