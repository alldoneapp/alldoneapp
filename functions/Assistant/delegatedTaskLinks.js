'use strict'

/**
 * The link to the task delegated work continues in, always visible in the conversation that asked
 * for it (AT-3096, 2026-11-18).
 *
 * When an assistant hands work to a task (create_task with trackAssistantWork, or execute_task_in_vm
 * creating or joining a delegated workflow task), the reply in the commissioning chat was model
 * prose: "Die Umsetzung läuft in **AT-3095** weiter" with no way into the task. The result notices
 * (VM result, review, step change, VM question) already carry the task link because the server
 * writes them. This module gives the hand-off reply the same guarantee, mirroring
 * ensureCreatedNoteLinksInResponse and ensureVmHostThreadLinksInResponse:
 *
 *  - the tool result names the delegated task (`delegatedTask`, built from the ids the tool actually
 *    resolved, never from model text), and also carries `taskUrl` so the model can link it itself;
 *  - after the run, the reply gets the canonical link appended unless it already has it, and any
 *    other URL of the same task (wrong project, missing `/chat`) is rewritten to the canonical one;
 *  - no link is added when the reply is written in that very task's chat.
 *
 * Pure apart from the lazily required notice strings, so it is testable without assistantHelper.
 */

/** The canonical chat link of a task, the same form every server notice uses. '' when incomplete. */
function buildTaskChatUrl(baseUrl, projectId, taskId) {
    const base = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : ''
    const pid = typeof projectId === 'string' ? projectId.trim() : ''
    const tid = typeof taskId === 'string' ? taskId.trim() : ''
    if (!base || !pid || !tid || /[\s/]/.test(pid) || /[\s/]/.test(tid)) return ''
    return `${base}/projects/${pid}/tasks/${tid}/chat`
}

/**
 * The reference a tool result carries for the task its work continues in, or null.
 * MUST stay idempotent (collectors store the normalized shape, consumers normalize again).
 * The URL has to be exactly the canonical link of those ids, so a placeholder or a link to some
 * other task can never be appended.
 */
function normalizeDelegatedTaskHandoff(value) {
    if (!value || typeof value !== 'object') return null
    const projectId = typeof value.projectId === 'string' ? value.projectId.trim() : ''
    const taskId = typeof value.taskId === 'string' ? value.taskId.trim() : ''
    const url = typeof value.url === 'string' ? value.url.trim() : ''
    if (!projectId || !taskId || !url) return null
    if (!url.endsWith(`/projects/${projectId}/tasks/${taskId}/chat`)) return null
    const humanReadableId = typeof value.humanReadableId === 'string' ? value.humanReadableId.trim() : ''
    return { projectId, taskId, url, ...(humanReadableId ? { humanReadableId } : {}) }
}

/** The `delegatedTask` field a tool result gets, or null when the ids are incomplete. */
function buildDelegatedTaskHandoff({ baseUrl, projectId, taskId, humanReadableId = '' } = {}) {
    return normalizeDelegatedTaskHandoff({
        projectId,
        taskId,
        url: buildTaskChatUrl(baseUrl, projectId, taskId),
        humanReadableId: typeof humanReadableId === 'string' ? humanReadableId : '',
    })
}

/**
 * Adds `taskUrl` and `delegatedTask` to a successful tool result that hands work to a task. A
 * failed result, or one without both ids, is returned unchanged.
 */
function withDelegatedTaskLink(toolResult, { baseUrl, projectId, taskId, humanReadableId } = {}) {
    if (!toolResult || typeof toolResult !== 'object' || toolResult.success === false) return toolResult
    const handoff = buildDelegatedTaskHandoff({
        baseUrl,
        projectId: projectId || toolResult.projectId,
        taskId: taskId || toolResult.taskId,
        humanReadableId: humanReadableId || toolResult.task?.humanReadableId || '',
    })
    if (!handoff) return toolResult
    return { ...toolResult, taskUrl: handoff.url, delegatedTask: handoff }
}

