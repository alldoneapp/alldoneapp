import { runHttpsCallableFunction } from '../firestore'

export const createBotQuickTopicChat = async data => {
    const result = await runHttpsCallableFunction('createBotQuickTopicSecondGen', data)

    if (!result?.projectId || !result?.chatId || !result?.title || !Array.isArray(result?.isPublicFor)) {
        throw new Error('The server returned an invalid quick-topic result')
    }

    return result
}
