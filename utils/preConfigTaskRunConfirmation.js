import { translate } from '../i18n/TranslationService'

// security audit 2026-11 (UrlWrapper remote-embed-open-attribute-runs-performAction-on-mount): a link to
// a pre-configured task can sit in shared content — a note, a comment — that someone else wrote, and
// running it spends the viewer's Gold and uses the viewer's tool authority. A press on the link is
// required, and when the viewer did not write the prompt they are first shown the prompt itself.
export const PROMPT_PREVIEW_MAX_LENGTH = 1500

export const viewerAuthoredPreConfigTask = (task, viewerId) =>
    !!viewerId && !!task?.creatorUserId && task.creatorUserId === viewerId

const previewPrompt = prompt => {
    const text = typeof prompt === 'string' ? prompt.trim() : ''
    if (text.length <= PROMPT_PREVIEW_MAX_LENGTH) return text
    return `${text.slice(0, PROMPT_PREVIEW_MAX_LENGTH)}…`
}

export const buildPreConfigTaskRunConfirmation = task =>
    translate('pre_config_task_link_run_confirm', {
        name: task?.name || '',
        prompt: previewPrompt(task?.prompt) || translate('pre_config_task_link_run_confirm_no_prompt'),
    })

// Returns true when the run may go ahead. `confirm` is window.confirm in the app.
export function confirmPreConfigTaskRunFromLink(task, viewerId, confirm = window.confirm) {
    if (viewerAuthoredPreConfigTask(task, viewerId)) return true
    if (typeof confirm !== 'function') return false
    return confirm(buildPreConfigTaskRunConfirmation(task)) === true
}
