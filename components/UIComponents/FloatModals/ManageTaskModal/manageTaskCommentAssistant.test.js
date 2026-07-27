import { getManageTaskCommentAssistantProps } from './manageTaskCommentAssistant'

describe('manage task comment assistant status', () => {
    it.each([true, false])('shows the task assistant as activated: %s', isAssistantEnabled => {
        expect(
            getManageTaskCommentAssistantProps({
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
        expect(getManageTaskCommentAssistantProps({ assistantId: 'assistant-1' }).initialAssistantEnabled).toBe(false)
    })
})
