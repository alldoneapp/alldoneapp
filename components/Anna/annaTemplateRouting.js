import { getPreConfigTaskModelOverride } from '../../functions/Assistant/preConfigTaskModel'
import { getPreConfigTaskReasoningEffortOverride } from '../../functions/Assistant/preConfigTaskReasoningEffort'
import { TASK_EXECUTION_MODE_WORKFLOW } from '../../utils/taskExecutionMode'

/**
 * AT-3153: where a template picked in the Anna chat runs.
 *
 * `chat`: the template's prompt is sent as a normal message in the current chat. It shows up at
 * once and the chat's assistant answers it on the normal chat path (live status, tool actions,
 * queueing, retry, run lock).
 *
 * `task`: the template keeps its own task (AT-3082), because the chat path cannot apply what the
 * template brings with it. That covers a template of another assistant or project, its own model,
 * reasoning effort or instructions, WhatsApp delivery, a webhook, and workflow mode. The prompt
 * still shows up at once in the current chat, with a status line while the task runs.
 *
 * Product decision (Karsten, 2026-11-24): "wie normale Nachricht", special cases stay a task.
 */
export const ANNA_TEMPLATE_ROUTE_CHAT = 'chat'
export const ANNA_TEMPLATE_ROUTE_TASK = 'task'

const TEMPLATE_TYPE_PROMPT = 'prompt'

const normalizeText = value => (typeof value === 'string' ? value.trim() : '')

// Saving a prompt template copies the assistant's instructions into `aiSystemMessage` when the
// field was left empty (PreConfigTaskModal), so a copy of the current instructions is no override.
const hasOwnInstructions = template => {
    const own = normalizeText(template?.aiSystemMessage)
    return !!own && own !== normalizeText(template?.assistant?.instructions)
}

export const getAnnaTemplateRoute = (template, { projectId, assistantId } = {}, prompt = template?.prompt) => {
    if (!template || template.type !== TEMPLATE_TYPE_PROMPT) return ANNA_TEMPLATE_ROUTE_TASK
    if (!normalizeText(prompt)) return ANNA_TEMPLATE_ROUTE_TASK
    if (!projectId || !assistantId) return ANNA_TEMPLATE_ROUTE_TASK
    if (template.projectId !== projectId || template.assistantId !== assistantId) return ANNA_TEMPLATE_ROUTE_TASK
    if (getPreConfigTaskModelOverride(template) || normalizeText(template.aiModel)) return ANNA_TEMPLATE_ROUTE_TASK
    if (getPreConfigTaskReasoningEffortOverride(template) !== undefined) return ANNA_TEMPLATE_ROUTE_TASK
    if (hasOwnInstructions(template)) return ANNA_TEMPLATE_ROUTE_TASK
    if (template.sendWhatsApp) return ANNA_TEMPLATE_ROUTE_TASK
    if (template.executionMode === TASK_EXECUTION_MODE_WORKFLOW) return ANNA_TEMPLATE_ROUTE_TASK
    if (template.taskMetadata?.isWebhookTask) return ANNA_TEMPLATE_ROUTE_TASK
    return ANNA_TEMPLATE_ROUTE_CHAT
}

// What the user sees as their own message. A webhook template has no prompt; its name stands in.
export const getAnnaTemplateMessageText = (template, prompt = template?.prompt) =>
    normalizeText(prompt) || normalizeText(template?.name)
