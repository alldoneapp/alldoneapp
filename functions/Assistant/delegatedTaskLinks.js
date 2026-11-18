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
 * And the opposite guarantee (2026-11-18, task Q2XA2dxekAsf9QjI24yS): when the work continues in the
 * very task whose chat the user is in, the reply carries NO link to it. execute_task_in_vm, asked in
 * a delegated task's own chat, answered `workflow_managed` with a `taskUrl` of that same task, and
 * the model wrote "The result will appear here: <link to this task>". Such a result now names the
 * task only as `continuesInCurrentConversation` (no URL the model could copy), and the safety net
 * removes a link to the current conversation the model wrote anyway.
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
 * other task can never be appended. A hand-off into the conversation the tool ran in is kept as
 * `{ projectId, taskId, currentConversation: true }` without any URL: nothing is ever appended for
 * it, it only tells the safety net to remove a link to that conversation.
 */
function normalizeDelegatedTaskHandoff(value) {
    if (!value || typeof value !== 'object') return null
    const projectId = typeof value.projectId === 'string' ? value.projectId.trim() : ''
    const taskId = typeof value.taskId === 'string' ? value.taskId.trim() : ''
    if (!projectId || !taskId || /[\s/]/.test(projectId) || /[\s/]/.test(taskId)) return null
    if (value.currentConversation === true) return { projectId, taskId, currentConversation: true }
    const url = typeof value.url === 'string' ? value.url.trim() : ''
    if (!url) return null
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
 * Whether a task reference is the task whose chat the reply is written in. Only a task chat counts:
 * a topic chat never "is" a task, so a hand-off from a chat always gets its link.
 */
function isCurrentConversationTask(ref, currentThread) {
    const currentObjectId = String(currentThread?.objectId || '').trim()
    if (!ref || !currentObjectId) return false
    const currentObjectType = String(currentThread?.objectType || 'tasks').trim() || 'tasks'
    const currentProjectId = String(currentThread?.projectId || '').trim()
    return currentObjectType === 'tasks' && ref.taskId === currentObjectId && ref.projectId === currentProjectId
}

const CURRENT_CONVERSATION_INSTRUCTION =
    "The user is already in this task's conversation, where the work continues. Do not link this task " +
    'or tell the user where to find it; just say what happens next.'

/**
 * Adds `taskUrl` and `delegatedTask` to a successful tool result that hands work to a task. A
 * failed result, or one without both ids, is returned unchanged.
 *
 * `currentThread` is the conversation the tool runs in. When the work continues in that very task,
 * the result gets no URL at all (the model passed `taskUrl` on as "the result will appear here"),
 * only `continuesInCurrentConversation` and an instruction not to link it.
 */
function withDelegatedTaskLink(toolResult, { baseUrl, projectId, taskId, humanReadableId, currentThread } = {}) {
    if (!toolResult || typeof toolResult !== 'object' || toolResult.success === false) return toolResult
    const handoff = buildDelegatedTaskHandoff({
        baseUrl,
        projectId: projectId || toolResult.projectId,
        taskId: taskId || toolResult.taskId,
        humanReadableId: humanReadableId || toolResult.task?.humanReadableId || '',
    })
    if (!handoff) return toolResult
    if (isCurrentConversationTask(handoff, currentThread)) {
        const { taskUrl, ...rest } = toolResult
        return {
            ...rest,
            continuesInCurrentConversation: true,
            linkInstruction: CURRENT_CONVERSATION_INSTRUCTION,
            delegatedTask: { projectId: handoff.projectId, taskId: handoff.taskId, currentConversation: true },
        }
    }
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

function pointsAtObject(candidate, routeSegment, objectId) {
    try {
        const segments = new URL(candidate).pathname.split('/').filter(Boolean)
        return segments.some((segment, index) => segment === routeSegment && segments[index + 1] === objectId)
    } catch (_) {
        return false
    }
}

function pointsAtTask(candidate, taskId) {
    return pointsAtObject(candidate, 'tasks', taskId)
}

const splitTrailing = match => {
    const trailing = (match.match(TRAILING_PUNCTUATION) || [''])[0]
    return { candidate: trailing ? match.slice(0, -trailing.length) : match, trailing }
}

/**
 * Removes every link to the conversation the reply is written in (`/tasks/<id>`, or `/chats/<id>`
 * for a topic) and tidies what the link leaves behind, so "The result will appear here: <link>"
 * becomes "The result will appear here." A markdown link keeps its label. Links to anything else,
 * other tasks included, stay untouched. Used only when the run handed its work to this very
 * conversation: there a link to it is a link to where the user already is.
 */
function removeCurrentThreadLinks(responseText, currentThread) {
    const text = typeof responseText === 'string' ? responseText : ''
    const objectId = String(currentThread?.objectId || '').trim()
    if (!text || !objectId) return text
    const objectType = String(currentThread?.objectType || 'tasks').trim() || 'tasks'
    const routeSegment = objectType === 'topics' ? 'chats' : objectType
    const isCurrent = url => pointsAtObject(url, routeSegment, objectId)
    // Marks where a link was taken out, so only those spots are tidied.
    const GAP = '\u0000'
    let changed = false

    // [label](url) and <url> first, so their brackets do not survive as debris.
    const withoutLinks = text
        .replace(/\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/g, (match, label, url) => {
            if (!isCurrent(url)) return match
            changed = true
            const plain = label.trim()
            return plain && !/^https?:\/\//i.test(plain) ? plain : GAP
        })
        .replace(/<(https?:\/\/[^\s>]+)>/g, (match, url) => {
            if (!isCurrent(url)) return match
            changed = true
            return GAP
        })
        .replace(URL_PATTERN, match => {
            const { candidate, trailing } = splitTrailing(match)
            if (!isCurrent(candidate)) return match
            changed = true
            // Keep a sentence end; a colon or comma after the link has nothing left to introduce.
            return `${GAP}${/^[.!?…]/u.test(trailing) ? trailing[0] : ''}`
        })
    if (!changed) return text

    const endsWithColon = line => /:\**\s*$/u.test(line)
    const colonToPeriod = line => line.replace(/:(\**)\s*$/u, '.$1')
    const kept = []
    let dropBlank = false
    for (const line of withoutLinks.split('\n')) {
        if (!line.includes(GAP)) {
            if (dropBlank && !line.trim()) continue
            dropBlank = false
            kept.push(line)
            continue
        }
        const tidied = line
            .replace(new RegExp(`\\(\\s*${GAP}\\s*\\)`, 'g'), GAP)
            .replace(new RegExp(`\\*\\*\\s*${GAP}\\s*\\*\\*`, 'g'), GAP)
            .replace(new RegExp(`[ \\t]*${GAP}[ \\t]*(?=[.,;:!?…]|$)`, 'gu'), '')
            .replace(new RegExp(`[ \\t]*${GAP}[ \\t]*`, 'g'), ' ')
            .replace(/:([.!?…])/gu, '$1')
            .replace(/:[ \t]+([–—])/gu, ' $1')
            .replace(/[ \t]+$/g, '')
        // A line that held only the link (bullet, quote or punctuation left) goes entirely, and
        // "… here:" above it now reads as a finished sentence.
        if (/^[\s>*\-•–—.,;:!?…]*$/u.test(tidied)) {
            let previous = kept.length - 1
            while (previous >= 0 && !kept[previous].trim()) previous--
            if (previous >= 0 && endsWithColon(kept[previous])) kept[previous] = colonToPeriod(kept[previous])
            dropBlank = kept.length === 0 || !kept[kept.length - 1].trim()
            continue
        }
        dropBlank = false
        kept.push(endsWithColon(tidied) ? colonToPeriod(tidied) : tidied)
    }
    return kept.join('\n').trim()
}

/** Rewrites every URL of this task in the text (other project, no `/chat`) to the canonical link. */
function replaceTaskUrls(text, handoff) {
    return text.replace(URL_PATTERN, match => {
        const { candidate, trailing } = splitTrailing(match)
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
    let handedToCurrentTask = false

    for (const handoff of (Array.isArray(handoffs) ? handoffs : [])
        .map(normalizeDelegatedTaskHandoff)
        .filter(Boolean)) {
        // The user is reading that task's own chat: a link to where they are is noise, and one the
        // model wrote anyway (from history, or by building it) is removed below.
        if (isCurrentConversationTask(handoff, currentThread)) {
            handedToCurrentTask = true
            continue
        }
        // A current-conversation marker from some other conversation carries no URL to add.
        if (handoff.currentConversation) continue
        const key = `${handoff.projectId}/${handoff.taskId}`
        if (seen.has(key)) continue
        seen.add(key)

        response = replaceTaskUrls(response, handoff)
        if (response.includes(handoff.url)) continue
        const line = buildFollowLine(handoff, language)
        response = response ? `${response}\n\n${line}` : line
    }

    return handedToCurrentTask ? removeCurrentThreadLinks(response, currentThread) : response
}

module.exports = {
    buildTaskChatUrl,
    buildDelegatedTaskHandoff,
    normalizeDelegatedTaskHandoff,
    withDelegatedTaskLink,
    collectDelegatedTaskHandoffs,
    ensureDelegatedTaskLinksInResponse,
    isCurrentConversationTask,
    removeCurrentThreadLinks,
}
