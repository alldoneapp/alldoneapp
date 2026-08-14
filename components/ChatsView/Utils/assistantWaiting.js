export const snapshotAssistantMessageIds = (messages, isAssistant) =>
    new Set(messages.filter(message => isAssistant(message?.creatorId)).map(message => message.id))

export const hasNewVisibleAssistantMessage = (messages, existingAssistantMessageIds, isAssistant) =>
    messages.some(message => {
        if (!isAssistant(message?.creatorId)) return false
        if (existingAssistantMessageIds.has(message.id)) return false
        const hasVisibleText = typeof message?.commentText === 'string' && message.commentText.trim().length > 0
        return hasVisibleText || message?.isLoading === true
    })

export const hasLoadingAssistantMessage = (
    messages,
    isAssistant,
    isMessageLoading = message => message?.isLoading === true
) => messages.some(message => isAssistant(message?.creatorId) && isMessageLoading(message))

export const shouldShowAssistantScrollIndicator = (smallScreenNavigation, assistantResponseIsLoading) =>
    !smallScreenNavigation || !assistantResponseIsLoading
