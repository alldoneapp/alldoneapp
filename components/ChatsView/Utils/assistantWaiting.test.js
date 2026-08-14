import {
    hasLoadingAssistantMessage,
    hasNewVisibleAssistantMessage,
    shouldShowAssistantScrollIndicator,
    snapshotAssistantMessageIds,
} from './assistantWaiting'
import { SCREEN_BREAKPOINT_NAV_SIDEBAR_COLLAPSED } from '../../styles/global'

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

    it('only treats an assistant message as active loading UI', () => {
        expect(
            hasLoadingAssistantMessage(
                [
                    { id: 'user-loading', creatorId: 'user-1', isLoading: true },
                    { id: 'assistant-done', creatorId: 'assistant-1', isLoading: false },
                ],
                isAssistant
            )
        ).toBe(false)

        expect(
            hasLoadingAssistantMessage(
                [{ id: 'assistant-loading', creatorId: 'assistant-1', isLoading: true }],
                isAssistant
            )
        ).toBe(true)
    })

    it('allows callers to exclude stale or unrelated loading states', () => {
        const message = { id: 'assistant-loading', creatorId: 'assistant-1', isLoading: true }

        expect(hasLoadingAssistantMessage([message], isAssistant, () => false)).toBe(false)
    })

    test.each([320, 375, 430])('hides the loading indicator scrollbar at a %ipx mobile viewport', width => {
        const smallScreenNavigation = width <= SCREEN_BREAKPOINT_NAV_SIDEBAR_COLLAPSED

        expect(shouldShowAssistantScrollIndicator(smallScreenNavigation, true)).toBe(false)
        expect(shouldShowAssistantScrollIndicator(smallScreenNavigation, false)).toBe(true)
    })

    it('keeps the scroll indicator available on desktop during loading', () => {
        expect(shouldShowAssistantScrollIndicator(false, true)).toBe(true)
    })
})
