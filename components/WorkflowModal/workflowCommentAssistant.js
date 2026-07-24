export const getWorkflowCommentAssistantProps = task => ({
    showBotButton: true,
    externalAssistantId: task.assistantId,
    initialAssistantEnabled: task.isAssistantEnabled === true,
})
