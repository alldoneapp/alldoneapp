'use strict'

/**
 * A template started in the Anna chat reports its task there (AT-3082).
 *
 * In Assistant mode the composer's Templates button (for example "Historical fact of the day")
 * creates a new assistant task and runs the prompt in that task's own thread. The Anna chat the
 * user clicked in used to stay silent: the task appeared somewhere else and nobody mentioned it.
 * Product decision (Karsten, 2026-11-18): the same approach as delegated tasks. The chat says that
 * the task was started, and says it again when the task has its result, with Anna's short summary
 * of that result and the link. The result itself stays in the task thread (AT-3074).
 *
 * The origin conversation arrives in `request.data` of `generatePreConfigTaskResultSecondGen`, so it
 * is only a nomination: it must be the caller's own Anna chat in a project the caller is a member
 * of, and the assistant that speaks there is read from that chat document, never from the request.
 *
 * The fixed words are in the user's app language (noticeLanguage.js); Anna's summary is too.
 *
 * Both lines ring no bell: the task thread's own answer already notifies, and the user started the
 * template from this chat. Posting is best effort and never fails the run.
 */

const admin = require('firebase-admin')

const { getBaseUrl } = require('../Utils/HelperFunctionsCloud')
const { isProjectMemberData } = require('../shared/privacyAccess')
const { buildNoticeTaskLabel, loadNoticeLanguage, noticeText } = require('./noticeLanguage')

const TASK_RESULT_SUMMARY_GOLD_SOURCE = 'task_result_summary'

const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value)

/**
 * The origin conversation the client nominated, or null. Only an Anna chat (a topic) can nominate
 * itself, and never the task thread the template runs in.
 */
function readRequestedOrigin(raw, { projectId, taskId } = {}) {
    if (!raw || typeof raw !== 'object') return null
    const originProjectId = raw.projectId
    const originObjectId = raw.objectId
    const objectType = raw.objectType == null ? 'topics' : raw.objectType
    if (!validId(originProjectId) || !validId(originObjectId) || objectType !== 'topics') return null
    if (originProjectId === projectId && originObjectId === taskId) return null
    return { originProjectId, originObjectType: 'topics', originObjectId }
}

/**
 * Resolves the nominated origin to a trusted destination: the caller's own Anna chat, in a project
 * the caller is a member of, with the assistant stored on that chat. Null when any check fails.
 */
async function resolvePreConfigOrigin({ db = admin.firestore(), userId, requestedOrigin, projectId, taskId }) {
    const origin = readRequestedOrigin(requestedOrigin, { projectId, taskId })
    if (!origin || !userId) return null
    try {
        const [projectSnap, chatSnap] = await Promise.all([
            db.doc(`projects/${origin.originProjectId}`).get(),
            db.doc(`chatObjects/${origin.originProjectId}/chats/${origin.originObjectId}`).get(),
        ])
        if (!projectSnap.exists || !isProjectMemberData(projectSnap.data(), userId)) return null
        const chat = chatSnap.exists ? chatSnap.data() || {} : null
        if (!chat || chat.type !== 'topics' || chat.annaOwnerId !== userId || chat.creatorId !== userId) return null
        if (!validId(chat.assistantId)) return null
        return { ...origin, originAssistantId: chat.assistantId }
    } catch (error) {
        console.warn('[preConfigOriginNotice] Could not resolve the origin conversation', {
            userId,
            originObjectId: origin.originObjectId,
            error: error?.message || String(error),
        })
        return null
    }
}

const buildTaskLink = (projectId, taskId) => `${getBaseUrl()}/projects/${projectId}/tasks/${taskId}/chat`

function buildStartNoticeText({ task, link, language = 'en' }) {
    return [noticeText(language, 'preconfig.start', { label: buildNoticeTaskLabel(task, language) }), link].join('\n')
}

/**
 * The line for the run's outcome. `summary` is Anna's summary of the actual answer in the task
 * thread (vmResultSummary), never the answer itself and never invented: without an answer there is
 * no summary.
 */
const OUTCOME_KEYS = {
    failed: 'preconfig.failed',
    waiting: 'preconfig.waiting',
    no_answer: 'preconfig.noAnswer',
    done: 'preconfig.done',
}

