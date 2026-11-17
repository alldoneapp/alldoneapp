// AT-3075: what "Mark as read" on Assistant-mode activity clears, parsed from the notice ids alone
// (no backend imports, so the conversation and its tests can use it freely). See
// annaActivityReadState.js for the writes.
//   chat/{projectId}/{chatId}/{commentId}             -> one chat
//   feed/{projectId}/{objectType}/{objectId}/{feedId} -> one object's Updates entries

// Notice ids come from the local activity history; only plain document ids may reach a path.
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value)

export function getAnnaActivityReadTargets(notices = []) {
    const chats = new Map()
    const feeds = new Map()
    ;(notices || []).forEach(notice => {
        const parts = typeof notice?.id === 'string' ? notice.id.split('/') : []
        if (notice?.kind === 'chat' && parts.length === 4 && parts[0] === 'chat') {
            const [, projectId, chatId] = parts
            if (validId(projectId) && validId(chatId)) chats.set(`${projectId}/${chatId}`, { projectId, chatId })
            return
        }
        if (notice?.kind === 'feed' && parts.length === 5 && parts[0] === 'feed') {
            const [, projectId, objectType, objectId] = parts
            if (validId(projectId) && validId(objectType) && validId(objectId))
                feeds.set(`${projectId}/${objectType}/${objectId}`, { projectId, objectType, objectId })
        }
    })
    return { chats: [...chats.values()], feeds: [...feeds.values()] }
}

export const hasAnnaActivityReadTargets = notices => {
    const { chats, feeds } = getAnnaActivityReadTargets(notices)
    return chats.length + feeds.length > 0
}
