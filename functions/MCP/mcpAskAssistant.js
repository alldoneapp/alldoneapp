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
 *
 * Asking in a task or an existing topic does what the app's bot button does first (AT-3059): it switches
 * the thread's assistant on and, when the thread has none, gives it the assistant being asked. Without
 * that the server-side run skips the question as `assistant_disabled` (a task created over MCP starts
 * with `isAssistantEnabled: false`) and the tool used to report "starting" forever. When the run is
 * skipped anyway (switched off meanwhile, access lost, a later message came first, ...), the check
 * records why on the question (`assistantRunSkipped`) and the tool returns `not_started` with that
 * reason. The run lock always wins over that record: a lock means a run started.
 */

const admin = require('firebase-admin')

const { canAccessObject, getObjectDocPath } = require('../shared/privacyAccess')
const { buildMcpActorMarker } = require('../shared/mcpActor')

const DEFAULT_WAIT_SECONDS = 60
const MAX_WAIT_SECONDS = 120
const POLL_INTERVAL_MS = 2000
const MAX_MESSAGE_LENGTH = 10000
const SETTLED_STATUSES = new Set(['completed', 'failed', 'cancelled', 'released'])
const GLOBAL_PROJECT_ID = 'globalProject'

// Why the server did not start the run (assistantMissedRunCatchUp.js records the reason on the question).
const NOT_STARTED_MESSAGES = {
    assistant_disabled:
        'The assistant is switched off in this thread (or it is a webhook task), so it did not answer. Switch it on or ask again.',
    no_assistant: 'This thread has no assistant to answer. Pass assistantId or set an assistant for the thread.',
    no_access: 'You can no longer open this thread, so the assistant did not answer.',
    superseded:
        'A later message in this thread came before the assistant started. Its answer covers this question too, so there is no separate answer; see the thread.',
    too_old: 'The question is older than 24 hours, so it is no longer answered.',
    missing: 'The question or its thread was deleted.',
    not_requested: 'The question does not ask the assistant to answer.',
    error: 'The server could not start the assistant run. Ask again.',
}

