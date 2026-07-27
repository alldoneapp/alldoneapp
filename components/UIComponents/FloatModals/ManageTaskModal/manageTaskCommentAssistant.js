export const getManageTaskCommentAssistantProps = task => ({
    showBotButton: true,
    externalAssistantId: task.assistantId,
    initialAssistantEnabled: task.isAssistantEnabled === true,
})