/**
 * Collect the delegated tasks one tool result names into the run's accumulator, deduplicated by
 * task. Two sources count: the tool's own `delegatedTask`, and a delegated assistant's result
 * (talk_to_assistant_*) reporting the tasks the delegate handed work to.
 */
function collectDelegatedTaskHandoffs(collected, toolResult) {
    const handoffs = Array.isArray(collected) ? collected : []
    if (!toolResult || typeof toolResult !== 'object' || toolResult.success === false) return handoffs
    const candidates = []
    if (toolResult.delegatedTask) candidates.push(toolResult.delegatedTask)
    if (Array.isArray(toolResult.delegatedTaskResults)) candidates.push(...toolResult.delegatedTaskResults)
    for (const candidate of candidates) {
        const handoff = normalizeDelegatedTaskHandoff(candidate)
        if (
            handoff &&
            !handoffs.some(existing => existing.taskId === handoff.taskId && existing.projectId === handoff.projectId)
        )
            handoffs.push(handoff)
    }
    return handoffs
}

const URL_PATTERN = /https?:\/\/[^\s<>()\[\]{}"']+/g
const TRAILING_PUNCTUATION = /[.,;:!?…»”“’]+$/u

function pointsAtTask(candidate, taskId) {
    try {
        const segments = new URL(candidate).pathname.split('/').filter(Boolean)
        return segments.some((segment, index) => segment === 'tasks' && segments[index + 1] === taskId)
    } catch (_) {
        return false
    }
}

/** Rewrites every URL of this task in the text (other project, no `/chat`) to the canonical link. */
function replaceTaskUrls(text, handoff) {
    return text.replace(URL_PATTERN, match => {
        const trailing = (match.match(TRAILING_PUNCTUATION) || [''])[0]
        const candidate = trailing ? match.slice(0, -trailing.length) : match
        if (candidate === handoff.url || !pointsAtTask(candidate, handoff.taskId)) return match
        return `${handoff.url}${trailing}`
    })
}

function buildFollowLine(handoff, language) {
    const { noticeText } = require('./noticeLanguage')
    const label = handoff.humanReadableId
        ? noticeText(language, 'taskLink.followId', { id: handoff.humanReadableId })
        : noticeText(language, 'taskLink.follow')
    return `${label} ${handoff.url}`
}

/**
 * Guarantee the reply links every task its delegated work continues in.
 *
 * @param {string} responseText the final reply
 * @param {Array} handoffs collected `delegatedTask` references
 * @param {{projectId, objectType, objectId}} currentThread the conversation the reply is written in
 * @param {{language}} options the user's language for the added line (English by default)
 */
function ensureDelegatedTaskLinksInResponse(responseText, handoffs = [], currentThread = null, { language } = {}) {
    let response = typeof responseText === 'string' ? responseText.trim() : ''
    const seen = new Set()
    const currentProjectId = String(currentThread?.projectId || '').trim()
    const currentObjectId = String(currentThread?.objectId || '').trim()
    const currentObjectType = String(currentThread?.objectType || 'tasks').trim() || 'tasks'

    for (const handoff of (Array.isArray(handoffs) ? handoffs : [])
        .map(normalizeDelegatedTaskHandoff)
        .filter(Boolean)) {
        const key = `${handoff.projectId}/${handoff.taskId}`
        if (seen.has(key)) continue
        seen.add(key)
        // The user is reading that task's own chat: a link to where they are is noise.
        if (
            currentObjectType === 'tasks' &&
            currentObjectId === handoff.taskId &&
            currentProjectId === handoff.projectId
        )
            continue

        response = replaceTaskUrls(response, handoff)
        if (response.includes(handoff.url)) continue
        const line = buildFollowLine(handoff, language)
        response = response ? `${response}\n\n${line}` : line
    }

    return response
}

module.exports = {
    buildTaskChatUrl,
    buildDelegatedTaskHandoff,
    normalizeDelegatedTaskHandoff,
    withDelegatedTaskLink,
    collectDelegatedTaskHandoffs,
    ensureDelegatedTaskLinksInResponse,
}
