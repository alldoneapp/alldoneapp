import { getWorkflowCommentAssistantProps } from './workflowCommentAssistant'

describe('workflow comment assistant status', () => {
    it.each([true, false])('shows the task assistant as activated: %s', isAssistantEnabled => {
        expect(
            getWorkflowCommentAssistantProps({
                assistantId: 'assistant-1',
                isAssistantEnabled,
            })
        ).toEqual({
            showBotButton: true,
            externalAssistantId: 'assistant-1',
            initialAssistantEnabled: isAssistantEnabled,
        })
    })

    it('treats a missing persisted activation flag as inactive', () => {
        expect(getWorkflowCommentAssistantProps({ assistantId: 'assistant-1' }).initialAssistantEnabled).toBe(false)
    })
})
