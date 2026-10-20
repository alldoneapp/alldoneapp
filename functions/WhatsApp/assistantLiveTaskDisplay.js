const { getBaseUrl } = require('../Utils/HelperFunctionsCloud')
const { storeCallTranscriptTurn } = require('./whatsAppCallTranscript')
const { voiceOperationOutcome } = require('./assistantLiveStatus')

// Display only verified task-creation results, never arbitrary backend prose.
// The task's destination project can differ from the chat's project.
async function displayCreatedCallTask({ session, result }) {
    if (result?.success !== true || !result.taskId || !result.projectId) return null
    const { taskId, projectId } = result
    const title = String(result.task?.extendedName || result.task?.name || 'Task').trim() || 'Task'
    try {
        const url = `${getBaseUrl()}/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`
        const posted = await storeCallTranscriptTurn({
            sessionId: session.id,
            // Stable across delegations/retries; the transcript writer deduplicates
            // transactionally. Distinct tasks in one request still get their own entry.
            turnId: `created_task:${JSON.stringify([projectId, taskId])}`,
            role: 'assistant',
            text: `${title}\n${url}`,
            projectId: session.projectId,
            chatId: session.chatId,
            userId: session.userId,
            assistantId: session.assistantId,
            source: `${session.channel || 'browser_call'}_task`,
            isCallTranscript: false,
        })
        return { chatPosted: true, commentId: posted.commentId }
    } catch (error) {
        // Creation already succeeded. A display failure must never turn it into
        // a failed mutation that the model might repeat, creating another task.
        return { chatPosted: false, outcome: voiceOperationOutcome(null, error) }
    }
}

module.exports = { displayCreatedCallTask }
