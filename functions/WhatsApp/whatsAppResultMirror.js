const crypto = require('crypto')
const { getBaseUrl } = require('../Utils/HelperFunctionsCloud')
const { getUserData } = require('../Users/usersFirestore')
const { getOrCreateWhatsAppDailyTopic, storeAssistantMessageInTopicOnce } = require('./whatsAppDailyTopic')

/**
 * Mirror an assistant result that was delivered over WhatsApp into the user's Daily
 * WhatsApp Topic (AT-2387).
 *
 * Why this exists: an inbound WhatsApp message is always answered from the daily topic
 * `BotChat<localDate><userId>` — `whatsAppInboundQueueProcessor` resolves it, stores the
 * user turn there, and `whatsAppAssistantBridge` builds the model context out of
 * `getConversationHistory(projectId, chatId, …)` of that one thread. Assistant results
 * pushed to WhatsApp from *elsewhere* (a recurring / pre-configured assistant task, a VM
 * job) are written into their own task thread instead, so the user reads the answer on
 * their phone and the very next WhatsApp message — "and what about the second point?" —
 * reaches an assistant that has never seen it. Heartbeats never had the problem because
 * they already run *inside* the daily topic (see `assistantHeartbeat.js`); this makes the
 * other producers behave the same way.
 *
 * Deliberate boundaries:
 *  - The mirror reuses the canonical topic mechanisms (`getOrCreateWhatsAppDailyTopic` +
 *    the daily-topic comment writer). It does not invent a parallel context store, and it
 *    writes exactly one comment per delivered result.
 *  - It is silent: it never moves the MyDay AssistantLine pointer and never creates a
 *    notification. The originating thread already owns those, and the user has just been
 *    messaged on WhatsApp — notification behaviour is unchanged by design.
 *  - It never throws. A failed mirror must never fail (or retry) a WhatsApp delivery that
 *    already succeeded.
 */

const MIRROR_ID_PREFIX = 'wa-mirror'
const SOURCE_HEADER_ICON = '📋'

/**
 * A mirrored result arrives in a thread the user never opened, next to whatever else the
 * assistant said on WhatsApp that day, so it carries a one-line header naming the task it
 * came from and linking back to its own thread.
 *
 * The header is a UI affordance only — `mirrorAssistantResultToWhatsAppDailyTopic` stores
 * the bare result alongside it as `contextCommentText`, and `getConversationHistory` feeds
 * *that* to the model. Same reasoning as AT-2241, which stopped stamping `[Sent at …]` on
 * turns the model can see: a recognisable prefix on a previous assistant turn is a pattern
 * the next answer copies, and the user would read the mimicry on WhatsApp. Nothing is lost
 * by stripping it — the header describes where the answer came from, not what it says.
 */
function buildSourceHeader({ sourceLabel, sourceProjectId, sourceObjectType, sourceObjectId }) {
    const label = String(sourceLabel || '').trim()
    if (!label) return ''

    const link = buildThreadUrl(sourceProjectId, sourceObjectType, sourceObjectId)
    return link ? `${SOURCE_HEADER_ICON} ${label}\n${link}` : `${SOURCE_HEADER_ICON} ${label}`
}

/** Same path shape as the WhatsApp "read full message" deep link (`buildConversationUrl`). */
function buildThreadUrl(projectId, objectType, objectId) {
    if (!projectId || !objectId) return ''
    const segment = objectType === 'topics' ? 'chats' : 'tasks'
    return `${getBaseUrl()}/projects/${projectId}/${segment}/${objectId}/chat`
}

/**
 * Deterministic comment ID for a mirrored result, so a redelivered scheduled task, a
 * Cloud Tasks retry or a VM reconciliation pass cannot post the same result twice.
 * Keyed on the *source delivery*, not on the destination topic, and salted with the
 * destination so a result mirrored into a later day's topic is still allowed through.
 *
 * Matches `whatsAppCallTranscript.getTranscriptCommentId`'s sha256/40 convention.
 */
function buildMirrorCommentId({
    projectId,
    chatId,
    sourceProjectId,
    sourceObjectType,
    sourceObjectId,
    sourceCommentId,
    resultText,
}) {
    // With no source comment ID the result text itself is the only stable identity we
    // have. It is a weaker key (two identical results from the same task on the same day
    // collapse into one comment) but that failure mode — dropping an exact duplicate — is
    // the safe direction.
    const sourceIdentity = sourceCommentId || `text:${crypto.createHash('sha256').update(resultText).digest('hex')}`
    const key = [projectId, chatId, sourceProjectId, sourceObjectType, sourceObjectId, sourceIdentity].join('|')
    return `${MIRROR_ID_PREFIX}-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 40)}`
}

