const { getBaseUrl } = require('../Utils/HelperFunctionsCloud')
const { storeCallTranscriptTurn } = require('./whatsAppCallTranscript')
const { voiceOperationOutcome } = require('./assistantLiveStatus')
const { buildNoteUrl } = require('../Assistant/noteLinkHelper')

// Display only verified creation results, never arbitrary backend prose or research URLs.
// The destination project can differ from the chat's project.
async function displayCreatedCallEntity({ session, result, toolName }) {
    const type = { create_task: 'task', create_note: 'note' }[toolName]
    if (!type || result?.success !== true) return null
    const objectId = result[`${type}Id`]
    const projectId = result.projectId || result[type]?.projectId
    if (typeof objectId !== 'string' || !objectId.trim() || typeof projectId !== 'string' || !projectId.trim())
        return null
    const title =
        type === 'task'
            ? String(result.task?.extendedName || result.task?.name || 'Task').trim() || 'Task'
            : String(result.note?.extendedTitle || result.note?.title || result.title || 'Note').trim() || 'Note'
    try {
        const url =
            type === 'note'
                ? buildNoteUrl(projectId, objectId, getBaseUrl())
                : `${getBaseUrl()}/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(objectId)}`
        const posted = await storeCallTranscriptTurn({
            sessionId: session.id,
            // Stable across delegations/retries; the transcript writer deduplicates
            // transactionally. Distinct objects in one request get their own entry.
            turnId: `created_${type}:${JSON.stringify([projectId, objectId])}`,
            role: 'assistant',
            text: `${title}\n${url}`,
            projectId: session.projectId,
            chatId: session.chatId,
            userId: session.userId,
            assistantId: session.assistantId,
            source: `${session.channel || 'browser_call'}_${type}`,
            isCallTranscript: false,
        })
        return { chatPosted: true, commentId: posted.commentId }
    } catch (error) {
        // Creation already succeeded. A display failure must never turn it into
        // a failed mutation that the model might repeat, creating another object.
        return { chatPosted: false, outcome: voiceOperationOutcome(null, error) }
    }
}

module.exports = { displayCreatedCallEntity }
