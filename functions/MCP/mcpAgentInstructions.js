/**
 * The `instructions` the Alldone MCP server hands a client in its `initialize` result (and in the
 * GET discovery response). MCP clients put this text into the model's context, so it is the one
 * place every connected agent reads before choosing a tool.
 *
 * Alldone is the user's system of record (AT-2832): durable work state and results belong in Alldone
 * objects, where the user and every later session find them, not only in the agent's own memory or
 * chat. The browser surfaces say the same in `utils/browserAgent/browserAgentApi.js`
 * (`SYSTEM_OF_RECORD_INSTRUCTIONS`) and `/llms.txt`; Functions code cannot enter the web bundle, so
 * keep the three in step by hand. Only name tools the server actually serves
 * (`MCP_DELEGATED_ASSISTANT_TOOLS`); `mcpAgentInstructions.test.js` checks that.
 */

const SERVER_DESCRIPTION =
    'This is the Alldone MCP Server providing access to task management, project organization, and productivity tools. Every tool acts as the signed-in Alldone user, with exactly their permissions.'

const SYSTEM_OF_RECORD_INSTRUCTIONS = [
    "Alldone is the user's system of record. Keep durable work state and results in Alldone objects (tasks, notes, artifacts), not only in your own memory, chat or local files, so the user and any later session can pick up from there.",
    'Look for the existing object first (get_tasks, get_notes, search) and update it rather than creating a duplicate.',
    'Work that needs follow-up is a task. Add progress, decisions, blockers and results as a comment on the task it belongs to (update_task with comment), and complete the task when the work is done.',
    'Put longer results in a note (create_note / update_note) or an artifact (create_artifact / update_artifact) and mention it in the task comment instead of repeating it.',
    'Skip trivial or throwaway steps and do not record the same thing in several places. If a tool you need is not offered, tell the user rather than keeping the state elsewhere.',
].join(' ')

// Tool names the instructions mention, so a test can prove each one is really served over MCP.
const SYSTEM_OF_RECORD_TOOL_NAMES = [
    'get_tasks',
    'get_notes',
    'search',
    'update_task',
    'create_note',
    'update_note',
    'create_artifact',
    'update_artifact',
]

const buildMcpServerInstructions = authenticationNote =>
    [SERVER_DESCRIPTION, SYSTEM_OF_RECORD_INSTRUCTIONS, authenticationNote].filter(Boolean).join(' ')

module.exports = {
    SYSTEM_OF_RECORD_INSTRUCTIONS,
    SYSTEM_OF_RECORD_TOOL_NAMES,
    buildMcpServerInstructions,
}
