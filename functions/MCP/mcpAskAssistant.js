'use strict'

/**
 * ask_assistant: an MCP client asks an Alldone assistant (decision 2026-11-09, the MCP side of an
 * assistant's talk_to_assistant).
 *
 * The question is stored the way a user asks in the app: as the user's comment in a task or topic
 * thread, marked with the MCP client, carrying `assistantRunRequest`. Nothing new runs the assistant:
 * the server path that answers a user message whose own request never arrived
 * (Assistant/assistantMissedRunCatchUp.js) picks it up, here at once instead of after its grace
 * period. So the run is the ordinary one: the assistant's model, tools and thread history, the user's
 * Gold, the per-message run lock. The tool then waits for that lock to settle and returns the
 * assistant's answer; if it takes longer, it returns where the answer will appear, and a second call
 * with `waitForCommentId` waits again without asking again.
 */

const admin = require('firebase-admin')

const { canAccessObject } = require('../shared/privacyAccess')
const { buildMcpActorMarker } = require('../shared/mcpActor')

const DEFAULT_WAIT_SECONDS = 60
const MAX_WAIT_SECONDS = 120
const POLL_INTERVAL_MS = 2000
const MAX_MESSAGE_LENGTH = 10000
const SETTLED_STATUSES = new Set(['completed', 'failed', 'cancelled', 'released'])

const ASK_ASSISTANT_SCHEMA = {
    name: 'ask_assistant',
    description:
        "Ask an Alldone assistant (by default the project's assistant) to do something or answer a question, and get its answer. The question is posted as your comment in a task thread (taskId) or a topic (chatId, or the topic titled chatTitle, created if missing), and the assistant answers there with its own model, tools and the thread's history, billed to you like any assistant run. Waits up to waitSeconds (default 60, max 120) for the answer; if the assistant is still working, call again with waitForCommentId to keep waiting without asking again.",
    inputSchema: {
        type: 'object',
        properties: {
            projectId: { type: 'string', description: 'The project (see get_user_projects).' },
            message: { type: 'string', description: 'What to ask or ask for. Not needed with waitForCommentId.' },
            assistantId: {
                type: 'string',
                description: "Optional: the assistant to ask. Defaults to the project's assistant.",
            },
            taskId: { type: 'string', description: 'Optional: ask in the thread of this task.' },
            chatId: { type: 'string', description: 'Optional: ask in this existing topic.' },
            chatTitle: {
                type: 'string',
                description:
                    'Optional: title of the topic to ask in; it is created if the project has none with that title.',
            },
            waitSeconds: { type: 'integer', description: 'Optional: how long to wait for the answer (0–120).' },
            waitForCommentId: {
                type: 'string',
                description:
                    'Optional: the commentId a previous ask_assistant returned; waits for that answer instead of asking again. Pass the same projectId and taskId or chatId.',
            },
        },
        required: ['projectId'],
    },
}

class AskAssistantError extends Error {}
const fail = message => {
    throw new AskAssistantError(message)
}

const nonEmpty = value => (typeof value === 'string' && value.trim() ? value.trim() : '')
const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function clampWaitSeconds(value) {
    const seconds = Number(value)
    if (!Number.isFinite(seconds)) return DEFAULT_WAIT_SECONDS
    return Math.max(0, Math.min(MAX_WAIT_SECONDS, Math.floor(seconds)))
}

function threadUrl(baseUrl, projectId, objectType, objectId) {
    return objectType === 'tasks'
        ? `${baseUrl}/projects/${projectId}/tasks/${objectId}/chat`
        : `${baseUrl}/projects/${projectId}/chats/${objectId}/chat`
}

async function readAnswer(db, { projectId, objectType, objectId, afterCreated }) {
    // Everything the assistant wrote in the thread since the question (a run can post more than once).
    const snapshot = await db
        .collection(`chatComments/${projectId}/${objectType}/${objectId}/comments`)
        .where('created', '>=', afterCreated)
        .get()
    return snapshot.docs
        .map(doc => doc.data() || {})
        .filter(comment => comment.fromAssistant === true)
        .sort((a, b) => Number(a.created) - Number(b.created))
        .map(comment => comment.commentText || '')
        .filter(Boolean)
        .join('\n\n')
}

/**
 * Waits until the run that answers `commentId` settles (its run lock), or the time is up.
 */
async function waitForAnswer(db, { projectId, objectType, objectId, commentId, afterCreated, waitSeconds, deps }) {
    const { buildAssistantRunLockId } = require('../Assistant/assistantRunIdempotency')
    const sleep = deps.sleep || defaultSleep
    const now = deps.now || Date.now
    const lockRef = db.doc(
        `assistantRunLocks/${buildAssistantRunLockId({ projectId, objectType, objectId, messageId: commentId })}`
    )
    const deadline = now() + waitSeconds * 1000
    for (;;) {
        const lock = await lockRef.get()
        const status = lock.exists ? (lock.data() || {}).status : null
        if (status && SETTLED_STATUSES.has(status)) {
            const answer = await readAnswer(db, { projectId, objectType, objectId, afterCreated })
            return status === 'completed'
                ? { status: 'answered', answer }
                : { status, answer, error: (lock.data() || {}).error || null }
        }
        if (now() >= deadline) return { status: status ? 'working' : 'starting' }
        await sleep(POLL_INTERVAL_MS)
    }
}

