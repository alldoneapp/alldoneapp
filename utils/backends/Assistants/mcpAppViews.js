import { getDb, runHttpsCallableFunction } from '../firestore'

/**
 * The client half of MCP Apps views under an assistant answer (functions/MCP/mcpAppViews.js).
 *
 * The views of a comment are READ over a live listener (equality filters only, no composite index):
 * the run writes one while the answer is still streaming. Everything the frame needs from its
 * server goes through `mcpAppSecondGen` with the view id; the frame never holds a token.
 */
export function watchMcpAppViews(commentId, userId, callback) {
    if (!commentId || !userId) return () => {}
    return getDb()
        .collection('mcpAppViews')
        .where('userId', '==', userId)
        .where('assistantCommentId', '==', commentId)
        .onSnapshot(
            snapshot => {
                const views = []
                snapshot.forEach(doc => views.push({ ...doc.data(), viewId: doc.id }))
                views.sort((first, second) => (first.createdAt || 0) - (second.createdAt || 0))
                callback(views)
            },
            error => {
                // A thread that cannot read its views still has to show the conversation.
                console.warn('watchMcpAppViews failed', error?.message)
                callback([])
            }
        )
}

export function loadMcpAppResource(viewId) {
    return runHttpsCallableFunction('mcpAppSecondGen', { viewId, action: 'resource' })
}

export function callMcpAppTool(viewId, name, args) {
    return runHttpsCallableFunction('mcpAppSecondGen', { viewId, action: 'callTool', name, arguments: args || {} })
}
