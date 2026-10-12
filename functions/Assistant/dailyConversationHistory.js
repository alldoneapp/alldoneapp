const { isRecentAnnaThread } = require('./annaHistoryWindow')

const HISTORY_LIMITS = Object.freeze({
    // A project change can create multiple threads within today and yesterday.
    // This is a safety cap on those threads, not a number of previous days.
    maxThreads: 3,
    messages: 12,
    summaryChars: 6000,
    messageChars: 1500,
    totalChars: 24000,
})

// Channel-specific discovery validates ownership/access before calling this shared formatter.
async function loadDailyConversationHistory(db, threads, runtime, historyWindow) {
    const previous = threads
        .filter(thread => isRecentAnnaThread(thread, historyWindow))
        .filter(thread => thread.projectId !== runtime.projectId || thread.chatId !== runtime.objectId)
        .slice(0, HISTORY_LIMITS.maxThreads)
    const parts = []
    let remaining = HISTORY_LIMITS.totalChars
    for (const thread of previous) {
        const [state, messages] = await Promise.all([
            db.doc(`assistantThreadState/${thread.projectId}_topics_${thread.chatId}_${thread.assistantId}`).get(),
            db
                .collection(`chatComments/${thread.projectId}/topics/${thread.chatId}/comments`)
                .orderBy('created', 'desc')
                .limit(HISTORY_LIMITS.messages)
                .get(),
        ])
        const entry = {
            projectId: thread.projectId,
            chatId: thread.chatId,
            date: thread.dateKey || '',
            summary: String(state.data()?.summary || '').slice(0, HISTORY_LIMITS.summaryChars),
            messages: messages.docs
                .slice()
                .reverse()
                .flatMap(doc => {
                    const message = doc.data()
                    const text = String(message.contextCommentText || message.commentText || '').slice(
                        0,
                        HISTORY_LIMITS.messageChars
                    )
                    return text ? [{ role: message.fromAssistant ? 'assistant' : 'user', text }] : []
                }),
        }
        // Keep complete JSON records and the latest messages when the shared budget fills.
        while (JSON.stringify(entry).length > remaining && entry.messages.length) entry.messages.shift()
        if (JSON.stringify(entry).length > remaining)
            entry.summary = entry.summary.slice(0, Math.max(0, remaining - 1000))
        const serialized = JSON.stringify(entry)
        if (serialized.length > remaining) break
        parts.push(serialized)
        remaining -= serialized.length + 1
    }
    return parts.join('\n')
}

module.exports = { HISTORY_LIMITS, loadDailyConversationHistory }