const ASK_ASSISTANT_SCHEMA = {
    name: 'ask_assistant',
    description:
        "Ask an Alldone assistant (by default the thread's, else the project's assistant) to do something or answer a question, and get its answer. The question is posted as your comment in a task thread (taskId) or a topic (chatId, or the topic titled chatTitle, created if missing), and the assistant answers there with its own model, tools and the thread's history, billed to you like any assistant run. Like the app's bot button, this switches the assistant on in that thread. Waits up to waitSeconds (default 60, max 120) for the answer; if the assistant is still working (status starting or working), call again with waitForCommentId to keep waiting without asking again. Status not_started means nothing will answer; reason and error say why.",
    inputSchema: {
        type: 'object',
        properties: {
            projectId: { type: 'string', description: 'The project (see get_user_projects).' },
            message: { type: 'string', description: 'What to ask or ask for. Not needed with waitForCommentId.' },
            assistantId: {
                type: 'string',
                description:
                    "Optional: the assistant to ask (one of the project's assistants or a global one). Defaults to the thread's assistant, then the project's. Asking switches the thread's assistant on, as the app's bot button does; the thread keeps its own assistant if it has one.",
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

const notStarted = reason => ({
    status: 'not_started',
    reason,
    error: NOT_STARTED_MESSAGES[reason] || NOT_STARTED_MESSAGES.error,
})

/**
 * Waits until the run that answers `commentId` settles (its run lock), the server records that it
 * will not start it (`assistantRunSkipped` on the question), or the time is up. A lock always wins:
 * whatever recorded a skip, a run that holds the lock is the real state.
 */
async function waitForAnswer(db, { projectId, objectType, objectId, commentId, afterCreated, waitSeconds, deps }) {
    const { buildAssistantRunLockId } = require('../Assistant/assistantRunIdempotency')
    const sleep = deps.sleep || defaultSleep
    const now = deps.now || Date.now
    const lockRef = db.doc(
        `assistantRunLocks/${buildAssistantRunLockId({ projectId, objectType, objectId, messageId: commentId })}`
    )
    const commentRef = db.doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${commentId}`)
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
        if (!lock.exists) {
            const comment = await commentRef.get()
            if (!comment.exists) return notStarted('missing')
            const skipped = (comment.data() || {}).assistantRunSkipped
            if (skipped?.reason) return notStarted(skipped.reason)
        }
        if (now() >= deadline) return { status: status ? 'working' : 'starting' }
        await sleep(POLL_INTERVAL_MS)
    }
}

async function assistantExists(db, projectId, assistantId) {
    if (!assistantId) return false
    const [own, global] = await Promise.all([
        db.doc(`assistants/${projectId}/items/${assistantId}`).get(),
        db.doc(`assistants/${GLOBAL_PROJECT_ID}/items/${assistantId}`).get(),
    ])
    return own.exists || global.exists
}

/**
 * The thread the question goes to, checked as the app checks it: the user must be able to open it.
 * A topic named only by title is looked up here too, so a private topic of someone else is never
 * written to; no match means the topic writer creates it.
 */
async function resolveThread(db, { projectId, userId, taskId, chatId, chatTitle }) {
    const notFound = () => fail(taskId ? `Task not found: "${taskId}".` : `Topic not found: "${chatId || chatTitle}".`)
    if (taskId) {
        const ref = db.doc(`items/${projectId}/tasks/${taskId}`)
        const snapshot = await ref.get()
        const task = snapshot.exists ? snapshot.data() || {} : null
        if (!task || !canAccessObject(task, userId)) notFound()
        if (task.taskMetadata?.isWebhookTask) {
            fail('This task runs its own webhook flow, so no assistant answers in it. Ask in a topic instead.')
        }
        return { objectType: 'tasks', objectId: taskId, ref, data: task }
    }
    let id = chatId
    if (!id) {
        const matches = (
            await db.collection(`chatObjects/${projectId}/chats`).where('title', '==', chatTitle).get()
        ).docs.filter(doc => ((doc.data() || {}).type || 'topics') === 'topics')
        // Several matches: the topic writer explains it and asks for a chatId.
        if (matches.length !== 1) return { objectType: 'topics', objectId: null, ref: null, data: null }
        id = matches[0].id
    }
    const ref = db.doc(`chatObjects/${projectId}/chats/${id}`)
    const snapshot = await ref.get()
    const chat = snapshot.exists ? snapshot.data() || {} : null
    if (!chat || (chat.type || 'topics') !== 'topics' || !canAccessObject(chat, userId)) notFound()
    return { objectType: 'topics', objectId: id, ref, data: chat }
}

/**
 * The assistant that answers: the one asked for, else the thread's own, else the project's. Each
 * must exist in the project or the global pool, the two places the run itself loads it from.
 */
async function resolveAssistantId(db, { projectId, project, requested, threadAssistantId, threadAssistantValid }) {
    if (requested) {
        if (!(await assistantExists(db, projectId, requested))) {
            fail(`Assistant not found in this project: "${requested}".`)
        }
        return requested
    }
    if (threadAssistantValid) return threadAssistantId
    const projectAssistantId = nonEmpty(project.assistantId)
    if (projectAssistantId && (await assistantExists(db, projectId, projectAssistantId))) return projectAssistantId
    fail('This project has no project assistant; pass assistantId.')
}

/**
 * What the app's bot button does before a question (BotButtonWrapper.enableAssistant): switch the
 * thread's assistant on, and give a thread without a (still existing) assistant the one being asked.
 * A thread that has its own assistant keeps it; an explicit assistantId answers this question only.
 * In a transaction, so a choice the user makes at the same moment is not overwritten.
 */
async function enableThreadAssistant(db, thread, assistantId, { replaceAssistantId = null } = {}) {
    return await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(thread.ref)
        if (!snapshot.exists) return { enabled: false, assistantIdSet: false }
        const data = snapshot.data() || {}
        const current = nonEmpty(data.assistantId)
        const update = {}
        if (data.isAssistantEnabled !== true) update.isAssistantEnabled = true
        if (!current || (replaceAssistantId && current === replaceAssistantId)) update.assistantId = assistantId
        if (Object.keys(update).length > 0) transaction.update(thread.ref, update)
        return { enabled: !!update.isAssistantEnabled, assistantIdSet: !!update.assistantId }
    })
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
    const baseUrl = context.baseUrl || deps.baseUrl || 'https://my.alldone.app'
    const waitSeconds = clampWaitSeconds(args.waitSeconds)
    const taskId = nonEmpty(args.taskId)

    // Keep waiting for an earlier question.
    const waitForCommentId = nonEmpty(args.waitForCommentId)
    if (waitForCommentId) {
        const objectType = taskId ? 'tasks' : 'topics'
        const objectId = taskId || nonEmpty(args.chatId)
        if (!objectId) fail('Pass the taskId or chatId of the thread the question was asked in.')
        const [comment, object] = await Promise.all([
            db.doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${waitForCommentId}`).get(),
            db.doc(getObjectDocPath(projectId, objectType, objectId)).get(),
        ])
        if (
            !comment.exists ||
            (comment.data() || {}).creatorId !== userId ||
            !object.exists ||
            !canAccessObject(object.data() || {}, userId)
        ) {
            fail('That question was not found.')
        }
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
            ...hintFor(result),
        }
    }

    const message = nonEmpty(args.message)
    if (!message) fail('message is required.')
    if (message.length > MAX_MESSAGE_LENGTH) fail(`message must be at most ${MAX_MESSAGE_LENGTH} characters.`)
    const actorMarker = buildMcpActorMarker(context.mcpClient)
    const chatTitle = nonEmpty(args.chatTitle) || `Question to the assistant: ${message.slice(0, 60)}`

    const thread = await resolveThread(db, { projectId, userId, taskId, chatId: nonEmpty(args.chatId), chatTitle })
    const threadAssistantId = nonEmpty(thread.data?.assistantId)
    const threadAssistantValid = !!threadAssistantId && (await assistantExists(db, projectId, threadAssistantId))
    const assistantId = await resolveAssistantId(db, {
        projectId,
        project,
        requested: nonEmpty(args.assistantId),
        threadAssistantId,
        threadAssistantValid,
    })
    // A thread assistant that no longer exists is replaced, as the app's bot button does.
    const threadAssistant = thread.ref
        ? await enableThreadAssistant(db, thread, assistantId, {
              replaceAssistantId: threadAssistantId && !threadAssistantValid ? threadAssistantId : null,
          })
        : { enabled: false, assistantIdSet: false }
    // Only the server starts this run (no client of the user does), see assistantMissedRunCatchUp.js.
    const runRequest = { projectId, assistantId, startOnServer: true }

    let objectType
    let objectId
    let commentId
    let created
    if (thread.objectType === 'tasks') {
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
            assistantRunRequest: { ...runRequest, objectType, objectId },
        })
        commentId = result.commentId
        created = result.created
        // setTaskAssistant keeps the task's chat on the same assistant; the comment just wrote that chat.
        if (threadAssistant.assistantIdSet) {
            await db.doc(`chatObjects/${projectId}/chats/${taskId}`).set({ assistantId }, { merge: true })
        }
    } else {
        // The topic writer of add_chat_comment, user-authored (it writes through admin.firestore()).
        const postTopicComment =
            deps.postTopicComment || require('../Assistant/assistantHelper').addChatCommentFromAssistantTool
        const result = await postTopicComment({
            projectId,
            chatId: thread.objectId || '',
            chatTitle,
            comment: message,
            assistantId: null,
            userId,
            createIfMissing: true,
            authorChannelFields: actorMarker,
            topicAssistantId: assistantId,
            assistantRunRequest: { ...runRequest, objectType: 'topics' },
        })
        objectType = 'topics'
        objectId = result.chatId
        commentId = result.commentId
        created = result.created
    }

    // Start the run now: the same check the comment trigger schedules (at once too, for a request
    // only the server starts). Both use one task id, so the run starts once.
    const { enqueueMissedAssistantRunCheck } = require('../Assistant/assistantMissedRunCatchUp')
    const enqueue = deps.enqueue || enqueueMissedAssistantRunCheck
    const storedComment = await db
        .doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${commentId}`)
        .get()
    const enqueued = await enqueue({ projectId, objectType, objectId, commentId }, storedComment.data() || {}, {
        delaySeconds: 0,
    })

    const result =
        enqueued?.skipped === true
            ? notStarted('not_requested')
            : await waitForAnswer(db, {
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
        ...(threadAssistant.enabled ? { assistantSwitchedOn: true } : {}),
        ...hintFor(result),
    }
}

function hintFor({ status, reason }) {
    if (status === 'starting' || status === 'working') {
        return {
            hint: 'Call ask_assistant again with waitForCommentId and the same projectId and taskId/chatId to keep waiting.',
        }
    }
    if (status === 'not_started') {
        return {
            hint:
                reason === 'superseded'
                    ? 'Read the thread (threadUrl) for the answer to the later message.'
                    : 'Nothing will answer this question. Fix the reason, then ask again with a new message.',
        }
    }
    return {}
}

module.exports = { ASK_ASSISTANT_SCHEMA, AskAssistantError, askAssistant }
