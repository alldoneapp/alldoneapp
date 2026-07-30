import { getTaskCommentAssistantProps } from './taskCommentAssistant'

describe('task comment assistant status', () => {
    it.each([true, false])('passes the persisted assistant state: %s', isAssistantEnabled => {
        expect(
            getTaskCommentAssistantProps({
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
        expect(getTaskCommentAssistantProps({ assistantId: 'assistant-1' }).initialAssistantEnabled).toBe(false)
    })
})
