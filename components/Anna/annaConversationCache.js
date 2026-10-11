// Keep only the small index needed to mount the chat immediately. Message bodies
// stay in Firestore's existing IndexedDB cache; live reads remain authoritative.
const PREFIX = 'alldone.annaConversation.v1:'
const MAX_THREADS = 7
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
        if (
            cached?.userId !== userId ||
            conversation?.projectId !== user.defaultProjectId ||
            !validThread(referenceFor(conversation), userId) ||
            !validId(conversation.assistantId) ||
            conversation.annaOwnerId !== userId ||
            conversation.creatorId !== userId ||
            conversation.type !== 'topics' ||
            !Array.isArray(cached.threads)
        )
            return null
        const projects = new Set([user.defaultProjectId, ...(user.projectIds || [])])
        return {
            conversation,
            threads: cached.threads
                .filter(thread => validThread(thread, userId) && projects.has(thread.projectId))
                .slice(-MAX_THREADS),
            nextBefore: cached.nextBefore || null,
        }
    } catch (_) {
        return null
    }
}

export const saveAnnaConversationCache = (userId, projectId, state) => {
    const chat = state.conversation
    if (!chat || chat.projectId !== projectId || chat.annaOwnerId !== userId || chat.creatorId !== userId) return
    const threads = state.threads
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
            state.threads.length > MAX_THREADS && oldest
                ? { created: oldest.created, id: `${oldest.projectId}__${oldest.chatId}` }
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
