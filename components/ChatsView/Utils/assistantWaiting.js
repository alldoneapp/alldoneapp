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

// Assistant-line sends always create a new topic. Once its first assistant comment is present,
// that comment owns progress (including terminal failure/cancellation) and the local placeholder
// must get out of the way, even if the comment has no text yet.
export const hasAssistantReplyToPendingSend = (messages, pending, isAssistant) =>
    !!pending &&
    messages.some(message => message?.creatorId === pending.assistantId || isAssistant(message?.creatorId))

export const shouldShowAssistantScrollIndicator = (smallScreenNavigation, assistantResponseIsLoading) =>
    !smallScreenNavigation || !assistantResponseIsLoading
