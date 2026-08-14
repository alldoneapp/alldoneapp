export const getTaskCommentAssistantProps = task => ({
    showBotButton: true,
    externalAssistantId: task.assistantId,
    initialAssistantEnabled: task.isAssistantEnabled === true,
})
