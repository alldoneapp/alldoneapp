import { translate } from '../i18n/TranslationService'
import { SELECTABLE_ASSISTANT_MODELS } from '../functions/Assistant/selectableAssistantModels'
import {
    computeAssistantTaskContentHash,
    isAssistantTaskContentApprovedByUser,
} from '../functions/Assistant/assistantTaskContentHash'

// security audit 2026-11 (UrlWrapper remote-embed-open-attribute-runs-performAction-on-mount, and the
// NEW-A follow-up): a pre-configured task is member-editable, and running it spends the viewer's
// Gold with the viewer's tool authority. A link to one can sit in shared content, and the assistant
// line runs one on a single click. So a run asks first whenever the viewer has not approved exactly
// the content that would run — prompt, system instruction, model and settings, hashed the same way
// the server binds scheduled runs (functions/Assistant/assistantTaskContentHash.js) — and shows them
// all three. Confirming records the approval for the viewer only, server-side, so the next click on
// the same content runs straight away.
export const PROMPT_PREVIEW_MAX_LENGTH = 1500

export const viewerAuthoredPreConfigTask = (task, viewerId) =>
    !!viewerId && !!task?.creatorUserId && task.creatorUserId === viewerId

const preview = value => {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text.length <= PROMPT_PREVIEW_MAX_LENGTH) return text
    return `${text.slice(0, PROMPT_PREVIEW_MAX_LENGTH)}…`
}

const modelLabel = task => {
    const override = typeof task?.aiModelOverride === 'string' ? task.aiModelOverride.trim() : ''
    if (!override) return translate('pre_config_task_run_confirm_model_default')
    const entry = SELECTABLE_ASSISTANT_MODELS.find(option => option.model === override)
    return entry?.labelKey ? translate(entry.labelKey) : override
}

export const buildPreConfigTaskRunConfirmation = task =>
    translate('pre_config_task_link_run_confirm', {
        name: task?.name || '',
        prompt: preview(task?.prompt) || translate('pre_config_task_link_run_confirm_no_prompt'),
        systemMessage: preview(task?.aiSystemMessage) || translate('pre_config_task_run_confirm_no_system_message'),
        model: modelLabel(task),
    })

export const preConfigTaskApprovedByViewer = (task, viewerId, taskProjectId) =>
    !!viewerId && !!task && isAssistantTaskContentApprovedByUser(task, viewerId, taskProjectId)

const defaultApprove = request =>
    require('./backends/Assistants/assistantTaskApproval').approveAssistantTaskContent(request)

// Returns true when the run may go ahead. `confirm` is window.confirm in the app. `taskProjectId` is
// the project the task document lives in (globalProject for the curated catalog).
export function confirmPreConfigTaskRun(
    task,
    viewerId,
    {
        confirm = typeof window !== 'undefined' ? window.confirm : null,
        taskProjectId,
        assistantId,
        approve = defaultApprove,
    } = {}
) {
    if (!viewerId || !task) return false
    if (preConfigTaskApprovedByViewer(task, viewerId, taskProjectId)) return true
    if (typeof confirm !== 'function') return false
    if (confirm(buildPreConfigTaskRunConfirmation(task)) !== true) return false

    const resolvedAssistantId = assistantId || task.assistantId
    if (taskProjectId && resolvedAssistantId && task.id) {
        Promise.resolve()
            .then(() =>
                approve({
                    projectId: taskProjectId,
                    assistantId: resolvedAssistantId,
                    taskId: task.id,
                    expectedHash: computeAssistantTaskContentHash(task),
                })
            )
            .catch(error => console.warn('Could not record the task approval', error?.message || error))
    }
    return true
}

// Kept for the link call sites: (task, viewerId, confirm, options).
export function confirmPreConfigTaskRunFromLink(task, viewerId, confirm = window.confirm, options = {}) {
    return confirmPreConfigTaskRun(task, viewerId, { ...options, confirm })
}