async function askAssistant(userId, args = {}, context = {}, deps = {}) {
    if (!userId) fail('Authentication required.')
    const db = deps.db || admin.firestore()
    const projectId = nonEmpty(args.projectId)
    if (!projectId) fail('projectId is required (see get_user_projects).')
    const projectSnapshot = await db.doc(`projects/${projectId}`).get()
    const project = projectSnapshot.exists ? projectSnapshot.data() || {} : null
    if (!project || !Array.isArray(project.userIds) || !project.userIds.includes(userId)) {
        fail(`Project not found or not accessible: "${projectId}".`)
    }
    const assistantId = nonEmpty(args.assistantId) || nonEmpty(project.assistantId)
    if (!assistantId) fail('This project has no project assistant; pass assistantId.')
    const baseUrl = context.baseUrl || deps.baseUrl || 'https://my.alldone.app'
    const waitSeconds = clampWaitSeconds(args.waitSeconds)
    const taskId = nonEmpty(args.taskId)

    // Keep waiting for an earlier question.
    const waitForCommentId = nonEmpty(args.waitForCommentId)
    if (waitForCommentId) {
        const objectType = taskId ? 'tasks' : 'topics'
        const objectId = taskId || nonEmpty(args.chatId)
        if (!objectId) fail('Pass the taskId or chatId of the thread the question was asked in.')
        const comment = await db
            .doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${waitForCommentId}`)
            .get()
        if (!comment.exists || (comment.data() || {}).creatorId !== userId) fail('That question was not found.')
        const result = await waitForAnswer(db, {
            projectId,
            objectType,
            objectId,
            commentId: waitForCommentId,
            afterCreated: Number((comment.data() || {}).created) || 0,
            waitSeconds,
            deps,
        })
        return {
            ...result,
            projectId,
            objectType,
            objectId,
            commentId: waitForCommentId,
            threadUrl: threadUrl(baseUrl, projectId, objectType, objectId),
        }
    }

    const message = nonEmpty(args.message)
    if (!message) fail('message is required.')
    if (message.length > MAX_MESSAGE_LENGTH) fail(`message must be at most ${MAX_MESSAGE_LENGTH} characters.`)
    const actorMarker = buildMcpActorMarker(context.mcpClient)

    let objectType
    let objectId
    let commentId
    let created
    if (taskId) {
        const taskSnapshot = await db.doc(`items/${projectId}/tasks/${taskId}`).get()
        if (!taskSnapshot.exists || !canAccessObject(taskSnapshot.data(), userId)) fail(`Task not found: "${taskId}".`)
        objectType = 'tasks'
        objectId = taskId
        const { TaskCommentService } = require('../shared/TaskCommentService')
        const userSnapshot = await db.doc(`users/${userId}`).get()
        const userData = userSnapshot.exists ? userSnapshot.data() || {} : {}
        const result = await new TaskCommentService({ database: db }).addComment({
            projectId,
            taskId,
            comment: message,
            actor: {
                uid: userId,
                id: userId,
                displayName: userData.displayName || userData.name || '',
                ...actorMarker,
            },
            fromAssistant: false,
            assistantRunRequest: { projectId, objectType, objectId, assistantId },
        })
        commentId = result.commentId
        created = result.created
    } else {
        // The topic writer of add_chat_comment, user-authored (it writes through admin.firestore()).
        const postTopicComment =
            deps.postTopicComment || require('../Assistant/assistantHelper').addChatCommentFromAssistantTool
        const result = await postTopicComment({
            projectId,
            chatId: nonEmpty(args.chatId),
            chatTitle: nonEmpty(args.chatTitle) || `Question to the assistant: ${message.slice(0, 60)}`,
            comment: message,
            assistantId: null,
            userId,
            createIfMissing: true,
            authorChannelFields: actorMarker,
            topicAssistantId: assistantId,
            assistantRunRequest: { projectId, objectType: 'topics', assistantId },
        })
        objectType = 'topics'
        objectId = result.chatId
        commentId = result.commentId
        created = result.created
    }

    // Start the run now: the same check the comment trigger schedules after its grace period.
    const { enqueueMissedAssistantRunCheck } = require('../Assistant/assistantMissedRunCatchUp')
    const enqueue = deps.enqueue || enqueueMissedAssistantRunCheck
    const storedComment = await db
        .doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${commentId}`)
        .get()
    await enqueue({ projectId, objectType, objectId, commentId }, storedComment.data() || {}, { delaySeconds: 0 })

    const result = await waitForAnswer(db, {
        projectId,
        objectType,
        objectId,
        commentId,
        afterCreated: created,
        waitSeconds,
        deps,
    })
    return {
        ...result,
        assistantId,
        projectId,
        objectType,
        objectId,
        commentId,
        threadUrl: threadUrl(baseUrl, projectId, objectType, objectId),
        ...(result.status === 'answered' || result.status === 'completed'
            ? {}
            : {
                  hint: 'Call ask_assistant again with waitForCommentId and the same projectId and taskId/chatId to keep waiting.',
              }),
    }
}

module.exports = { ASK_ASSISTANT_SCHEMA, AskAssistantError, askAssistant }
