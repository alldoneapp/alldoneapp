/**
 * The `instructions` the Alldone MCP server hands a client in its `initialize` result (and in the
 * GET discovery response). MCP clients put this text into the model's context, so it is the one
 * place every connected agent reads before choosing a tool.
 *
 * Alldone is the user's system of record (AT-2832): durable work state and results belong in Alldone
 * objects, where the user and every later session find them, not only in the agent's own memory or
 * chat. The browser surfaces say the same in `utils/browserAgent/browserAgentApi.js`
 * (`SYSTEM_OF_RECORD_INSTRUCTIONS`) and `/llms.txt`; Functions code cannot enter the web bundle, so
 * keep the three in step by hand. Keep the complete MCP instructions within 512 characters so
 * clients do not truncate the guidance. Only name tools the server actually serves
 * (`MCP_DELEGATED_ASSISTANT_TOOLS`); `mcpServerSimple.test.js` checks both constraints.
 */

const SYSTEM_OF_RECORD_INSTRUCTIONS = [
    "Alldone is the user's system of record. OAuth required; act within the signed-in user's permissions.",
    "Find existing objects with get_tasks, get_notes or search; update, don't duplicate.",
    'Track follow-up in tasks: update_task(comment) records progress, decisions, blockers and results; complete finished tasks.',
    'Save long results via create_note/update_note or create_artifact/update_artifact; link them in task comments.',
    'Keep durable state here, not only in chat or files. Skip trivial steps. Report missing tools.',
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

const buildMcpServerInstructions = () => SYSTEM_OF_RECORD_INSTRUCTIONS

module.exports = {
    SYSTEM_OF_RECORD_INSTRUCTIONS,
    SYSTEM_OF_RECORD_TOOL_NAMES,
    buildMcpServerInstructions,
}
