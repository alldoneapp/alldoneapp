const { FieldPath } = require('firebase-admin/firestore')
const { canAccessObject } = require('../shared/privacyAccess')
const { mapWithConcurrency } = require('../Utils/mapWithConcurrency')
const { HISTORY_LIMITS, loadDailyConversationHistory } = require('../Assistant/dailyConversationHistory')
const { getAnnaHistoryWindow } = require('../Assistant/annaHistoryWindow')

async function loadWhatsAppHistoryContext(db, runtime, { now = Date.now() } = {}) {
    const userId = runtime.requestUserId
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(userId || '')) return ''
    const [projects, user] = await Promise.all([
        db.collection('projects').where('userIds', 'array-contains', userId).get(),
        db.doc(`users/${userId}`).get(),
    ])
    const historyWindow = getAnnaHistoryWindow(user.data(), now)
    const threads = []
    await mapWithConcurrency(projects.docs, 8, async project => {
        // Uses the existing creatorId descending single-field index (whose implicit
        // document-name order is also descending). Includes existing daily topics;
        // no migration/registry population is needed after rollout or a project change.
        const query = db
            .collection(`chatObjects/${project.id}/chats`)
            .where('creatorId', '==', userId)
            .orderBy('creatorId', 'desc')
            .orderBy(FieldPath.documentId(), 'desc')
            .startAt(userId, `BotChat${historyWindow.today}\uf8ff`)
            .endAt(userId, `BotChat${historyWindow.yesterday}`)
        let cursor = null
        let found = 0
        while (found < HISTORY_LIMITS.maxThreads + 1) {
            const snapshot = await (cursor ? query.startAfter(cursor) : query).limit(50).get()
            for (const doc of snapshot.docs) {
                const chat = doc.data()
                const match = doc.id.match(new RegExp(`^BotChat(\\d{8})${userId}$`))
                if (
                    !match ||
                    ![historyWindow.today, historyWindow.yesterday].includes(match[1]) ||
                    chat.creatorId !== userId ||
                    chat.type !== 'topics' ||
                    !canAccessObject(chat, userId)
                )
                    continue
                threads.push({
                    projectId: project.id,
                    chatId: doc.id,
                    assistantId: chat.assistantId,
                    dateKey: match[1],
                    created: Number(chat.created) || 0,
                })
                if (++found === HISTORY_LIMITS.maxThreads + 1) break
            }
            if (snapshot.docs.length < 50) break
            cursor = snapshot.docs[snapshot.docs.length - 1]
        }
    })
    threads.sort(
        (a, b) => b.dateKey.localeCompare(a.dateKey) || b.created - a.created || b.chatId.localeCompare(a.chatId)
    )
    return loadDailyConversationHistory(db, threads, runtime, historyWindow)
}

module.exports = { loadWhatsAppHistoryContext }