/**
 * @param {Object} params
 * @param {string} params.userId - Recipient of the WhatsApp message (owns the daily topic)
 * @param {string} params.assistantId - Assistant credited with the result
 * @param {string} params.resultText - The assistant result, verbatim
 * @param {string} params.sourceProjectId - Project the result was produced in
 * @param {string} params.sourceObjectId - Task/topic the result was produced in
 * @param {string} [params.sourceObjectType='tasks']
 * @param {string} [params.sourceLabel] - Short human description of where the result came
 *        from, e.g. `From your recurring task "Daily Market Analysis"`. Rendered as a
 *        header above the result; omitted from the model context. No header without it.
 * @param {string} [params.sourceCommentId] - The result's own comment ID, when known
 * @param {Object} [params.userData] - Already-loaded user doc (avoids a re-read)
 * @param {number} [params.timestamp] - Instant used to resolve the user's local-day topic
 * @param {Array<{projectId: string, objectId: string}>} [params.alreadyDeliveredTo] -
 *        Conversations that already received this result through another path, so the
 *        mirror does not double-post into them.
 * @returns {Promise<{mirrored: boolean, reason: string, projectId?: string, chatId?: string, commentId?: string}>}
 */
async function mirrorAssistantResultToWhatsAppDailyTopic({
    userId,
    assistantId,
    resultText,
    sourceProjectId,
    sourceObjectId,
    sourceObjectType = 'tasks',
    sourceLabel = '',
    sourceCommentId = null,
    userData = null,
    timestamp = Date.now(),
    alreadyDeliveredTo = [],
}) {
    const normalizedText = String(resultText || '').trim()

    try {
        if (!userId) return { mirrored: false, reason: 'missing_user' }
        if (!normalizedText) return { mirrored: false, reason: 'empty_result' }

        const user = userData || (await getUserData(userId))

        // The daily topic lives in the user's default project — the same resolution the
        // inbound webhook uses (`whatsAppIncomingHandler`) — because that is the thread a
        // WhatsApp follow-up will actually land in. A scheduled task may well have run in
        // a different project; mirroring into *its* project would recreate the bug.
        const projectId = user?.defaultProjectId || sourceProjectId
        if (!projectId) return { mirrored: false, reason: 'missing_project' }

        const { chatId } = await getOrCreateWhatsAppDailyTopic(userId, projectId, assistantId, user, timestamp)
        if (!chatId) return { mirrored: false, reason: 'missing_topic' }

        // The heartbeat path already runs inside the daily topic, so its answer is there.
        if (projectId === sourceProjectId && chatId === sourceObjectId) {
            return { mirrored: false, reason: 'source_is_daily_topic', projectId, chatId }
        }

        const alreadyDelivered = (Array.isArray(alreadyDeliveredTo) ? alreadyDeliveredTo : []).some(
            target => target && target.projectId === projectId && target.objectId === chatId
        )
        if (alreadyDelivered) {
            return { mirrored: false, reason: 'already_delivered', projectId, chatId }
        }

        const commentId = buildMirrorCommentId({
            projectId,
            chatId,
            sourceProjectId,
            sourceObjectType,
            sourceObjectId,
            sourceCommentId,
            resultText: normalizedText,
        })

        const header = buildSourceHeader({ sourceLabel, sourceProjectId, sourceObjectType, sourceObjectId })
        const commentText = header ? `${header}\n\n${normalizedText}` : normalizedText

        const { stored } = await storeAssistantMessageInTopicOnce({
            projectId,
            chatId,
            assistantId,
            responseText: commentText,
            // The chat-list preview should scan as the answer, not as the header's URL.
            previewText: normalizedText,
            commentId,
            userId,
            // Silent on purpose: the originating thread keeps the AssistantLine pointer.
            updateAssistantLine: false,
            extraCommentFields: {
                isWhatsAppResultMirror: true,
                // What the model is given instead of commentText — see buildSourceHeader.
                ...(header ? { contextCommentText: normalizedText } : {}),
                mirroredFrom: {
                    projectId: sourceProjectId || '',
                    objectType: sourceObjectType || '',
                    objectId: sourceObjectId || '',
                    commentId: sourceCommentId || '',
                },
            },
        })

        console.log('WhatsApp ResultMirror: Mirrored assistant result into the daily topic', {
            userId,
            projectId,
            chatId,
            commentId,
            sourceProjectId,
            sourceObjectType,
            sourceObjectId,
            stored,
        })

        return {
            mirrored: stored,
            reason: stored ? 'stored' : 'duplicate',
            projectId,
            chatId,
            commentId,
        }
    } catch (error) {
        // Best effort by contract: the WhatsApp message has already been delivered.
        console.warn('WhatsApp ResultMirror: Failed to mirror assistant result', {
            userId,
            sourceProjectId,
            sourceObjectType,
            sourceObjectId,
            error: error?.message || String(error),
        })
        return { mirrored: false, reason: 'error' }
    }
}

module.exports = {
    mirrorAssistantResultToWhatsAppDailyTopic,
    buildMirrorCommentId,
}
