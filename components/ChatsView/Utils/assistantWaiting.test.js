import { hasNewVisibleAssistantMessage, snapshotAssistantMessageIds } from './assistantWaiting'

const isAssistant = creatorId => creatorId === 'assistant-1'

describe('assistant waiting state', () => {
    it('does not treat an existing assistant reply as the response to a new user message', () => {
        const existingMessages = [{ id: 'assistant-old', creatorId: 'assistant-1', commentText: 'Previous answer' }]
        const existingAssistantMessageIds = snapshotAssistantMessageIds(existingMessages, isAssistant)
        const updatedMessages = [...existingMessages, { id: 'user-new', creatorId: 'user-1', commentText: 'Follow-up' }]

        expect(hasNewVisibleAssistantMessage(updatedMessages, existingAssistantMessageIds, isAssistant)).toBe(false)
    })

    it('detects a newly created loading assistant message', () => {
        const existingMessages = [{ id: 'assistant-old', creatorId: 'assistant-1', commentText: 'Previous answer' }]
        const existingAssistantMessageIds = snapshotAssistantMessageIds(existingMessages, isAssistant)
        const updatedMessages = [
            ...existingMessages,
            { id: 'assistant-new', creatorId: 'assistant-1', commentText: '', isLoading: true },
        ]

        expect(hasNewVisibleAssistantMessage(updatedMessages, existingAssistantMessageIds, isAssistant)).toBe(true)
    })
})
