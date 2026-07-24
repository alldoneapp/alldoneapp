export const snapshotAssistantMessageIds = (messages, isAssistant) =>
    new Set(messages.filter(message => isAssistant(message?.creatorId)).map(message => message.id))

export const hasNewVisibleAssistantMessage = (messages, existingAssistantMessageIds, isAssistant) =>
    messages.some(message => {
        if (!isAssistant(message?.creatorId)) return false
        if (existingAssistantMessageIds.has(message.id)) return false
        const hasVisibleText = typeof message?.commentText === 'string' && message.commentText.trim().length > 0
        return hasVisibleText || message?.isLoading === true
    })