function buildResultNoticeText({ task, outcome, summary = '', link, language = 'en' }) {
    const label = buildNoticeTaskLabel(task, language)
    const parts = [noticeText(language, OUTCOME_KEYS[outcome] || 'preconfig.result', { label })]
    const cleanSummary = String(summary || '').trim()
    if (cleanSummary && (outcome === 'done' || outcome === 'result')) parts.push('', cleanSummary)
    parts.push(link)
    return parts.join('\n')
}

/**
 * What the run produced, as far as the origin chat is concerned:
 * failed | waiting (a webhook template waits for the user) | no_answer | done | result.
 */
function classifyRunOutcome({ result, error, taskCompletion }) {
    if (error || !result || result.success !== true) return 'failed'
    if (result.status === 'webhook_ready') return 'waiting'
    const answer = typeof result.commentText === 'string' ? result.commentText.trim() : ''
    if (result.silentOk === true || !answer) return 'no_answer'
    return taskCompletion?.status === 'succeeded' ? 'done' : 'result'
}

async function loadTask(db, projectId, taskId) {
    try {
        const snapshot = await db.doc(`items/${projectId}/tasks/${taskId}`).get()
        return snapshot.exists ? { ...(snapshot.data() || {}), id: taskId } : { id: taskId }
    } catch (error) {
        return { id: taskId }
    }
}

async function postNotice(origin, text, userId) {
    const { createInitialStatusMessage } = require('./assistantStatusHelper')
    await createInitialStatusMessage(
        origin.originProjectId,
        origin.originObjectType,
        origin.originObjectId,
        origin.originAssistantId,
        text,
        [],
        [],
        [userId]
    )
}

/** "I started the task" in the origin chat. Returns true when posted. */
async function postPreConfigStartNotice({ db = admin.firestore(), origin, projectId, taskId, userId }) {
    if (!origin) return false
    try {
        const [task, language] = await Promise.all([loadTask(db, projectId, taskId), loadNoticeLanguage(db, userId)])
        await postNotice(
            origin,
            buildStartNoticeText({ task, link: buildTaskLink(projectId, taskId), language }),
            userId
        )
        return true
    } catch (error) {
        console.warn('[preConfigOriginNotice] Could not post the start notice', {
            projectId,
            taskId,
            originObjectId: origin.originObjectId,
            error: error?.message || String(error),
        })
        return false
    }
}

/** The run's outcome in the origin chat, with Anna's summary of the answer. Returns true when posted. */
async function postPreConfigResultNotice({
    db = admin.firestore(),
    origin,
    projectId,
    taskId,
    userId,
    result = null,
    error = null,
    taskCompletion = null,
    summarize = null,
}) {
    if (!origin) return false
    try {
        // The recipient's app language, for the fixed line and for Anna's summary.
        const [task, language] = await Promise.all([loadTask(db, projectId, taskId), loadNoticeLanguage(db, userId)])
        const outcome = classifyRunOutcome({ result, error, taskCompletion })
        let summary = ''
        if (outcome === 'done' || outcome === 'result') {
            const summarizeResult = summarize || require('./vmResultSummary').summarizeVmResultForChat
            summary = await summarizeResult({
                resultText: result.commentText,
                userId,
                projectId,
                objectId: taskId,
                objectType: 'tasks',
                taskLabel: buildNoticeTaskLabel(task, language),
                language,
                goldSource: TASK_RESULT_SUMMARY_GOLD_SOURCE,
                db,
            })
        }
        await postNotice(
            origin,
            buildResultNoticeText({ task, outcome, summary, link: buildTaskLink(projectId, taskId), language }),
            userId
        )
        return true
    } catch (noticeError) {
        console.warn('[preConfigOriginNotice] Could not post the result notice', {
            projectId,
            taskId,
            originObjectId: origin.originObjectId,
            error: noticeError?.message || String(noticeError),
        })
        return false
    }
}

module.exports = {
    TASK_RESULT_SUMMARY_GOLD_SOURCE,
    buildResultNoticeText,
    buildStartNoticeText,
    classifyRunOutcome,
    postPreConfigResultNotice,
    postPreConfigStartNotice,
    readRequestedOrigin,
    resolvePreConfigOrigin,
}
