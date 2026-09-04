/**
 * Stands in for `utils/backends/Chats/chatsComments` inside the AT-2511 real-chain harness.
 *
 * Same module surface, same callback signature, no Firestore. The harness pushes snapshots through
 * `window.__emitComment`, so `LastUserOrAssistantCommentContainer` runs its REAL effects, its REAL
 * state and its REAL arrival detection against a delivery shaped exactly like the one it gets in
 * production — including the part that mattered: the new comment text lands in one commit and the
 * `arrivalId` derived from it only in the next.
 */
const handlers = new Map()

export const ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY = 'allProjects'

export const watchComments = (projectId, chatType, chatId, watcherKey, amountCommentsToGet, callback) => {
    handlers.set(watcherKey, { chatId, callback })
    if (typeof window !== 'undefined') window.__watchedChatId = chatId
}

export const unwatchComments = watcherKey => handlers.delete(watcherKey)

export const createObjectMessage = async () => {}

if (typeof window !== 'undefined') {
    // Delivers to every live watcher, exactly as one Firestore snapshot would.
    //
    // `extra` carries the run flags a streaming write really has (`isLoading`, `assistantRun`) and
    // an explicit `id`. The id matters: a streamed answer is ONE document rewritten as tokens
    // accumulate, so every chunk must keep the same id while the text grows — which is precisely
    // what the suppression keys on. Defaulting the id to the text (the original behaviour) is
    // right for the non-streaming modes, where each comment really is a different document.
    window.__emitComment = (commentText, extra = {}) => {
        handlers.forEach(({ callback }) => callback([{ id: commentText, commentText, created: Date.now(), ...extra }]))
    }
    window.__liveCommentWatchers = () => handlers.size
}
