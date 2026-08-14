/**
 * Resolution and discovery for execute_task_in_vm's `continue_in_object_id` argument.
 *
 * A VM run is continued by hosting the new job on the *same* thread: the sandbox is keyed by
 * `vmSessions/{projectId}__{objectId}`, so reusing that thread is what makes the runner resume the
 * paused sandbox (files + agent conversation) instead of starting cold. This module turns the
 * assistant-supplied object id — or the `latest` sentinel — into a validated host thread, and lists
 * the threads that could be continued so a wrong guess can be corrected on the next tool round.
 *
 * Deliberately narrow: the target must already have a VM session in the *same* project. That is
 * exactly the "continue an earlier VM run" semantic, and it keeps an assistant from pointing a job
 * at an arbitrary object id — it can only reach threads a VM job has already run on. Visibility is
 * then checked against the thread's chat object using the app's normal isPublicFor model.
 *
 * Kept in a standalone module (no heavy deps) so it can be unit-tested without importing the full
 * assistantHelper (which pulls in the OpenAI SDK).
 */

const FEED_PUBLIC_FOR_ALL = 0

// `continue_in_object_id: "latest"` — carry on with the most recent VM run in this project. This is
// the common phrasing ("continue what you were doing") and needs no id lookup by the assistant.
const CONTINUE_LATEST = 'latest'

// How many candidate threads to list back to the assistant when resolution fails. Sessions are
// pruned after 7 days idle, so a project rarely has more than a handful anyway.
const MAX_CONTINUATION_CANDIDATES = 10

const NO_SESSION_MESSAGE =
    'That thread has no VM session to continue — no VM task has run there, or its session expired ' +
    '(sessions are kept for 7 days).'

function vmSessionDocPath(projectId, objectId) {
    return `vmSessions/${projectId}__${objectId}`
}

function chatObjectPath(projectId, objectId) {
    return `chatObjects/${projectId}/chats/${objectId}`
}

function isVisibleToUser(chatData, requestUserId) {
    const isPublicFor = chatData?.isPublicFor
    if (!Array.isArray(isPublicFor)) return false
    return isPublicFor.includes(FEED_PUBLIC_FOR_ALL) || (!!requestUserId && isPublicFor.includes(requestUserId))
}

/**
 * The threads in a project whose VM session could be continued, most recently used first.
 *
 * Single-field equality on projectId, so this needs no composite index (and therefore no change to
 * firestore.indexes.json); ordering is done in memory, which is fine because the 7-day session TTL
 * keeps the per-project count small. Titles and visibility both come from the thread's chat object,
 * fetched in one batched read.
 *
 * @returns {Promise<Array<{objectId, objectType, title, lastObjective, lastRunAt, lastRunStatus, isRunning}>>}
 */
async function listContinuableVmThreads({ db, projectId, requestUserId, limit = MAX_CONTINUATION_CANDIDATES } = {}) {
    if (!projectId) return []

    let sessions = []
    try {
        const snapshot = await db.collection('vmSessions').where('projectId', '==', projectId).get()
        sessions = (snapshot?.docs || [])
            .map(doc => doc.data() || {})
            .filter(session => typeof session.objectId === 'string' && session.objectId)
    } catch (error) {
        // Discovery is a convenience on top of the authoritative per-thread check — never let it
        // break a dispatch.
        console.warn('🖥️ VM CONTINUATION: failed listing continuable threads', {
            projectId,
            error: error.message,
        })
        return []
    }
    if (!sessions.length) return []

    sessions.sort((a, b) => (Number(b.lastUsedAt) || 0) - (Number(a.lastUsedAt) || 0))

    const chatSnaps = await db.getAll(...sessions.map(session => db.doc(chatObjectPath(projectId, session.objectId))))

    const threads = []
    for (let index = 0; index < sessions.length; index++) {
        const session = sessions[index]
        const chatSnap = chatSnaps[index]
        if (!chatSnap?.exists) continue
        const chatData = chatSnap.data() || {}
        if (!isVisibleToUser(chatData, requestUserId)) continue

        threads.push({
            objectId: session.objectId,
            objectType: typeof session.objectType === 'string' && session.objectType ? session.objectType : 'tasks',
            title: String(chatData.title || '').trim(),
            lastObjective: String(session.lastObjective || '').trim(),
            lastRunAt: Number(session.lastRunAt) || Number(session.lastUsedAt) || 0,
            lastRunStatus: String(session.lastRunStatus || '').trim(),
            // A thread with work in flight is still continuable — the job simply queues behind it.
            isRunning: !!session.activeCorrelationId,
        })
        if (threads.length >= limit) break
    }

    return threads
}

/**
 * Render candidate threads for a tool-result message, so an assistant that guessed wrong can retry
 * with a real id on the next round instead of silently starting a cold VM.
 */
