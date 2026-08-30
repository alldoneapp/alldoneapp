/**
 * @jest-environment jsdom
 */

import { createBotQuickTopicChat } from './createBotQuickTopic'
import { runHttpsCallableFunction } from '../firestore'

jest.mock('../firestore', () => ({ runHttpsCallableFunction: jest.fn() }))

describe('createBotQuickTopicChat', () => {
    beforeEach(() => jest.clearAllMocks())

    it('delegates quick-topic creation to the authenticated server path', async () => {
        const data = {
            projectId: 'project-1',
            chatId: 'chat-1',
            assistantId: 'assistant-1',
            quickDateId: '20260830',
            titlePrefix: 'Assistant <> Karsten 30.08.2026',
            isAssistantEnabled: true,
        }
        const result = { ...data, title: `${data.titlePrefix} 1`, isPublicFor: [0] }
        runHttpsCallableFunction.mockResolvedValue(result)

        await expect(createBotQuickTopicChat(data)).resolves.toEqual(result)
        expect(runHttpsCallableFunction).toHaveBeenCalledWith('createBotQuickTopicSecondGen', data)
    })

    it('rejects an incomplete server response', async () => {
        runHttpsCallableFunction.mockResolvedValue({ chatId: 'chat-1' })

        await expect(createBotQuickTopicChat({})).rejects.toThrow('The server returned an invalid quick-topic result')
    })
})
