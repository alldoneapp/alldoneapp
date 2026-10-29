import { getAnnaHistoryWindow, isRecentAnnaThread } from '../../functions/Assistant/annaHistoryWindow'

// Keep the small index needed to mount today's and yesterday's chats immediately.
const PREFIX = 'alldone.annaConversation.v1:'
const MAX_THREADS = 100
const keyFor = (userId, projectId) => `${PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}`
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value)
const validThread = (thread, userId) =>
    validId(thread?.projectId) &&
    validId(userId) &&
    (thread.chatId === `anna_${userId}` || new RegExp(`^AnnaChat[0-9]{8}${userId}$`).test(thread.chatId))
const referenceFor = thread => ({
    projectId: thread.projectId,
    chatId: thread.chatId || thread.id,
    assistantId: thread.assistantId,
    created: thread.created,
    dateKey: thread.dateKey || thread.annaDateKey || '',
})

export const readAnnaConversationCache = (userId, user) => {
    if (!userId || user.isAnonymous || !user.defaultProjectId) return null
    try {
        const cached = JSON.parse(localStorage.getItem(keyFor(userId, user.defaultProjectId)) || 'null')
        const conversation = cached?.conversation
        // AT-2903: the conversation may continue in another member project.
        const projects = new Set([user.defaultProjectId, ...(user.projectIds || [])])
        if (
            cached?.userId !== userId ||
            !projects.has(conversation?.projectId) ||
            !validThread(referenceFor(conversation), userId) ||
            !validId(conversation.assistantId) ||
            conversation.annaOwnerId !== userId ||
            conversation.creatorId !== userId ||
            conversation.type !== 'topics' ||
            !Array.isArray(cached.threads)
        )
            return null
        const accessibleThreads = cached.threads.filter(
            thread => validThread(thread, userId) && projects.has(thread.projectId)
        )
        const window = getAnnaHistoryWindow(user)
        const recentThreads = accessibleThreads.filter(thread => isRecentAnnaThread(thread, window))
        const threads = recentThreads.slice(-MAX_THREADS)
        const oldest = threads[0]
        return {
            conversation,
            threads,
            // An older app may have cached more threads. Start pagination at the
            // retained boundary so trimming that cache never skips history.
            nextBefore:
                recentThreads.length > MAX_THREADS && oldest
                    ? { created: oldest.created, id: `${oldest.projectId}__${oldest.chatId}` }
                    : accessibleThreads.some(thread => !isRecentAnnaThread(thread, window))
                      ? { created: window.start }
                      : cached.nextBefore || null,
        }
    } catch (_) {
        return null
    }
}

export const saveAnnaConversationCache = (userId, projectId, state, user = {}) => {
    const chat = state.conversation
    // `projectId` names the cache (the account's default project); the current
    // chat itself may live in another project the user selected (AT-2903).
    if (!chat || !validId(chat.projectId) || chat.annaOwnerId !== userId || chat.creatorId !== userId) return
    const window = getAnnaHistoryWindow(user)
    const recentThreads = state.threads.filter(thread => isRecentAnnaThread(thread, window))
    const threads = recentThreads
        .map(referenceFor)
        .filter(thread => validThread(thread, userId))
        .slice(-MAX_THREADS)
    const oldest = threads[0]
    const snapshot = {
        userId,
        // Never replay cached workspace presentations, browser takeovers or run state.
        conversation: {
            ...referenceFor(chat),
            id: chat.id,
            annaOwnerId: userId,
            creatorId: userId,
            type: 'topics',
            isPublicFor: chat.isPublicFor,
        },
        threads,
        nextBefore:
            recentThreads.length > MAX_THREADS && oldest
                ? { created: oldest.created, id: `${oldest.projectId}__${oldest.chatId}` }
                : state.threads.some(thread => !isRecentAnnaThread(thread, window))
                  ? { created: window.start }
                  : state.nextBefore,
    }
    try {
        const key = keyFor(userId, projectId)
        const value = JSON.stringify(snapshot)
        if (localStorage.getItem(key) !== value) localStorage.setItem(key, value)
    } catch (_) {
        // Storage can be unavailable or full. Normal Firestore startup still works.
    }
}

export const clearAnnaConversationCache = (userId, projectId) => {
    try {
        localStorage.removeItem(keyFor(userId, projectId))
    } catch (_) {}
}