function formatContinuationCandidates(threads = []) {
    if (!threads.length) return ''
    const lines = threads.map(thread => {
        const label = thread.title || thread.lastObjective || thread.objectId
        const detail = thread.lastObjective && thread.lastObjective !== label ? ` — ${thread.lastObjective}` : ''
        const running = thread.isRunning ? ' (currently running)' : ''
        return `- ${thread.objectId}: ${label}${detail}${running}`
    })
    return `Threads in this project you can continue (most recent first):\n${lines.join('\n')}`
}

function withCandidates(message, threads) {
    const candidates = formatContinuationCandidates(threads)
    return candidates ? `${message}\n\n${candidates}` : message
}

/**
 * Validate a requested continuation thread.
 *
 * @param {object} params
 * @param {object} params.db Firestore instance
 * @param {string} params.projectId Project the VM job will run in (already access-checked — it is
 *   the assistant's runtime project, never user-supplied)
 * @param {string} params.objectId The thread to continue, or `latest` for the most recent one
 * @param {string} [params.preferredObjectId] Ambient thread to prefer when `objectId` is `latest`.
 *   This keeps an in-thread follow-up on that thread even when another project VM ran more recently.
 * @param {string} params.requestUserId The user the job is billed to and notified for
 * @returns {Promise<{ok: true, objectType: string, objectId: string} | {ok: false, message: string}>}
 */
async function resolveVmContinuationThread({ db, projectId, objectId, preferredObjectId, requestUserId } = {}) {
    const trimmedObjectId = typeof objectId === 'string' ? objectId.trim() : ''
    if (!trimmedObjectId) {
        return { ok: false, message: 'continue_in_object_id must be a non-empty id.' }
    }
    if (!projectId) {
        return { ok: false, message: 'A project is required to continue a VM task.' }
    }

    if (trimmedObjectId.toLowerCase() === CONTINUE_LATEST) {
        const trimmedPreferredObjectId = typeof preferredObjectId === 'string' ? preferredObjectId.trim() : ''
        if (trimmedPreferredObjectId && trimmedPreferredObjectId.toLowerCase() !== CONTINUE_LATEST) {
            const preferredSessionSnap = await db.doc(vmSessionDocPath(projectId, trimmedPreferredObjectId)).get()
            if (preferredSessionSnap.exists) {
                const preferredChatSnap = await db.doc(chatObjectPath(projectId, trimmedPreferredObjectId)).get()
                if (preferredChatSnap.exists && isVisibleToUser(preferredChatSnap.data(), requestUserId)) {
                    const preferredSession = preferredSessionSnap.data() || {}
                    return {
                        ok: true,
                        objectType:
                            typeof preferredSession.objectType === 'string' && preferredSession.objectType
                                ? preferredSession.objectType
                                : 'tasks',
                        objectId: trimmedPreferredObjectId,
                    }
                }
            }
        }

        const threads = await listContinuableVmThreads({ db, projectId, requestUserId, limit: 1 })
        if (!threads.length) {
            return {
                ok: false,
                message:
                    'There is no earlier VM run in this project to continue (no VM task has run here, or its ' +
                    'session expired — sessions are kept for 7 days). Start a new VM task instead.',
            }
        }
        return { ok: true, objectType: threads[0].objectType, objectId: threads[0].objectId }
    }

    const sessionSnap = await db.doc(vmSessionDocPath(projectId, trimmedObjectId)).get()
    if (!sessionSnap.exists) {
        const threads = await listContinuableVmThreads({ db, projectId, requestUserId })
        return {
            ok: false,
            message: withCandidates(
                `${NO_SESSION_MESSAGE} Retry with one of the ids below, or omit continue_in_object_id to start ` +
                    'a new VM task.',
                threads
            ),
        }
    }

    const session = sessionSnap.data() || {}
    const objectType = typeof session.objectType === 'string' && session.objectType ? session.objectType : 'tasks'

    // Visibility: the thread's chat object carries the app's isPublicFor model. A VM host thread
    // always has one (created by ensureChatExists / the status comment write).
    const chatSnap = await db.doc(chatObjectPath(projectId, trimmedObjectId)).get()
    if (!chatSnap.exists) {
        return { ok: false, message: 'That thread no longer exists.' }
    }
    if (!isVisibleToUser(chatSnap.data(), requestUserId)) {
        return { ok: false, message: 'You do not have access to that thread.' }
    }

    return { ok: true, objectType, objectId: trimmedObjectId }
}

module.exports = {
    resolveVmContinuationThread,
    listContinuableVmThreads,
    formatContinuationCandidates,
    vmSessionDocPath,
    CONTINUE_LATEST,
    MAX_CONTINUATION_CANDIDATES,
    FEED_PUBLIC_FOR_ALL,
}
