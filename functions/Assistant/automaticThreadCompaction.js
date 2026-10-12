const admin = require('firebase-admin')
const { maybeCompactAssistantThread } = require('./rollingThreadCompaction')

async function generateRollingThreadSummary(prompt, model, toolRuntimeContext) {
    const { interactWithChatStream } = require('./assistantHelper')
    const stream = await interactWithChatStream(prompt, model, 'TEMPERATURE_LOW', [], {
        ...toolRuntimeContext,
        sourceChannel: 'automatic_thread_compaction',
        promptCacheScope: 'automatic_thread_compaction',
        disablePromptCaching: true,
        disableToolSearch: true,
    })
    let summary = ''
    for await (const chunk of stream) {
        if (chunk?.content) summary += chunk.content
    }
    return summary.trim()
}

async function runAutomaticThreadCompaction({
    projectId,
    objectType,
    objectId,
    assistantId,
    triggeringMessageId,
    model,
    hardOnly,
    toolRuntimeContext,
}) {
    const { getAssistantThreadStateDocRef } = require('./assistantHelper')
    const db = admin.firestore()
    const stateRef = getAssistantThreadStateDocRef(db, projectId, objectType, objectId, assistantId)
    if (!stateRef) return { compacted: false, hard: false, reason: 'invalid_thread' }

    const retryDeadline = Date.now() + 30 * 1000
    let result
    do {
        result = await maybeCompactAssistantThread({
            db,
            stateRef,
            projectId,
            objectType,
            objectId,
            triggeringMessageId,
            hardOnly,
            summarize: prompt => generateRollingThreadSummary(prompt, model, toolRuntimeContext),
        })
        if (!hardOnly || !['in_progress', 'stale'].includes(result.reason) || Date.now() >= retryDeadline) break
        await new Promise(resolve => setTimeout(resolve, 1000))
    } while (Date.now() < retryDeadline)

    console.log('🧹 AUTOMATIC THREAD COMPACTION:', {
        projectId,
        objectType,
        objectId,
        assistantId,
        triggeringMessageId,
        hardOnly,
        compacted: result.compacted,
        hard: result.hard,
        reason: result.reason,
        compactedMessageCount: result.compactedMessageCount || 0,
        retainedMessageCount: result.retainedMessageCount || 0,
    })
    return result
}

module.exports = { runAutomaticThreadCompaction }
