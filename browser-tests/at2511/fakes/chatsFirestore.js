/** Stands in for `utils/backends/Chats/chatsFirestore` — see `fakes/chatsComments.js`. */
export const watchChat = (projectId, objectId, watcherKey, callback) => {
    callback({ id: objectId, title: 'Daily planning', assistantId: 'assistant-1' })
}

export const unwatchChat = () => {}
