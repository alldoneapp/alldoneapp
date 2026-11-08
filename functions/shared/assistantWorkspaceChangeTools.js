/**
 * AT-2926 — the tools whose execution visibly changes an Alldone object (a task, a note, a
 * contact, a comment thread, an artifact, the project description or the project wiki).
 *
 * In assistant mode the bezel around the Alldone workspace turns blue only while one of
 * these is running, so the blue edge means "the assistant is changing your workspace right
 * now" rather than "the assistant is busy". Reads, web/email/calendar work, settings and
 * memory, delegation and VM hand-offs deliberately do not count.
 *
 * An allowlist on purpose: a new or unknown tool (MCP, external tools, a future write)
 * leaves the edge in its default colour until it is added here, which is the harmless
 * direction — a blue edge for something that does not touch the workspace is exactly the
 * misleading signal this exists to remove.
 */
const WORKSPACE_CHANGE_TOOLS = new Set([
    'create_task',
    'update_task',
    'create_note',
    'update_note',
    'update_contact',
    'add_chat_comment',
    'create_artifact',
    'update_artifact',
    'update_project_description',
    'correct_knowledge_page',
    'undo_knowledge_correction',
    'add_knowledge_document',
    'remove_knowledge_document',
    'save_knowledge_contribution',
    'remove_knowledge_contribution',
])

const isWorkspaceChangeTool = toolName => WORKSPACE_CHANGE_TOOLS.has(String(toolName || '').trim())

// `toolCalls` are OpenAI-style `{ function: { name } }` entries; `activeIndexes` are the
// positions currently executing (toolCallBatch's `active`).
const isChangingWorkspace = (toolCalls, activeIndexes) =>
    (Array.isArray(activeIndexes) ? activeIndexes : []).some(index =>
        isWorkspaceChangeTool(toolCalls?.[index]?.function?.name)
    )

module.exports = { WORKSPACE_CHANGE_TOOLS, isWorkspaceChangeTool, isChangingWorkspace }
